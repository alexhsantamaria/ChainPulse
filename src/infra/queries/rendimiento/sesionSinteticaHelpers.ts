// Infraestructura (solo para scripts/perf/, nunca usado por la app en
// runtime) -- mecanismo REPRODUCIBLE y SEGURO de sesiones sinteticas
// para cargaConsultas.ts (Incremento 5 PR4, Alex, ronda 2 de revision,
// 2026-11-19, punto 1: "crear usuarios y sesiones sinteticas
// reproducibles"). PURO (sin red/Postgres) salvo mintarCookieSesionSintetica(),
// que solo hace criptografia local (next-auth/jwt encode(), nunca una
// peticion HTTP ni una consulta a la base) -- se prueba con un secreto
// descartable, sin mockear nada.
//
// MECANISMO: en vez de pedirle al operador que inicie sesion a mano N
// veces y pegue las cookies (CARGA_CONSULTAS_COOKIES_SESION, el
// mecanismo anterior -- reemplazado por completo en esta ronda), este
// modulo emite el MISMO JWT que Auth.js emitiria en un login real,
// directamente con encode() de next-auth/jwt (el modulo que la app YA
// usa para decodificar sesiones -- nunca una reimplementacion propia de
// la criptografia), usando el secreto real del deployment de prueba
// (CARGA_CONSULTAS_NEXTAUTH_SECRET) y los datos de un Usuario
// efectivamente sembrado en esa base (ver crearUsuariosSinteticosParaCarga()
// en semillaSinteticaConsultas.ts).
//
// requireSession() (src/infra/auth/session.ts) decodifica el JWT Y
// verifica contra la base que ese Usuario exista con esa sessionVersion
// (verificarSesionVigente(), fail-closed) -- por eso la "sesion" real es
// la fila de Usuario, nunca algo que viva solo en este script: borrar
// esa fila (revocarUsuariosSinteticosDeCarga()) revoca la sesion de
// inmediato, en la siguiente peticion, sin necesitar ninguna tabla de
// sesiones aparte (estrategia JWT de Auth.js, sin persistencia de
// sesion del lado del servidor -- nunca hay "otra cosa" que limpiar).
//
// NUNCA imprime, persiste ni devuelve el secreto ni el valor de ninguna
// cookie en ningun mensaje de error -- mismo criterio que
// verificarDeploymentUsaRamaTemporal() en cargaConsultasHelpers.ts.
import { encode } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";
import { MARCA_SINTETICA_RENDIMIENTO_PR4, type EscalaFilasPorCadena } from "./configuracionRendimiento";

/** Dominio reservado por IANA especificamente para documentacion/pruebas
 * (RFC 2606, ".invalid") -- garantiza que ningun email sintetico pueda
 * colisionar jamas con un dominio real, a diferencia de inventar un
 * dominio cualquiera que alguien podria registrar el dia de mañana. */
const DOMINIO_SINTETICO = `${MARCA_SINTETICA_RENDIMIENTO_PR4}.invalid`;

/** Sufijo EXACTO que todo email generado para una escala dada siempre
 * tiene -- usado tanto por emailUsuarioSinteticoCarga() (construccion)
 * como por el filtro de revocacion (revocarUsuariosSinteticosDeCarga()
 * en semillaSinteticaConsultas.ts), para que ambos queden atados por el
 * mismo valor: una prueba demuestra que TODO email que la construccion
 * produce termina en este sufijo exacto, asi que el filtro de borrado
 * (email termina en este sufijo) nunca puede dejar uno afuera, ni
 * tocar un email que no sea sintetico de esta escala. */
export function sufijoEmailUsuariosSinteticosCarga(escala: EscalaFilasPorCadena): string {
  return `-escala-${escala}@${DOMINIO_SINTETICO}`;
}

/** Email reproducible para el usuario sintetico #indice (0-based) de
 * una escala dada -- mismo nombre siempre para el mismo (escala,
 * indice), nunca aleatorio. Usuario.email es UNICO GLOBAL (ADR-0003,
 * prisma/schema.prisma) -- el indice garantiza que no colisionen entre
 * si dentro de la misma escala, y DOMINIO_SINTETICO + la escala
 * garantizan que nunca colisione con un email real ni con el de otra
 * escala. */
export function emailUsuarioSinteticoCarga(escala: EscalaFilasPorCadena, indice: number): string {
  if (!Number.isInteger(indice) || indice < 0) {
    throw new Error(`INDICE_USUARIO_SINTETICO_INVALIDO_${indice}`);
  }
  return `usuario-${String(indice).padStart(4, "0")}${sufijoEmailUsuariosSinteticosCarga(escala)}`;
}

/** Los `cantidad` emails (en orden, indice 0..cantidad-1) para una
 * escala -- la lista EXACTA que crearUsuariosSinteticosParaCarga()
 * crea y que cargaConsultas.ts lee, en ese mismo orden (indice de la
 * lista <-> indice de conexion de autocannon, ver cargaConsultas.ts). */
export function emailsUsuariosSinteticosCarga(escala: EscalaFilasPorCadena, cantidad: number): string[] {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new Error(`CANTIDAD_USUARIOS_SINTETICOS_INVALIDA_${cantidad}`);
  }
  return Array.from({ length: cantidad }, (_, indice) => emailUsuarioSinteticoCarga(escala, indice));
}

