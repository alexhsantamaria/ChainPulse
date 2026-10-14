// Limites explicitos para la declaracion de Fill Rate, nivel 1 (manual) y
// nivel 2 (pegado) -- Incremento 4 Bloque B, siguiente KPI despues de OTIF
// (Alex, 2026-10-14, auditoria-comparativa-8-kpis-pendientes-2026-10-14.md
// recomendo Fill Rate como el de menor riesgo tecnico de los 8 KPIs sin
// flujo completo: sin fechas ni zona horaria, misma forma `calcularRatio`
// que OTIF).
//
// Mismo criterio que limitesDeclaracionOtif.ts (reutilizado, no copiado
// sin pensar): la declaracion es SINCRONICA dentro del mismo POST
// (previsualizar/confirmar), nunca pasa por pg-boss ni R2 -- un techo bajo
// es correcto aca, no una medida provisoria. NO se reutiliza
// limitesImportacionCsv.ts por el mismo motivo que limitesDeclaracionOtif.ts
// no lo hace: ese modulo esta dimensionado para un archivo que entra por
// R2 y se procesa en un job de pg-boss, fuera del ciclo de vida de un
// Route Handler.
//
// A diferencia de OTIF, Fill Rate (`FilaFillRate { sku, pedido, solicitado,
// servido }`, src/engine/kpis/fillRate.ts) no tiene ningun campo de fecha
// -- los limites de aca no necesitan ningun equivalente a
// MAX_LONGITUD_PEDIDO para una fecha, solo para los dos identificadores de
// texto (`sku`, `pedido`).

/** 2.000 filas -- mismo numero y mismo razonamiento que
 * MAX_FILAS_PEGADO_OTIF: generoso para un pegado manual desde una hoja de
 * calculo, muy por debajo de cualquier preocupacion de tiempo de computo
 * (una sola pasada O(n) sin IO por fila). */
export const MAX_FILAS_PEGADO_FILL_RATE = 2_000;

/** 1 MB -- mismo numero que MAX_TAMANO_BODY_OTIF_BYTES. El payload JSON de
 * este endpoint es incluso mas chico por fila que el de OTIF (4 campos sin
 * fechas, en vez de 5 campos con 2 fechas): 2.000 filas quedan por debajo
 * de los 200-300 KB que ya ocupaba el equivalente de OTIF, asi que 1 MB
 * deja el mismo margen real sin acercarse al limite de body de un Route
 * Handler de Vercel.
 *
 * Mismo criterio que OTIF (Alex 2026-10-10): este limite NUNCA se verifica
 * solo contra el header Content-Length -- las rutas (previsualizar/
 * confirmar) aplican este numero con `leerCuerpoJsonLimitado()`
 * (src/infra/http/leerCuerpoJsonLimitado.ts), que SIEMPRE cuenta los bytes
 * reales del stream a medida que llegan. */
export const MAX_TAMANO_BODY_FILL_RATE_BYTES = 1 * 1024 * 1024;

/** 100 caracteres -- mismo tope de cordura que MAX_LONGITUD_PEDIDO de
 * OTIF, aplicado aca a los dos identificadores de texto de una fila de
 * Fill Rate (`sku` y `pedido`): ninguno de los dos se acerca a este largo
 * en un caso real, sirve de resguardo contra un campo corrupto o pegado
 * desde la columna equivocada. */
export const MAX_LONGITUD_IDENTIFICADOR_FILL_RATE = 100;
