// Limites explicitos para la declaracion OTIF nivel 2 (modo "pegado"),
// Incremento 4 Bloque B (correccion de Alex, 2026-10-10: "si el
// repositorio no tiene limites equivalentes que puedan reutilizarse,
// proponé valores concretos antes de implementarlos").
//
// NO se reutiliza limitesImportacionCsv.ts (MAX_FILAS=10.000,
// MAX_TAMANO_ARCHIVO_BYTES=4MB): ese modulo esta dimensionado para un
// archivo CSV que entra por R2 y se procesa en un job de pg-boss FUERA
// del ciclo de vida de un Route Handler (lotes de 500 filas via
// tenantTransaction(), presupuesto de 60s de Vercel Hobby -- ver su
// cabecera). La declaracion OTIF nivel 2 es SINCRONICA dentro de la
// misma peticion POST (previsualizar/confirmar): el payload entra
// completo en el body de la peticion, se valida/calcula en memoria (una
// sola pasada O(n), sin IO por fila) y, si se confirma, persiste UNA
// sola fila agregada (no una fila por pedido) -- un techo mucho mas bajo
// es lo correcto aca, no una medida provisoria a ajustar "cuando haya
// tiempo".
//
// Estos numeros son un punto de partida razonado, no una medicion real
// de uso del piloto -- revisables en un solo lugar si la experiencia de
// uso real los muestra muy bajos o muy altos (mismo criterio que
// limitesImportacionCsv.ts).

/** 2.000 filas -- generoso para un pegado manual desde una hoja de
 * calculo (un piloto de un periodo/cadena razonablemente no supera unos
 * pocos miles de pedidos) y muy por debajo de cualquier preocupacion de
 * tiempo de computo (el calculo es una sola pasada O(n) sin IO por fila)
 * o de tamano de body (ver MAX_TAMANO_BODY_OTIF_BYTES). */
export const MAX_FILAS_PEGADO_OTIF = 2_000;

/** 1 MB -- el payload JSON de este endpoint son solo 5 campos cortos por
 * fila (pedido, 2 fechas ISO, 2 numeros): incluso 2.000 filas (el techo
 * de arriba) ocupan del orden de 200-300 KB como JSON, asi que 1 MB deja
 * margen real sin acercarse al limite de body de un Route Handler de
 * Vercel (4.5 MB en el plan Hobby, ya citado en limitesImportacionCsv.ts)
 * -- un payload que se acerca a ese limite de plataforma casi seguro no
 * es una tabla pegada legitima.
 *
 * CORREGIDO 2026-10-10 (Alex): este limite NUNCA se verifica solo contra
 * el header Content-Length -- un header ausente, invalido, o que declara
 * menos bytes de los que en verdad vienen, dejaria pasar un body sin
 * limite real a `request.json()`. Las rutas (previsualizar/confirmar)
 * aplican este numero con `leerCuerpoJsonLimitado()`
 * (src/infra/http/leerCuerpoJsonLimitado.ts), que SIEMPRE cuenta los
 * bytes reales del stream a medida que llegan y cancela la lectura en
 * cuanto se supera el limite -- Content-Length, cuando esta presente y
 * ya lo supera, solo sirve de rechazo temprano para evitar leer el
 * stream en el caso obvio. MAX_FILAS_PEGADO_OTIF y MAX_LONGITUD_PEDIDO
 * siguen aplicando ademas, como respaldo determinista sobre el contenido
 * ya parseado. */
export const MAX_TAMANO_BODY_OTIF_BYTES = 1 * 1024 * 1024;

/** 100 caracteres -- un numero/codigo de pedido real (alfanumerico, con
 * guiones) no se acerca a este largo; sirve de tope de cordura contra un
 * campo corrupto o pegado por error desde la columna equivocada, sin
 * arriesgar rechazar un codigo de pedido legitimo. */
export const MAX_LONGITUD_PEDIDO = 100;

export interface ResultadoValidacionLimiteFilasOtif {
  valido: boolean;
  motivo?: "DEMASIADAS_FILAS";
  limite?: number;
  recibidas?: number;
}

/** Pura -- valida el NUMERO de filas de un payload "pegado" contra
 * MAX_FILAS_PEGADO_OTIF, antes de procesar ninguna fila individual. */
export function validarLimiteFilasPegadoOtif(numeroFilas: number): ResultadoValidacionLimiteFilasOtif {
  if (numeroFilas > MAX_FILAS_PEGADO_OTIF) {
    return { valido: false, motivo: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_OTIF, recibidas: numeroFilas };
  }
  return { valido: true };
}
