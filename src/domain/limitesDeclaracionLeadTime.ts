// Limites explicitos para la declaracion Lead time nivel 2 (modo
// "pegado"), KPI #1 del pipeline de los 6 pendientes (diseno aprobado
// 2026-11-27, docs/engineering/diseno-leadtime-implementacion-2026-11-27.md).
//
// Mismo criterio que limitesDeclaracionOtif.ts (no se reutiliza
// limitesImportacionCsv.ts: esta declaracion es SINCRONICA dentro de la
// misma peticion POST, un payload mucho mas chico que un CSV por job).
// Lead time tiene 3 campos por fila (proceso, inicio, fin) en vez de los
// 5 de OTIF (pedido, fechaPrometida, fechaReal, cantidadPedida,
// cantidadEntregada) -- el payload JSON es mas liviano por fila, pero se
// mantienen los mismos techos de partida que OTIF (no una medicion real
// de uso todavia) para no introducir un criterio distinto sin evidencia.

/** 2.000 filas -- mismo razonamiento que MAX_FILAS_PEGADO_OTIF: generoso
 * para un pegado manual desde una hoja de calculo, muy por debajo de
 * cualquier preocupacion de tiempo de computo (una sola pasada O(n)). */
export const MAX_FILAS_PEGADO_LEAD_TIME = 2_000;

/** 1 MB -- mismo razonamiento que MAX_TAMANO_BODY_OTIF_BYTES. Una fila de
 * Lead time (proceso, 2 fechas ISO) es mas liviana que una fila OTIF (5
 * campos), asi que 1 MB deja margen de sobra para MAX_FILAS_PEGADO_LEAD_TIME
 * filas sin acercarse al limite de body de un Route Handler de Vercel. */
export const MAX_TAMANO_BODY_LEAD_TIME_BYTES = 1 * 1024 * 1024;

/** 200 caracteres -- un nombre de proceso libre ("Recepcion de
 * mercaderia", "Picking y packing") es una etiqueta descriptiva, no un
 * codigo corto como el `pedido` de OTIF (100 caracteres); 200 da margen
 * sin arriesgar un campo corrupto o pegado desde la columna equivocada. */
export const MAX_LONGITUD_PROCESO = 200;

export interface ResultadoValidacionLimiteFilasLeadTime {
  valido: boolean;
  motivo?: "DEMASIADAS_FILAS";
  limite?: number;
  recibidas?: number;
}

/** Pura -- valida el NUMERO de filas de un payload "pegado" contra
 * MAX_FILAS_PEGADO_LEAD_TIME, antes de procesar ninguna fila individual. */
export function validarLimiteFilasPegadoLeadTime(numeroFilas: number): ResultadoValidacionLimiteFilasLeadTime {
  if (numeroFilas > MAX_FILAS_PEGADO_LEAD_TIME) {
    return { valido: false, motivo: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_LEAD_TIME, recibidas: numeroFilas };
  }
  return { valido: true };
}
