// Limites explicitos para la declaracion de OTIF Proveedor, Incremento 5
// PR3 (Alex, 2026-11-18). Mismo criterio de "proponer valores concretos"
// que limitesDeclaracionOtif.ts (OTIF normal, 2026-10-10) -- punto de
// partida razonado, no una medicion real de uso todavia.
//
// Diferencia deliberada con limitesDeclaracionOtif.ts: el modo "pegado"
// de este catalogo admite VARIOS proveedores en la misma tabla pegada
// (Alex, 2026-11-18, punto 10) -- el mismo techo de filas totales (no un
// techo separado "por proveedor") ya alcanza para varios proveedores
// razonables, sin introducir un segundo numero a mantener sincronizado.

/** 2.000 filas totales (sumando todas las filas de TODOS los proveedores
 * de una misma tabla pegada) -- mismo numero y mismo razonamiento que
 * MAX_FILAS_PEGADO_OTIF: un pegado legitimo de un piloto, aunque mezcle
 * varios proveedores, no se acerca a este techo. */
export const MAX_FILAS_PEGADO_OTIF_PROVEEDOR = 2_000;

/** 1 MB -- mismo razonamiento que MAX_TAMANO_BODY_OTIF_BYTES: el payload
 * de este endpoint tiene un campo mas por fila (proveedorAlias) que el
 * de OTIF normal, pero sigue siendo un puñado de campos cortos; 2.000
 * filas con un alias corto adicional siguen muy por debajo del limite de
 * plataforma (4.5 MB, Vercel Hobby). Aplicado con
 * leerCuerpoJsonLimitado(), nunca solo con Content-Length (mismo criterio
 * que OTIF, correccion de Alex 2026-10-10). */
export const MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES = 1 * 1024 * 1024;

/** 100 caracteres -- mismo limite y mismo razonamiento que
 * MAX_LONGITUD_PEDIDO: un alias de proveedor real no se acerca a este
 * largo; tope de cordura contra un campo corrupto, nunca un rechazo de
 * un alias legitimo. Aplicado sobre el alias YA NORMALIZADO (visible,
 * recortado y con espacios colapsados -- src/domain/proveedorAlias.ts),
 * nunca sobre el texto crudo con espacios de mas. */
export const MAX_LONGITUD_PROVEEDOR_ALIAS = 100;

export interface ResultadoValidacionLimiteFilasOtifProveedor {
  valido: boolean;
  motivo?: "DEMASIADAS_FILAS";
  limite?: number;
  recibidas?: number;
}

/** Pura -- valida el NUMERO TOTAL de filas de un payload "pegado" (todas
 * las filas de todos los proveedores juntas) contra
 * MAX_FILAS_PEGADO_OTIF_PROVEEDOR, antes de procesar ninguna fila
 * individual. */
export function validarLimiteFilasPegadoOtifProveedor(numeroFilas: number): ResultadoValidacionLimiteFilasOtifProveedor {
  if (numeroFilas > MAX_FILAS_PEGADO_OTIF_PROVEEDOR) {
    return { valido: false, motivo: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_OTIF_PROVEEDOR, recibidas: numeroFilas };
  }
  return { valido: true };
}