/** Rol fijo de los usuarios sinteticos de carga -- ADMINISTRADOR, nunca
 * RESPONSABLE: las 6 preguntas del catalogo permiten ambos roles por
 * igual (AMBOS_ROLES, src/infra/queries/catalogo.ts), pero RESPONSABLE
 * queda limitado a las conexiones de su propio eslabon (RF4) -- una
 * variable de negocio ajena a lo que esta carga mide (latencia de las 6
 * consultas a escala), que ADMINISTRADOR evita por completo (visibilidad
 * total, sin eslabonId). El middleware de Next (src/middleware.ts) no
 * protege /api/consultas/ejecutar (fuera de su `matcher`), asi que el
 * requisito de MFA para ADMINISTRADOR tampoco aplica aca -- mfaHabilitado
 * queda en false sin que eso bloquee ninguna peticion de este script. */
export const ROL_USUARIO_SINTETICO_CARGA = "ADMINISTRADOR" as const;

export interface FilaUsuarioSinteticoCarga {
  email: string;
  nombre: string;
  rol: typeof ROL_USUARIO_SINTETICO_CARGA;
  passwordHash: string;
  empresaId: string;
  mfaHabilitado: false;
  sessionVersion: 1;
}

/**
 * Construye las filas a insertar -- PURA, recibe los `passwordHash` ya
 * calculados (el hash es async/criptografico; se hace fuera de esta
 * funcion para que esta siga siendo sincronica y trivialmente
 * testeable sin Argon2 real). mfaHabilitado=false y sessionVersion=1
 * siempre -- los valores por defecto reales de Usuario
 * (prisma/schema.prisma), fijados aca explicitamente para que un futuro
 * cambio de default en el schema no altere esta siembra en silencio.
 */
export function construirFilasUsuariosSinteticosCarga(
  empresaId: string,
  escala: EscalaFilasPorCadena,
  passwordHashes: readonly string[],
): FilaUsuarioSinteticoCarga[] {
  const emails = emailsUsuariosSinteticosCarga(escala, passwordHashes.length);
  return emails.map((email, indice) => ({
    email,
    nombre: `Usuario sintetico de carga ${indice} (PR4, escala ${escala})`,
    rol: ROL_USUARIO_SINTETICO_CARGA,
    passwordHash: passwordHashes[indice] as string,
    empresaId,
    mfaHabilitado: false as const,
    sessionVersion: 1 as const,
  }));
}

/** Nombre EXACTO de la cookie de sesion que Auth.js usa cuando el sitio
 * es HTTPS (@auth/core/lib/utils/cookie.js: defaultCookies(true).sessionToken.name
 * === "__Secure-authjs.session-token") -- este script SIEMPRE apunta a
 * HTTPS (exigirUrlDePrueba() de cargaConsultasHelpers.ts lo exige),
 * asi que es siempre este nombre, nunca el de la variante sin
 * "__Secure-" (esa es solo para desarrollo local sin HTTPS). */
export const NOMBRE_COOKIE_SESION_HTTPS = "__Secure-authjs.session-token";

/** Los claims EXACTOS que auth.config.ts (callback jwt) pondria en el
 * token para este Usuario si hubiera iniciado sesion de verdad. `sub`
 * es el id del Usuario (session.ts lo lee como token.sub -> session.user.id,
 * ver auth.config.ts callback session()). Se usa el tipo JWT real de
 * next-auth/jwt (ampliado en src/infra/auth/next-auth.d.ts) en vez de
 * una interfaz propia, para que un cambio futuro en esa ampliacion de
 * tipos se note aca por un error de compilacion, nunca en silencio. */
export function construirClaimsSesionSintetica(usuario: {
  id: string;
  email: string;
  nombre: string;
  empresaId: string;
  rol: typeof ROL_USUARIO_SINTETICO_CARGA;
  eslabonId: string | null;
  mfaHabilitado: boolean;
  sessionVersion: number;
}): JWT {
  return {
    sub: usuario.id,
    name: usuario.nombre,
    email: usuario.email,
    empresaId: usuario.empresaId,
    rol: usuario.rol,
    eslabonId: usuario.eslabonId,
    mfaHabilitado: usuario.mfaHabilitado,
    sessionVersion: usuario.sessionVersion,
  };
}

/** Segundos de vigencia del JWT sintetico -- generosamente por encima
 * de cualquier corrida real de cargaConsultas.ts, pero deliberadamente
 * corto (1 hora, nunca los 30 dias por defecto de Auth.js): esta
 * credencial es de un solo uso, para UNA corrida puntual, no una
 * sesion de verdad que alguien vaya a reusar despues. */
export const VIGENCIA_SESION_SINTETICA_SEGUNDOS = 60 * 60;

/**
 * Emite el valor EXACTO del header `Cookie:` (nombre=valor) para una
 * sesion sintetica -- usa next-auth/jwt encode(), la MISMA funcion que
 * Auth.js usa internamente para emitir una sesion real (nunca una
 * reimplementacion propia de la criptografia), con el secreto del
 * deployment de prueba. NUNCA imprime ni incluye `secret` en ningun
 * valor de retorno ni mensaje de error -- y el valor de retorno (la
 * cookie misma) es responsabilidad de quien llama nunca imprimirlo
 * tampoco (ver cargaConsultas.ts: nunca pasa por console.log/JSON
 * escrito a disco).
 */
export async function mintarCookieSesionSintetica(secret: string, claims: JWT): Promise<string> {
  if (!secret) throw new Error("SECRETO_NEXTAUTH_VACIO");
  const token = await encode({
    secret,
    salt: NOMBRE_COOKIE_SESION_HTTPS,
    maxAge: VIGENCIA_SESION_SINTETICA_SEGUNDOS,
    token: claims,
  });
  return `${NOMBRE_COOKIE_SESION_HTTPS}=${token}`;
}
