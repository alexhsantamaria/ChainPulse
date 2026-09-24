// Infraestructura -- cifrado de aplicacion para el contenido de los CSV
// subidos a R2 (Incremento 4 Bloque B). Decision confirmada por Alex el
// 2026-09-24 (ver docs/ADR/0006-cifrado-r2.md): el cifrado en reposo por
// defecto de R2 (AES-256, automatico, siempre activo -- ver
// https://developers.cloudflare.com/r2/reference/data-security/) protege
// contra robo fisico de disco, pero NO contra un token de API de R2
// filtrado o un bucket mal configurado -- quien tenga esas credenciales
// vería el CSV en claro igual. Esta capa asegura que el objeto que llega
// a R2 sea SIEMPRE ciphertext, con una clave que R2 nunca conoce.
//
// Envelope encryption, AES-256-GCM (modulo "crypto" nativo de Node, cero
// dependencias nuevas):
//   1. Se genera una DEK (Data Encryption Key) aleatoria de 32 bytes,
//      distinta para cada archivo -- generarDek().
//   2. El CONTENIDO se cifra con la DEK (cifrarContenido/
//      descifrarContenido) -- el objeto que se sube a R2 es
//      autocontenido: [iv 12B][ciphertext][authTag 16B].
//   3. La DEK misma se cifra ("se envuelve") con una clave MAESTRA
//      (envolverDek/desenvolverDek) -- lo unico que se persiste en
//      Postgres (ImportacionCsv.cifradoDek*) es la DEK ya envuelta,
//      nunca en claro, y nunca el contenido del archivo (que jamas toca
//      Postgres -- ver ImportacionCsv.objetoStorageKey).
//
// Por que envolver la DEK en vez de cifrar el archivo directo con la
// clave maestra: rotar la clave maestra sin envelope encryption
// obligaria a re-descifrar y re-cifrar TODOS los archivos ya subidos.
// Con envelope encryption, rotar solo exige re-envolver las DEKs ya
// guardadas en Postgres (bytes chicos, rapido) -- el contenido en R2
// nunca se vuelve a tocar. Ver "Rotacion de claves" en
// docs/ADR/0006-cifrado-r2.md y SEGURIDAD-credenciales.md para la
// politica completa de custodia/recuperacion/retencion de claves.
//
// Vinculacion criptografica con empresa+importacion (AAD): tanto el
// cifrado del contenido como el de la DEK usan "Additional Authenticated
// Data" (empresaId+importId, ver construirAad) -- GCM ata el ciphertext
// a ese AAD exacto. Si alguien copia el objeto cifrado de una
// importacion a la clave de otra, o intenta descifrarlo declarando un
// empresaId/importId distinto al que se uso para cifrar, `setAAD` no
// coincide y `final()` lanza -- nunca se llega a exponer contenido de
// una empresa bajo el contexto de otra, aunque alguien lograra
// intercambiar los bytes del objeto en R2 (fuera del alcance de esta
// capa, pero mitigado igual).
//
// "Verificar la etiqueta de autenticacion antes de procesar el
// contenido": las funciones de descifrado nunca devuelven bytes al
// llamador antes de que `decipher.final()` valide el authTag -- si el
// authTag no coincide (contenido alterado, DEK incorrecta, o AAD
// incorrecto), `final()` lanza y la funcion nunca llega al `return` --
// el llamador jamas recibe contenido sin validar, ni parcial ni
// completo.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const LONGITUD_IV = 12; // recomendado por NIST SP 800-38D para GCM
const LONGITUD_CLAVE = 32; // AES-256
const LONGITUD_AUTH_TAG = 16;

// Version del formato de envoltorio (ver cabecera) -- se guarda junto a
// cada fila (ImportacionCsv.cifradoVersion) para poder cambiar el
// formato en el futuro (ej. otro algoritmo) sin romper la capacidad de
// descifrar filas ya existentes: el job de descarga elige la logica de
// descifrado segun este numero, nunca asume la version actual.
export const VERSION_FORMATO_ACTUAL = 1;

/** AAD (Additional Authenticated Data) que ata un objeto cifrado a la
 * empresa+importacion para la que se cifro -- ver cabecera del archivo. */
function construirAad(empresaId: string, importId: string): Buffer {
  return Buffer.from(`chainpulse:v${VERSION_FORMATO_ACTUAL}:${empresaId}:${importId}`, "utf8");
}

export function generarDek(): Buffer {
  return randomBytes(LONGITUD_CLAVE);
}

function validarLongitudClave(clave: Buffer, nombreParaError: string): void {
  if (clave.length !== LONGITUD_CLAVE) {
    throw new Error(
      `${nombreParaError} debe decodificar a ${LONGITUD_CLAVE} bytes en base64 (encontrado: ${clave.length})`,
    );
  }
}

/**
 * Cifra el contenido de un archivo con la DEK, atado a empresaId+importId
 * (ver construirAad). Devuelve un buffer autocontenido --
 * [iv][ciphertext][authTag] -- listo para subir a R2 tal cual, sin
 * metadata adicional fuera del propio objeto.
 */
export function cifrarContenido(contenido: Buffer, dek: Buffer, empresaId: string, importId: string): Buffer {
  validarLongitudClave(dek, "dek");
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, dek, iv);
  cipher.setAAD(construirAad(empresaId, importId));
  const ciphertext = Buffer.concat([cipher.update(contenido), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]);
}

