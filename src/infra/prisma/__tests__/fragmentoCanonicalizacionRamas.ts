// Helper compartido -- extraido de
// reconstruccionRlsAuthGrantsRamas.integration.test.ts (RONDA 20, Alex
// 2026-10-07) para que la logica de extraccion del fragmento Seccion
// A+B sea verificable con pruebas locales (sin conexion real), en
// fragmentoCanonicalizacionRamas.test.ts. Se importa UNICAMENTE desde
// esos dos archivos. Mismo criterio que
// esquemaDescartableRamas.ts (Ronda 19): logica pura, testeable con
// texto sintetico, separada del acceso a filesystem/Postgres real.

// Marcadores COMPLETOS -- con el prefijo de comentario SQL "--"
// incluido. RONDA 20 (Alex, 2026-10-07): antes de esta correccion, la
// busqueda usaba el texto "SECCION A"/"SECCION C" SIN el prefijo "-- ",
// lo que dejaba "SECCION A" como texto SQL EJECUTABLE (bare, invalido)
// al principio del fragmento extraido, en vez de preservarlo como
// comentario -- el "--" que lo convierte en comentario quedaba cortado
// FUERA del fragmento. Buscar el marcador completo corrige esto.
export const MARCADOR_SECCION_A = "-- SECCION A";
export const MARCADOR_SECCION_C = "-- SECCION C";

/**
 * Extrae, de un texto SQL completo, el fragmento desde el marcador
 * COMPLETO "-- SECCION A" (inclusive -- preserva el "--" como
 * comentario SQL valido) hasta justo ANTES del marcador completo
 * "-- SECCION C" (exclusive) -- Secciones A y B completas, nunca la C.
 * Envuelve el resultado en su propio BEGIN;/COMMIT;.
 *
 * Aborta con un error fijo (MARCADORES_SECCION_INVALIDOS) -- nunca
 * devuelve un fragmento parcial o ambiguo -- si el marcador de apertura
 * o cierre falta, aparece mas de una vez, o si el de cierre aparece
 * ANTES o en la misma posicion que el de apertura (marcadores
 * desordenados).
 */
export function extraerFragmentoDeTexto(sql: string): string {
  const idxA = sql.indexOf(MARCADOR_SECCION_A);
  const idxASegunda = idxA === -1 ? -1 : sql.indexOf(MARCADOR_SECCION_A, idxA + 1);
  const idxC = sql.indexOf(MARCADOR_SECCION_C);
  const idxCSegunda = idxC === -1 ? -1 : sql.indexOf(MARCADOR_SECCION_C, idxC + 1);

  if (idxA === -1 || idxC === -1 || idxASegunda !== -1 || idxCSegunda !== -1 || idxC <= idxA) {
    throw new Error(
      `MARCADORES_SECCION_INVALIDOS: los marcadores completos "${MARCADOR_SECCION_A}" y "${MARCADOR_SECCION_C}" deben aparecer EXACTAMENTE una vez cada uno, y "${MARCADOR_SECCION_C}" debe aparecer DESPUES de "${MARCADOR_SECCION_A}" -- revisar si la migracion cambio de forma incompatible con este extractor.`,
    );
  }

  const fragmento = sql.slice(idxA, idxC);
  return `BEGIN;\n\n${fragmento}\nCOMMIT;\n`;
}
