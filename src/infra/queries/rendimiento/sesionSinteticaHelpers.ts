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

/** Calcula el nombre EXACTO que Auth.js usaria para la cookie de
 * sesion, replicando @auth/core/lib/utils/cookie.js (defaultCookies()):
 * `${useSecureCookies ? "__Secure-" : ""}authjs.session-token`. Ese
 * mismo nombre es TAMBIEN el salt que next-auth/jwt usa para derivar
 * la clave de cifrado (@auth/core/jwt.js, getDerivedEncryptionKey():
 * hkdf(secret, salt, ...), con salt = options.cookies.sessionToken.name
 * en @auth/core/lib/actions/session.js) -- un salt distinto deriva una
 * clave distinta y decode() falla, AUNQUE el secreto sea correcto.
 *
 * CORRECCION (Alex, 2026-11-20, investigacion del 401 en Preview de
 * Vercel con CARGA_CONSULTAS_NEXTAUTH_SECRET == NEXTAUTH_SECRET real):
 * la version anterior de este archivo asumia a ciegas
 * useSecureCookies=true (una sola constante hardcodeada), razonando
 * "el script siempre apunta a HTTPS". Pero el valor REAL en runtime
 * NUNCA depende de si la URL de destino es HTTPS -- depende de como
 * Auth.js resuelve `useSecureCookies` PARA ESE DEPLOYMENT especifico
 * (@auth/core/lib/init.js): `config.useSecureCookies ?? url.protocol
 * === "https:"`, donde `url` sale de `createActionURL()`
 * (next-auth/lib/index.js -> @auth/core/lib/utils/env.js):
 *   - Si `AUTH_URL`/`NEXTAUTH_URL` esta definida para ESE ENTORNO de
 *     Vercel (Production/Preview/Development se configuran por
 *     separado en el dashboard del proyecto), su protocolo manda,
 *     ignorando los headers reales de la peticion entrante.
 *   - Si no esta definida ahi, manda el protocolo detectado
 *     (`x-forwarded-proto`/`host`) de la peticion real.
 * Si cualquiera de esos dos caminos resuelve a NO-https para el
 * deployment de Preview que este script apunta (ej. la variable esta
 * puesta solo para el entorno "Production" de Vercel, o quedo con un
 * valor http por error), el servidor calcula un nombre/salt SIN el
 * prefijo "__Secure-", mientras este script seguia asumiendo que SI lo
 * tenia -- decode() nunca encuentra la cookie (nombre de cookie
 * distinto) y, aunque la encontrara, derivaria una clave distinta
 * (salt distinto): 401 "NO_SESION", AUNQUE EL SECRETO COINCIDA
 * EXACTAMENTE -- exactamente el sintoma reportado. Ver la reproduccion
 * de este mecanismo en __tests__/sesionSinteticaHelpers.test.ts.
 *
 * Por eso ahora es una funcion explicita, no una constante asumida --
 * el operador debe confirmar el valor efectivo para el deployment de
 * destino (ver cargaConsultas.ts, CARGA_CONSULTAS_USA_COOKIES_SEGURAS)
 * en vez de que el script lo adivine en silencio. */
export function calcularNombreCookieSesion(useSecureCookies: boolean): string {
  return `${useSecureCookies ? "__Secure-" : ""}authjs.session-token`;
}

/** El nombre/salt para `useSecureCookies` resuelto a `true` -- el caso
 * esperado en la mayoria de los deployments reales, pero YA NO el
 * unico que este modulo asume ciegamente (ver el comentario de
 * calcularNombreCookieSesion() arriba). Se mantiene exportada con el
 * mismo nombre que antes para no romper el codigo/pruebas existentes
 * que ya la referencian como el valor HTTPS documentado. */
export const NOMBRE_COOKIE_SESION_HTTPS = calcularNombreCookieSesion(true);

/** El nombre/salt para `useSecureCookies` resuelto a `false` (HTTP sin
 * TLS, o un deployment HTTPS cuyo protocolo Auth.js no detecto como
 * tal -- ver el comentario de calcularNombreCookieSesion() arriba).
 * Exportada para que cargaConsultas.ts y las pruebas la referencien
 * explicitamente en vez de repetir el string literal. */
export const NOMBRE_COOKIE_SESION_HTTP = calcularNombreCookieSesion(false);

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
 * escrito a disco). `useSecureCookies` (default true, preserva el
 * comportamiento anterior) debe fijarse a `false` si se confirma que
 * el deployment de destino resuelve useSecureCookies=false en runtime
 * (ver calcularNombreCookieSesion() mas arriba) -- nunca adivinado.
 */
export async function mintarCookieSesionSintetica(
  secret: string,
  claims: JWT,
  useSecureCookies = true,
): Promise<string> {
  if (!secret) throw new Error("SECRETO_NEXTAUTH_VACIO");
  const nombreCookie = calcularNombreCookieSesion(useSecureCookies);
  const token = await encode({
    secret,
    salt: nombreCookie,
    maxAge: VIGENCIA_SESION_SINTETICA_SEGUNDOS,
    token: claims,
  });
  return `${nombreCookie}=${token}`;
}
