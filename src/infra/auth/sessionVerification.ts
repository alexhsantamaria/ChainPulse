// Infraestructura — verificacion de sesion vigente (mecanismo acotado de
// revocacion, autorizado por Alex el 2026-10-03 sobre
// diagnostico-eliminacion-cuenta-prueba.md Seccion 8). PREPARADO PARA
// REVISION -- no aplicado a ninguna base real todavia (la migracion que
// agrega la columna que esto lee esta preparada, no ejecutada).
//
// Una sola consulta cubre las dos señales que puede necesitar una
// revocacion:
// - Existencia de la fila de Usuario, DENTRO del tenant del JWT:
//   tenantClient(empresaId) ya inyecta el filtro de tenant (ver
//   injectTenantFilter en tenantScope.ts) y fija app.tenant_id en la
//   MISMA transaccion que la consulta (prisma.$transaction + set_config
//   con is_local=true) -- exactamente el requisito de Alex de no fijar
//   el contexto de tenant y despues correr la consulta en una conexion
//   distinta o reutilizada sin resetear. No se escribio SQL nuevo para
//   esto: se reusa tenantClient(), la misma infraestructura ya revisada
//   que usa el resto de la app para toda consulta tenant-scoped.
//   Cero filas significa "ya no existe" -- cubre tanto que se haya
//   borrado el Usuario como que se haya borrado la Empresa completa (en
//   ese segundo caso tampoco haria falta logica aparte si en el futuro
//   se elige esa opcion en vez de borrar solo el usuario).
// - sessionVersion: comparada contra el claim que viaja en el JWT (ver
//   auth.config.ts). Permite revocar una sesion puntual sin borrar nada.
//
// Fail-closed sin excepcion (Alex, 2026-10-03): cualquier fallo de esta
// consulta (timeout, conexion perdida, lo que sea) se trata SIEMPRE como
// sesion NO vigente. No existe ninguna rama de este archivo que devuelva
// "vigente" como resultado de un error -- fail-open no es una alternativa
// aca.
import { tenantClient } from "../prisma/tenantClient";
import { logError } from "../log";

export type ResultadoVerificacionSesion =
  | { vigente: true }
  | { vigente: false; motivo: "ELIMINADA" | "REVOCADA" | "ERROR_VERIFICACION" };

// Un JWT emitido ANTES de que "sessionVersion" existiera no lleva ese
// claim -- llega como "undefined". Decision explicita de Alex
// (2026-10-03, ver la pregunta planteada antes de escribir este archivo):
// tratar la AUSENCIA de claim como si fuera igual al valor por defecto de
// la migracion (1) -- NO como "siempre vigente" (eso haria irrevocable
// cualquier JWT viejo, aun despues de subir la version en la base) y NO
// como "siempre revocada" (eso deslogueria a todos los usuarios
// existentes el dia que esto se despliegue, exactamente lo que Alex pidio
// evitar). Con este criterio, un usuario que nunca fue revocado
// puntualmente sigue en sessionVersion = 1 en la base, y su JWT viejo sin
// claim (tratado como "1" tambien) sigue coincidiendo -- nadie se
// desloguea. El dia que a un usuario puntual se le suba la version (a 2,
// por ejemplo), su JWT viejo sin claim (todavia "1") deja de coincidir
// con la base ("2") y se rechaza correctamente -- que es el caso de uso
// real de este mecanismo.
export const SESSION_VERSION_POR_DEFECTO = 1;

// Correccion acotada (Alex, 2026-10-04, sobre revision del diff antes de
// aplicarlo): el fallback a SESSION_VERSION_POR_DEFECTO era demasiado
// amplio -- cubria "undefined" (JWT viejo, el caso legitimo de arriba)
// pero TAMBIEN "null" y cualquier otro valor invalido, tratandolos igual
// que un JWT viejo. Eso es distinto: un claim "null" o no-entero-positivo
// no es "este JWT es de antes de la migracion", es un valor que no
// deberia poder existir en un JWT valido (el callback de auth.config.ts
// siempre asigna un numero) -- tratarlo como "1" en vez de rechazarlo
// abriria una rama de aceptacion para un claim corrupto o manipulado.
// Ahora solo "undefined" usa el fallback; cualquier otra cosa que no sea
// un entero positivo valido (null, 0, negativos, decimales, NaN, strings)
// se trata como un claim invalido y la sesion se rechaza.
function esEnteroPositivoValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0;
}

function claimEfectivo(sessionVersionClaim: number | undefined | null): number | null {
  if (sessionVersionClaim === undefined) return SESSION_VERSION_POR_DEFECTO;
  return esEnteroPositivoValido(sessionVersionClaim) ? sessionVersionClaim : null;
}

