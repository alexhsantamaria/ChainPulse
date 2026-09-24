// Limites de tamano/filas para una importacion CSV (Incremento 4, Bloque
// B -- preparacion, no depende de R2). Responde al riesgo ya documentado
// en PLAN-DE-TRABAJO.md: "el job de pg-boss que procesa el CSV corre
// fuera del ciclo de vida de un Route Handler serverless -- hay que
// decidir explicitamente el limite de tamano de archivo y de filas antes
// de que el primer CSV grande tumbe un worker por memoria".
//
// Razonamiento (para que quede documentado el numero, no solo el numero):
//
// El job real corre dentro de src/app/api/internal/jobs/run/route.ts,
// que tiene `maxDuration = 60` (limite duro del plan Hobby de Vercel,
// ver ADR-0004) -- toda una invocacion del job (descarga de R2 + parseo
// + los lotes de tenantTransaction()) tiene que terminar ahi adentro, o
// Vercel corta la ejecucion a mitad de un lote.
//
// La importacion procesa en lotes de ~500 filas por tenantTransaction()
// (PLAN-DE-TRABAJO.md, riesgo de Incremento 4 sobre transacciones
// gigantes) -- cada lote es un viaje de ida y vuelta a Neon (insercion +
// commit), no una operacion gratis. Presupuesto conservador dentro de los
// 60s:
//   - ~15s para descargar el objeto de R2 + parsear el CSV completo con
//     PapaParse (esto sucede una sola vez, no por lote).
//   - ~45s para los lotes de insercion, a ~1.5s por lote de 500 filas
//     (estimacion conservadora para Neon serverless con cold start
//     posible) -- eso da ~30 lotes = ~15.000 filas como techo teorico de
//     lo que UNA sola invocacion del job puede terminar de punta a punta.
//
// Decision (MVP, revisable con datos reales de uso): en vez de construir
// seguimiento de progreso multi-invocacion (una `ImportacionCsv` que
// avanza a lo largo de varios ciclos del cron, con un estado intermedio
// tipo "PROCESANDO_PARCIAL" -- EstadoImportacion no tiene eso hoy, ver
// PLAN-DE-TRABAJO.md Seccion "Cambios de schema concretos" de este
// bloque), se elige un techo MAS BAJO que el teorico de una sola
// invocacion, para que el caso feliz (usuario sube, confirma, el fetch
// inmediato dispara el job) termine de punta a punta en un solo ciclo,
// sin necesitar ese estado intermedio. Un archivo que supere el limite se
// RECHAZA en la previsualizacion, antes de encolar nada, con un mensaje
// claro pidiendo dividirlo -- no se acepta para procesarse "mas lento".
//
// Estos numeros son un punto de partida razonado, no una medicion real
// contra Neon de produccion -- si el uso real muestra que son muy bajos
// (usuarios dividiendo archivos legitimos todo el tiempo) o muy altos
// (el job sigue cortandose a mitad de camino), se ajustan aca, en un solo
// lugar.
//
// CORREGIDO 2026-09-24 -- MAX_TAMANO_ARCHIVO_BYTES bajo de 5 MB a 4 MB tras
// la decision de cifrado de aplicacion (Alex, ver docs/ADR/0006-cifrado-
// r2.md): "cifrar en el servidor antes de subir" significa que el CSV en
// claro ya no sube directo del navegador a R2 via URL prefirmada (el plan
// original de Setup de R2) -- ahora pasa primero por el BODY de un Route
// Handler de Next.js (src/infra/storage/r2.ts), que lo cifra y recien ahi
// lo sube. Eso mete el limite de tamano de body de Vercel en el medio: 4.5
// MB en el plan Hobby (ya citado en PLAN-DE-TRABAJO.md, Setup de R2, para
// justificar por que el flujo original evitaba pasar por el servidor). 4
// MB deja margen real bajo ese techo (overhead de multipart/headers) sin
// acercarse al limite exacto. El descifrado en el job (~4 MB, AES-256-GCM)
// es del orden de milisegundos -- no cambia en nada el presupuesto de 60s
// ya razonado arriba para MAX_FILAS, que se mantiene sin cambios.

/** 4 MB -- bajo el limite de body de un Route Handler de Vercel Hobby (4.5 MB, ver comentario de cabecera) porque el cifrado de aplicacion exige que el CSV pase por el servidor antes de subir a R2. A razon de ~200-300 bytes por fila de CSV (SKU, ubicacion, fecha, par de numeros), sigue dando margen para MAX_FILAS con columnas de texto mas largas de lo esperado. */
export const MAX_TAMANO_ARCHIVO_BYTES = 4 * 1024 * 1024;

/** 10.000 filas -- deliberadamente por debajo del techo teorico (~15.000) de lo que un solo ciclo del job (60s) puede insertar, para dejar margen a la descarga/parseo y a que un lote individual tarde mas de lo estimado. */
export const MAX_FILAS = 10_000;

export interface LimitesArchivoCsv {
  tamanoBytes: number;
  numeroFilas: number;
}

export type MotivoRechazoLimiteCsv = "ARCHIVO_MUY_GRANDE" | "DEMASIADAS_FILAS";

export interface ResultadoValidacionLimitesCsv {
  valido: boolean;
  motivo?: MotivoRechazoLimiteCsv;
  mensaje?: string;
}

/**
 * Valida un archivo CSV contra los limites de tamano/filas de una sola
 * importacion, ANTES de encolar cualquier job -- pura, no toca R2 ni la
 * base de datos. El llamador (la UI de previsualizacion de Bloque B,
 * todavia sin construir) es responsable de contar `numeroFilas` (ej. con
 * `Papa.parse(..., {preview: 0})` o contando lineas) antes de llamar aca.
 */
export function validarLimitesArchivoCsv(limites: LimitesArchivoCsv): ResultadoValidacionLimitesCsv {
  if (limites.tamanoBytes > MAX_TAMANO_ARCHIVO_BYTES) {
    const maxMb = (MAX_TAMANO_ARCHIVO_BYTES / (1024 * 1024)).toFixed(0);
    return {
      valido: false,
      motivo: "ARCHIVO_MUY_GRANDE",
      mensaje: `El archivo supera el limite de ${maxMb} MB. Dividilo en partes mas chicas e importalas por separado.`,
    };
  }
  if (limites.numeroFilas > MAX_FILAS) {
    return {
      valido: false,
      motivo: "DEMASIADAS_FILAS",
      mensaje: `El archivo tiene ${limites.numeroFilas.toLocaleString("es-PE")} filas, el limite es ${MAX_FILAS.toLocaleString("es-PE")}. Dividilo en partes mas chicas e importalas por separado.`,
    };
  }
  return { valido: true };
}