/**
 * Reversa de cifrarContenido. Lanza si el authTag no valida -- objeto
 * corrupto/alterado, DEK incorrecta, O empresaId/importId distintos a
 * los que se usaron para cifrar (ver AAD en la cabecera). El contenido
 * decifrado nunca se devuelve si esta validacion falla.
 */
export function descifrarContenido(objetoCifrado: Buffer, dek: Buffer, empresaId: string, importId: string): Buffer {
  validarLongitudClave(dek, "dek");
  if (objetoCifrado.length < LONGITUD_IV + LONGITUD_AUTH_TAG) {
    throw new Error("Objeto cifrado invalido: demasiado corto para contener iv+authTag");
  }
  const iv = objetoCifrado.subarray(0, LONGITUD_IV);
  const authTag = objetoCifrado.subarray(objetoCifrado.length - LONGITUD_AUTH_TAG);
  const ciphertext = objetoCifrado.subarray(LONGITUD_IV, objetoCifrado.length - LONGITUD_AUTH_TAG);
  const decipher = createDecipheriv(ALGORITMO, dek, iv);
  decipher.setAAD(construirAad(empresaId, importId));
  decipher.setAuthTag(authTag);
  // decipher.final() valida el authTag (y por lo tanto el AAD) -- si no
  // coincide, lanza aca y Buffer.concat/return nunca se ejecutan.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export interface DekEnvuelta {
  dekCifrada: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/** Envuelve (cifra) la DEK con una clave maestra -- esto es lo unico que
 * se persiste en Postgres (ImportacionCsv.cifradoDek*), junto con
 * `claveId` (ImportacionCsv.cifradoClaveId) para saber con cual clave
 * maestra se envolvio, sin importar cuantas rotaciones hayan pasado
 * despues. */
export function envolverDek(dek: Buffer, claveMaestra: Buffer, empresaId: string, importId: string): DekEnvuelta {
  validarLongitudClave(dek, "dek");
  validarLongitudClave(claveMaestra, "claveMaestra");
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, claveMaestra, iv);
  cipher.setAAD(construirAad(empresaId, importId));
  const dekCifrada = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    dekCifrada: dekCifrada.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/** Reversa de envolverDek. */
export function desenvolverDek(envuelta: DekEnvuelta, claveMaestra: Buffer, empresaId: string, importId: string): Buffer {
  validarLongitudClave(claveMaestra, "claveMaestra");
  const iv = Buffer.from(envuelta.iv, "base64");
  const authTag = Buffer.from(envuelta.authTag, "base64");
  const dekCifrada = Buffer.from(envuelta.dekCifrada, "base64");
  const decipher = createDecipheriv(ALGORITMO, claveMaestra, iv);
  decipher.setAAD(construirAad(empresaId, importId));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(dekCifrada), decipher.final()]);
}

// -- Resolucion de claves maestras por id (rotacion, ver ADR-0006) --
//
// R2_ENCRYPTION_KEY_ACTIVA / R2_ENCRYPTION_KEY_ACTIVA_ID: la clave con la
// que se envuelven las DEKs NUEVAS. R2_ENCRYPTION_KEYS_ANTERIORES: JSON
// `{ [claveId]: claveBase64 }` de claves retiradas que todavia hace
// falta conservar para desenvolver DEKs viejas -- nunca se borra una
// entrada de aca hasta haber re-envuelto (o purgado) todas las filas que
// la referencian, ver SEGURIDAD-credenciales.md.

export interface ClaveMaestraActiva {
  id: string;
  clave: Buffer;
}

/** Lee y valida la clave maestra ACTIVA (para envolver DEKs nuevas). */
export function obtenerClaveMaestraActiva(): ClaveMaestraActiva {
  const id = process.env.R2_ENCRYPTION_KEY_ACTIVA_ID;
  const valor = process.env.R2_ENCRYPTION_KEY_ACTIVA;
  if (!id || !valor) {
    throw new Error("Faltan R2_ENCRYPTION_KEY_ACTIVA/R2_ENCRYPTION_KEY_ACTIVA_ID en .env");
  }
  const clave = Buffer.from(valor, "base64");
  validarLongitudClave(clave, "R2_ENCRYPTION_KEY_ACTIVA");
  return { id, clave };
}

/** Busca una clave maestra por id entre la activa y las anteriores --
 * usar para desenvolver una DEK existente (ImportacionCsv.cifradoClaveId
 * puede apuntar a una clave ya rotada, no necesariamente la activa). */
export function obtenerClaveMaestraPorId(claveId: string): Buffer {
  const activa = obtenerClaveMaestraActiva();
  if (claveId === activa.id) {
    return activa.clave;
  }
  const crudo = process.env.R2_ENCRYPTION_KEYS_ANTERIORES;
  const anteriores: Record<string, string> = crudo ? JSON.parse(crudo) : {};
  const valor = anteriores[claveId];
  if (!valor) {
    throw new Error(
      `No se encontro la clave maestra "${claveId}" (ni activa ni en R2_ENCRYPTION_KEYS_ANTERIORES) -- ver SEGURIDAD-credenciales.md antes de asumir que el archivo es irrecuperable.`,
    );
  }
  const clave = Buffer.from(valor, "base64");
  validarLongitudClave(clave, `R2_ENCRYPTION_KEYS_ANTERIORES["${claveId}"]`);
  return clave;
}
