// Script de mantenimiento — RF19/RF20 §8.3: aprovisiona una cuenta de
// UsuarioPlataforma. Exclusivamente administrativo: nunca via migracion
// ni endpoint publico (no existe, y no deberia existir, ninguna ruta
// /api/plataforma/* de registro propio -- la unica forma de crear una
// cuenta de plataforma es este script).
//
// Por que una credencial separada de DATABASE_URL: §4.2 de la adenda
// revoca TODO privilegio de chainpulse_app sobre usuarios_plataforma --
// ni SELECT, ni INSERT. prisma.usuarioPlataforma.create() (lo que pide
// el punto 4 de §8.3, para heredar los defaults de Prisma de
// activo/sessionVersion/mfaUltimoContadorUsado) solo puede funcionar
// conectado como neondb_owner. Este script NUNCA reusa "../src/infra/
// prisma/client" (ese modulo esta cableado a DATABASE_URL=chainpulse_app,
// que de todas formas no podria escribir aqui) -- construye su propio
// PrismaClient con DATABASE_URL_PLATAFORMA_ADMIN, una variable de
// entorno NUEVA, distinta de DATABASE_URL, que debe contener la cadena
// de conexion con la credencial neondb_owner. Nunca se imprime su valor
// crudo (resumenUrl() ya se encarga de mostrar solo host/base/esquema).
//
// Reutiliza, sin modificarla, la infraestructura generica de scripts/ ya
// fusionada en src/infra/pruebaRevocacion/ (construirClientePrueba,
// desconectarClientePrueba, resumenUrl, destinoConfirmado,
// exigirEntornoConfirmado, verificarRolConexionAdministrativa,
// ROL_ADMIN_ESPERADO) -- a pesar del nombre de esa carpeta, su propio
// comentario de cabecera la declara "infraestructura... para las
// herramientas de scripts/" en general, y tanto
// rf20RamaTemporalNeonRunbook.ts como
// scripts/rf20/calibrarExtractor23505RamaTemporal.ts (RF20, sin relacion
// con revocacion) ya la reutilizan igual. No se duplica aqui ninguna
// logica de verificacion de rol ni de destino.
//
// Correccion de revision (ronda 2, Alex): este script generaba e
// IMPRIMIA una contraseña temporal en stdout cuando no se proveia
// APROVISIONAR_PASSWORD_TEMPORAL. Eso es inaceptable (stdout puede
// quedar en logs de CI/terminal/historial) -- ahora
// APROVISIONAR_PASSWORD_TEMPORAL es OBLIGATORIA, se usa EXCLUSIVAMENTE
// para derivar el hash (nunca se guarda en ninguna variable que
// sobreviva mas alla de esa derivacion, nunca se imprime, nunca se
// registra, nunca se incluye en ningun mensaje de error -- todos los
// catch de este archivo usan etiquetaSegura(), que solo devuelve
// etiquetas fijas de una lista cerrada, jamas err.message/err.stack) y
// nunca se retorna. El canal para transmitirla al nuevo usuario queda,
// como siempre, fuera del alcance de este script (RF19/RF20 no incluye
// envio de correo) -- la persona que corre el script la transmite por
// un canal separado y seguro de su elección, pero el script en si no
// es ese canal.
//
// Doble capa de autorizacion exigida ADEMAS de --ejecutar (ronda 2):
//   1) ENTORNO_PRUEBA_CONFIRMADO -- destino EXACTO (host:puerto/base?schema=esquema)
//      confirmado a mano contra el destino efectivamente resuelto (exigirEntornoConfirmado(),
//      infra generica sin modificar).
//   2) AUTORIZO_RF19_APROVISIONAR_USUARIO_PLATAFORMA="si" -- autorizacion
//      especifica de ESTA accion, distinta de ENTORNO_PRUEBA_CONFIRMADO
//      y de cualquier otra variable AUTORIZO_* de otro script.
// Ambas se exigen tambien en modo diagnostico (antes de inspeccionar
// nada) para que la confirmacion de destino sea siempre la misma
// disciplina, se vaya a escribir o no.
//
// Modo diagnostico por defecto (igual que restablecerPasswordCuentaPrueba.ts):
// sin --ejecutar, solo verifica el rol de conexion y los datos de
// entrada, nunca inserta nada.
//
// Uso:
//   APROVISIONAR_EMAIL=... APROVISIONAR_ROL=CURADOR_METODOLOGICO \
//     APROVISIONAR_PASSWORD_TEMPORAL=... DATABASE_URL_PLATAFORMA_ADMIN=... \
//     ENTORNO_PRUEBA_CONFIRMADO=... AUTORIZO_RF19_APROVISIONAR_USUARIO_PLATAFORMA=si \
//     npx tsx scripts/rf19/aprovisionar-usuario-plataforma.ts
//       -- solo diagnostica (verifica rol + destino + datos, no inserta nada)
//   ... --ejecutar
//       -- inserta la cuenta real
import "../_cargarEnv";
import { etiquetaSegura } from "../../src/infra/auth/etiquetaErrorSegura";