/**
 * Llamar en cada request protegido -- requireSession()/requireAdmin()
 * (rutas API) y requireSessionOrRedirect()/requireAdminOrRedirect()
 * (Server Components) -- DESPUES de decodificar el JWT y ANTES de
 * cualquier acceso a datos de negocio de la propia ruta/pagina.
 */
export async function verificarSesionVigente(
  usuarioId: string,
  empresaId: string,
  sessionVersionClaim: number | undefined | null,
): Promise<ResultadoVerificacionSesion> {
  let usuario: { sessionVersion: number } | null;
  try {
    usuario = await tenantClient(empresaId).usuario.findUnique({
      where: { id: usuarioId },
      select: { sessionVersion: true },
    });
  } catch {
    // Correccion acotada (Alex, 2026-10-04, segunda ronda): el catch NO
    // toma el error como parametro (catch sin binding) -- es imposible
    // que este bloque reenvie el error original, su mensaje, su stack o
    // su causa, porque el codigo nunca tiene una referencia a el.
    // logError() recibe unicamente un codigo fijo en texto, igual en
    // cada fallo, sin importar la causa real (timeout, conexion perdida,
    // credenciales de la base, lo que sea) -- un mensaje de error de
    // Prisma/Postgres puede incluir fragmentos de la consulta o del
    // DSN de conexion, y eso nunca debe llegar al logger.
    logError("verificarSesionVigente", "ERROR_CONSULTA_VIGENCIA_SESION");
    return { vigente: false, motivo: "ERROR_VERIFICACION" };
  }

  if (!usuario) {
    return { vigente: false, motivo: "ELIMINADA" };
  }

  // claimEfectivo() devuelve null para cualquier claim invalido (null,
  // no-entero, no-positivo) -- nunca coincide con un sessionVersion real
  // de la base (siempre entero positivo), asi que cae por el mismo motivo
  // generico REVOCADA que una version desactualizada, sin agregar una
  // rama nueva que distinga "invalido" de "revocado" al cliente.
  const claim = claimEfectivo(sessionVersionClaim);
  if (claim === null || usuario.sessionVersion !== claim) {
    return { vigente: false, motivo: "REVOCADA" };
  }

  return { vigente: true };
}

/**
 * Llamar UNA sola vez, en el login (src/auth.ts/autorizar()), para fijar
 * el claim inicial del JWT nuevo -- no es lo mismo que
 * verificarSesionVigente(): en el login todavia no hay un claim previo
 * contra el que comparar, hace falta el valor actual en si, no un
 * veredicto vigente/no vigente.
 *
 * Correccion acotada (Alex, 2026-10-04): devolver null (en vez de
 * SESSION_VERSION_POR_DEFECTO) si la fila no existe o la consulta falla.
 * Antes, cualquiera de esos dos casos emitia igual un JWT nuevo con
 * sessionVersion=1 -- aceptable para una lectura DESPUES del login (ver
 * claimEfectivo() arriba), pero no para emitir una sesion: autorizar()
 * (src/auth.ts) ya no emite sesion si esto devuelve null, en vez de
 * arrancar una sesion nueva con un valor que no se pudo confirmar contra
 * la base. Sigue sin lanzar nunca una excepcion sin manejar.
 *
 * Correccion acotada (Alex, 2026-10-04, segunda ronda): la primera
 * version de este comentario decia que logError() "solo recibe el
 * mensaje/stack del Error ya capturado" -- eso era inexacto: logError()
 * (src/infra/log.ts) SI extrae y registra el mensaje y el stack reales
 * de cualquier Error que se le pase, que pueden contener fragmentos de
 * la consulta, del DSN de conexion u otro dato no destinado al log.
 * Ahora el catch no toma el error como parametro (ver mas abajo) y
 * logError() recibe unicamente un codigo fijo en texto -- nunca el
 * error original, su mensaje, su stack ni su causa.
 */
export async function leerSessionVersionParaLogin(usuarioId: string, empresaId: string): Promise<number | null> {
  try {
    const usuario = await tenantClient(empresaId).usuario.findUnique({
      where: { id: usuarioId },
      select: { sessionVersion: true },
    });
    if (!usuario) {
      // Caso borde, no una excepcion -- no hay "error" del que extraer
      // nada, pero igual se registra con un codigo fijo, por el mismo
      // criterio de abajo: nunca texto libre ni interpolado.
      logError("leerSessionVersionParaLogin", "USUARIO_NO_ENCONTRADO_AL_LOGIN");
      return null;
    }
    return usuario.sessionVersion;
  } catch {
    // Mismo criterio que verificarSesionVigente() arriba (Alex,
    // 2026-10-04, segunda ronda): catch SIN binding -- el error jamas
    // queda accesible en este bloque, asi que es estructuralmente
    // imposible reenviar su mensaje, stack o causa. Solo un codigo fijo.
    logError("leerSessionVersionParaLogin", "ERROR_LECTURA_SESSION_VERSION_LOGIN");
    return null;
  }
}
