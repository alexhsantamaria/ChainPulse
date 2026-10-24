// RF24 -- helper EXCLUSIVO DE PRUEBA, bajo __tests__/ (CORRECCION Alex
// 2026-10-22, punto 6): este modulo reubico aqui desde
// src/infra/rf24/tokenDerivacion.ts (produccion) porque, revisado el
// alcance real de PR-A, NINGUN codigo de PR-A fuera de las pruebas de
// integracion lo invoca -- su unico consumidor real es
// rf24DespachoYReconciliacion.integration.test.ts (Pruebas 13/14), que
// lo usa para construir un tokenHash real y deterministico con el que
// ejercitar la idempotencia de asignar_token_pendiente contra Postgres
// real. El despachador que normalmente llamaria a esta derivacion para
// enviar un correo real (Resend) es PR-B, todavia no autorizado -- este
// modulo NO debe tratarse como codigo de produccion listo para usar
// hasta que PR-B lo reintroduzca (o reautorice) en su propio alcance.
//
// Derivacion determinista del token (HMAC-SHA256 versionado, mecanismo
// ya cerrado en el diseno -- autorizacion de PR-A, "Token e
// idempotencia"). Resuelve, por construccion, el Bloqueador 1 de la
// addenda-cierre-v5 (un reintento recalcula exactamente el mismo token,
// nunca uno nuevo) y el requisito de la autorizacion de PR-A de nunca
// migrar silenciosamente a la version activa actual (una fila ya
// preparada SIEMPRE usa su propia tokenKeyVersion almacenada, pasada
// explicitamente aqui por el llamador -- este modulo nunca la infiere
// ni la sustituye).
//
// Separacion de dominio: el mensaje HMAC nunca es solo el solicitudId --
// lleva un prefijo fijo (ver DOMINIO_DERIVACION) para que esta clave, si
// alguna vez se usara indebidamente en otro contexto (contrario a la
// politica de este proyecto), no produzca un valor valido ahi.
//
// Entropia/formato: cada clave RF24_TOKEN_DERIVE_KEY_V{n} debe decodificar,
// en base64, a EXACTAMENTE 32 bytes (256 bits). Fallo seguro: una clave
// ausente, con longitud incorrecta o que no decodifica se trata como un
// error operativo explicito (Rf24ClaveDerivacionError), nunca como un
// fallo de envio ordinario -- el llamador (el despachador, PR-B) no debe
// consumir el umbral de reintentos por esto ni cancelar la solicitud.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const DOMINIO_DERIVACION = "chainpulse:rf24:token-derivacion:";
const LONGITUD_CLAVE_BYTES = 32;

export class Rf24ClaveDerivacionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Rf24ClaveDerivacionError";
  }
}

function nombreVariableClave(version: number): string {
  return `RF24_TOKEN_DERIVE_KEY_V${version}`;
}

/**
 * Lee y valida la clave de una version concreta. Nunca registra el valor
 * de la clave (ni en el mensaje de error) -- ver scrubbing, addenda-2-
 * cierre-v5 Seccion 3.
 */
export function obtenerClaveDerivacion(version: number): Buffer {
  const nombreVariable = nombreVariableClave(version);
  const valor = process.env[nombreVariable];
  if (!valor) {
    throw new Rf24ClaveDerivacionError(
      `RF24: falta la variable de entorno ${nombreVariable} (clave de derivacion de token, version ${version}). Fallo seguro -- no se deriva ningun token sin esta clave.`,
    );
  }
  let clave: Buffer;
  try {
    clave = Buffer.from(valor, "base64");
  } catch {
    throw new Rf24ClaveDerivacionError(
      `RF24: ${nombreVariable} no es base64 valido. Fallo seguro -- no se deriva ningun token con una clave que no decodifica.`,
    );
  }
  if (clave.length !== LONGITUD_CLAVE_BYTES) {
    throw new Rf24ClaveDerivacionError(
      `RF24: ${nombreVariable} decodifica a ${clave.length} bytes -- se exigen exactamente ${LONGITUD_CLAVE_BYTES} (256 bits). Fallo seguro -- no se deriva ningun token con una clave de longitud incorrecta.`,
    );
  }
  return clave;
}

/**
 * Validacion de arranque -- llamar una vez al iniciar el proceso (o
 * antes del primer uso). Lanza de forma explicita y ruidosa si la clave
 * ACTIVA (la que se usaria para emitir un token nuevo) falta o es
 * invalida -- nunca continua en silencio con una clave vacia/corta.
 */
export function validarClaveActivaAlArranque(versionActiva: number): void {
  obtenerClaveDerivacion(versionActiva);
}

/**
 * Deriva el token para una solicitud, usando la version EXACTA que el
 * llamador indique -- nunca la version activa por defecto. El llamador
 * (el despachador) es responsable de pasar la version almacenada de la
 * fila en un reintento, o la version activa solo para una fila nunca
 * preparada antes.
 */
export function derivarToken(solicitudId: string, version: number): string {
  const clave = obtenerClaveDerivacion(version);
  const mensaje = `${DOMINIO_DERIVACION}${solicitudId}`;
  return createHmac("sha256", clave).update(mensaje, "utf8").digest("base64url");
}

/** sha256 hexadecimal (64 caracteres) -- unico campo persistido (tokenHash). */
export function hashearToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Comparacion en tiempo constante de dos hashes hexadecimales. Longitudes
 * distintas se tratan como "no coincide" sin usar timingSafeEqual (que
 * lanza ante longitudes distintas) -- esta rama de longitud no filtra
 * nada sensible nuevo: el formato de tokenHash ya es fijo (64 hex, CHECK
 * de la migracion), asi que una longitud distinta solo puede venir de un
 * valor mal formado, nunca de un secreto parcialmente correcto.
 */
export function compararHashesEnTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