const EMAIL = (process.env.APROVISIONAR_EMAIL ?? "").trim();
const ROL = process.env.APROVISIONAR_ROL ?? "";
const ROL_CONFIRMACION = process.env.APROVISIONAR_ROL_CONFIRMACION ?? "";
const PASSWORD_TEMPORAL = process.env.APROVISIONAR_PASSWORD_TEMPORAL ?? "";
const DATABASE_URL_ADMIN = process.env.DATABASE_URL_PLATAFORMA_ADMIN;

const ROLES_VALIDOS = new Set(["CURADOR_METODOLOGICO", "ADMINISTRADOR_PLATAFORMA"]);

function exigirSegundaAutorizacion(): void {
  if (process.env.AUTORIZO_RF19_APROVISIONAR_USUARIO_PLATAFORMA !== "si") {
    throw new Error("AUTORIZACION_APROVISIONAMIENTO_FALTANTE");
  }
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar");

  if (!EMAIL) {
    console.error("APROVISIONAR_EMAIL es obligatoria -- abortado antes de conectarse a nada.");
    process.exitCode = 1;
    return;
  }
  if (!ROLES_VALIDOS.has(ROL)) {
    console.error(
      `APROVISIONAR_ROL debe ser exactamente "CURADOR_METODOLOGICO" o "ADMINISTRADOR_PLATAFORMA" (recibido: "${ROL}") -- abortado antes de conectarse a nada.`,
    );
    process.exitCode = 1;
    return;
  }
  // Doble confirmacion del ROL (mismo criterio que RESTABLECER_MFA_EMAIL/
  // _CONFIRMACION): un typo en APROVISIONAR_ROL que por casualidad cayera
  // igual en ROLES_VALIDOS (p. ej. pegar el rol equivocado de otra
  // cuenta) otorgaria el rol incorrecto sin que nada lo detecte -- exigir
  // que una SEGUNDA variable independiente repita el mismo valor
  // caracter por caracter aborta ante esa clase de error en vez de
  // arriesgar un alta con el rol equivocado.
  if (!ROL_CONFIRMACION) {
    console.error("APROVISIONAR_ROL_CONFIRMACION es obligatoria (debe repetir APROVISIONAR_ROL exactamente) -- abortado antes de conectarse a nada.");
    process.exitCode = 1;
    return;
  }
  if (ROL !== ROL_CONFIRMACION) {
    console.error("APROVISIONAR_ROL y APROVISIONAR_ROL_CONFIRMACION no coinciden -- abortado antes de conectarse a nada.");
    process.exitCode = 1;
    return;
  }
  if (!PASSWORD_TEMPORAL) {
    console.error(
      "APROVISIONAR_PASSWORD_TEMPORAL es obligatoria -- este script ya NO genera ni imprime ninguna contraseña. Proveela mediante una variable de entorno cargada desde un gestor de secretos o una entrada oculta, nunca pegada en la terminal visible ni en un argumento de linea de comandos. Abortado antes de conectarse a nada.",
    );
    process.exitCode = 1;
    return;
  }
  if (!DATABASE_URL_ADMIN) {
    console.error(
      "DATABASE_URL_PLATAFORMA_ADMIN es obligatoria (credencial neondb_owner -- chainpulse_app no tiene ningun privilegio sobre usuarios_plataforma, §4.2) -- abortado antes de conectarse a nada.",
    );
    process.exitCode = 1;
    return;
  }

  // §8.1/§8.2 -- misma normalizacion que login_lookup_plataforma() y el
  // indice unico funcional: lower(btrim(email)), aqui en JavaScript tal
  // como pide el punto 2 de §8.3 (este script nunca invoca ninguna
  // funcion SECURITY DEFINER -- usa la ruta Prisma normal, punto 4).
  const emailNormalizado = EMAIL.trim().toLowerCase();

  // Imports dinamicos, DESPUES de validar lo anterior -- mismo patron
  // que restablecerPasswordCuentaPrueba.ts: construir un PrismaClient
  // (aunque sea con otra credencial) no deberia dispararse si los datos
  // de entrada ya son invalidos.
  const { construirClientePrueba, desconectarClientePrueba } = await import(
    "../../src/infra/pruebaRevocacion/clientePrueba"
  );
  const { resumenUrl, destinoConfirmado, exigirEntornoConfirmado, verificarRolConexionAdministrativa, ROL_ADMIN_ESPERADO } =
    await import("../../src/infra/pruebaRevocacion/destinoPrueba");
  const { hashPassword } = await import("../../src/infra/auth/password");

  const destino = resumenUrl("DATABASE_URL_PLATAFORMA_ADMIN", DATABASE_URL_ADMIN);
  console.log(`Modo: ${ejecutar ? "EJECUCION (--ejecutar)" : "DIAGNOSTICO (solo lectura -- agregar --ejecutar para continuar)"}`);
  console.log(`Destino: host=${destino.host} puerto=${destino.puerto} base=${destino.base} esquema=${destino.esquema} (la credencial nunca se imprime).`);
  console.log(`Email a aprovisionar (normalizado): ${emailNormalizado}`);
  console.log(`Rol: ${ROL}`);
  console.log("");

  try {
    // Doble autorizacion (ronda 2), ANTES de conectarse: destino exacto
    // confirmado + autorizacion especifica de esta accion. Infra
    // generica sin modificar -- misma funcion que ya usa
    // scripts/rf20/calibrarExtractor23505RamaTemporal.ts.
    exigirEntornoConfirmado(destino);
    exigirSegundaAutorizacion();
    console.log(`Destino confirmado: ${destinoConfirmado(destino)}. Autorizacion especifica de aprovisionamiento confirmada.`);
  } catch (err) {
    console.error(`No se pudo confirmar destino/autorizacion -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error. Abortado antes de conectarse a nada.`);
    process.exitCode = 1;
    return;
  }

  const cliente = construirClientePrueba(DATABASE_URL_ADMIN, "aprovisionarUsuarioPlataforma");
  try {
    const veredicto = await verificarRolConexionAdministrativa(
      cliente,
      "aprovisionarUsuarioPlataforma",
      ROL_ADMIN_ESPERADO,
    );
    console.log(`Rol efectivo confirmado: ${veredicto.usuarioActual} (esperado: ${ROL_ADMIN_ESPERADO}).`);

    // Unicidad -- §8.2 ya protege esto con el indice unico funcional en
    // Postgres (el INSERT fallaria con 23505 igual), pero se comprueba
    // antes, de solo lectura, para dar un motivo legible sin depender
    // de parsear un error de restriccion unica.
    const existente: Array<{ id: string }> = await cliente.$queryRaw`
      SELECT id FROM public.usuarios_plataforma WHERE lower(btrim(email)) = ${emailNormalizado}
    `;
    if (existente.length > 0) {
      console.error(`Ya existe una cuenta de plataforma con este email (id=${existente[0]!.id}) -- abortado, no se insertó nada.`);
      process.exitCode = 1;
      return;
    }
    console.log("Unicidad confirmada: no existe ninguna cuenta previa con este email normalizado.");

    if (!ejecutar) {
      console.log("");
      console.log("Modo diagnostico: no se insertó ninguna fila. Volver a correr con --ejecutar para continuar.");
      return;
    }

    // La contraseña temporal SOLO se lee para derivar el hash, en la
    // misma expresion -- nunca se asigna a otra variable, nunca se
    // interpola en ningun console.log/console.error, nunca viaja en el
    // objeto que arma el catch de abajo.
    const passwordHash = await hashPassword(PASSWORD_TEMPORAL);

    // Punto 4 de §8.3 -- ruta Prisma normal: create() (nunca
    // $executeRaw/$queryRaw) para que @default(cuid()) y los defaults
    // de activo/sessionVersion/mfaUltimoContadorUsado se apliquen
    // automaticamente, tal como pide el documento. Punto 5 -- MFA se
    // deja deliberadamente deshabilitado: el usuario enrola en su
    // primer login real (src/app/api/plataforma/mfa/enrolar).
    const creado = await cliente.usuarioPlataforma.create({
      data: {
        email: emailNormalizado,
        passwordHash,
        rol: ROL,
        mfaHabilitado: false,
        mfaSecret: null,
      },
      select: { id: true },
    });

    console.log("");
    console.log(`Cuenta creada: id=${creado.id}, email=${emailNormalizado}, rol=${ROL}.`);
    console.log("La contraseña temporal provista por APROVISIONAR_PASSWORD_TEMPORAL se usó solo para derivar el hash -- este script nunca la imprime ni la registra. Transmitila al nuevo usuario por el canal separado y seguro que ya hayas usado para proveerla. El usuario enrola MFA en su primer login real.");
  } catch (err) {
    console.error(`No se pudo aprovisionar la cuenta -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error (nunca incluye la contraseña temporal).`);
    process.exitCode = 1;
  } finally {
    await desconectarClientePrueba(cliente, "aprovisionarUsuarioPlataforma");
  }
}

main().catch((err) => {
  console.error(`Error inesperado -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error (nunca incluye la contraseña temporal).`);
  process.exit(1);
});
