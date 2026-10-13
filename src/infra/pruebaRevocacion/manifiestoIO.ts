// Infraestructura (solo para las herramientas de scripts/) -- E/S de
// archivos del manifiesto, con manejo de error de codigo fijo (Alex,
// 2026-10-04, punto 2 de la segunda correccion: "Cubrí también errores
// de ... archivos"). Separado de manifiesto.ts (puro, sin fs) para que
// ese archivo siga probandose sin mockear "fs".
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { logError } from "../log";
import { carpetaManifiestos, rutaManifiesto, validarEstructuraManifiesto, type ManifiestoPrueba } from "./manifiesto";

/**
 * Lee y valida la ESTRUCTURA de un manifiesto desde disco. Nunca
 * reenvia el error real de "fs" (podria incluir la ruta completa del
 * sistema de archivos) ni el contenido crudo si no es JSON valido.
 */
export function leerManifiesto(ruta: string, contexto: string): ManifiestoPrueba {
  let crudo: string;
  try {
    crudo = readFileSync(ruta, "utf-8");
  } catch {
    logError(contexto, "MANIFIESTO_ILEGIBLE");
    throw new Error("MANIFIESTO_ILEGIBLE");
  }

  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    logError(contexto, "MANIFIESTO_ILEGIBLE");
    throw new Error("MANIFIESTO_ILEGIBLE");
  }

  return validarEstructuraManifiesto(parseado);
}

/**
 * Escribe el manifiesto de una siembra nueva -- carpeta fuera del
 * repositorio, escritura EXCLUSIVA ("wx": nunca sobrescribe uno
 * existente). Devuelve la ruta final. Si falla, el llamador (la
 * siembra) todavia tiene el objeto "manifiesto" en memoria -- lo que le
 * toca a este modulo es solo no tapar ese dato con un error crudo de
 * "fs"; el llamador decide como exponerlo para recuperacion manual.
 */
export function escribirManifiesto(runId: string, manifiesto: ManifiestoPrueba, contexto: string): string {
  try {
    mkdirSync(carpetaManifiestos(), { recursive: true });
    const ruta = rutaManifiesto(runId);
    writeFileSync(ruta, JSON.stringify(manifiesto, null, 2), { flag: "wx" });
    return ruta;
  } catch {
    logError(contexto, "ERROR_ESCRITURA_MANIFIESTO");
    throw new Error("ERROR_ESCRITURA_MANIFIESTO");
  }
}

/**
 * Borra el archivo del manifiesto -- SOLO se llama despues de confirmar
 * que la limpieza de la base ya tuvo exito (ver limpiarPruebaRevocacion
 * Aislada.ts / orquestarLimpieza.ts). Si el borrado del archivo en si
 * falla, los datos de prueba YA fueron eliminados de la base -- no
 * relanzar como un fallo de la limpieza completa, pero tampoco ocultarlo:
 * se registra con codigo fijo y se devuelve false para que el llamador
 * le diga a quien corrio el script que borre el archivo a mano.
 */
export function borrarManifiesto(ruta: string, contexto: string): boolean {
  try {
    unlinkSync(ruta);
    return true;
  } catch {
    logError(contexto, "ERROR_BORRADO_MANIFIESTO");
    return false;
  }
}
