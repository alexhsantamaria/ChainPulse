// Infraestructura (PURA -- sin Prisma) -- clasifica, para mostrar en
// pantalla, el estado de un resultado de KPI ya persistido. Incremento 4
// PR1 (Alex, 2026-11-06): "distingue explícitamente entre 'sin datos',
// cero real, procesamiento pendiente y procesamiento con errores".
//
// Deliberadamente sin import de Prisma/tenantClient -- mismo motivo que
// el resto de src/infra/kpis/*/declarar.ts (ver su comentario de
// cabecera): funciones puras, probadas sin ninguna base de datos. Los
// 4 tipos de enum que consume (EstadoObservacionCobertura,
// EstadoImportacion) se importan SOLO como tipo desde "@prisma/client"
// -- un import de tipo no arrastra la construccion del singleton real de
// PrismaClient (a diferencia de importar "./client" o "./tenantClient"),
// asi que es seguro cargarlo en una prueba unitaria sin "prisma
// generate" corrido contra una base real.
import type { EstadoObservacionCobertura, EstadoImportacion } from "@prisma/client";

// -- ObservacionKpi (OTIF, Fill Rate -- Incremento 4 Bloque B) --
//
// `valor` es null UNICAMENTE cuando no hubo ninguna fila evaluable al
// confirmar (src/engine/kpis/constantes.ts, ResultadoCalculoKpi) --
// ObservacionKpi.valor hereda exactamente esa misma regla (persistido tal
// cual sale del motor, nunca reinterpretado). No existe un estado de
// "procesamiento pendiente" ni "con errores" para este KPI: previsualizar
// y confirmar calculan y persisten de forma SINCRONA dentro del mismo
// POST (ver src/infra/kpis/otif/persistir.ts, src/infra/kpis/fillRate/
// persistir.ts) -- no hay cola de trabajos ni reintento de por medio, asi
// que una ObservacionKpi ya persistida siempre esta en uno de estos dos
// estados, nunca "pendiente" ni "con errores".
export type EstadoVisualizacionObservacionKpi = "SIN_DATOS" | "CERO_REAL" | "VALOR";

export function clasificarValorObservacionKpi(valor: number | null): EstadoVisualizacionObservacionKpi {
  if (valor === null) return "SIN_DATOS";
  if (valor === 0) return "CERO_REAL";
  return "VALOR";
}

// -- ObservacionCobertura (Incremento 4 Bloque B) --
//
// Mapeo de los 5 estados de fila de EstadoObservacionCobertura (ver
// src/engine/kpis/cobertura.ts, evaluarFila(), para el razonamiento
// completo de cada regla) a las 4 categorias que pidio Alex:
//   - CALCULADA + coberturaDias === 0 -> CERO_REAL (regla 2 del motor:
//     "consumo positivo e inventario cero -> 0 dias, resultado real y
//     grave" -- nunca se confunde con falta de datos).
//   - CALCULADA + coberturaDias > 0 -> VALOR.
//   - SIN_CONSUMO_REFERENCIA / DATOS_INCOMPLETOS -> SIN_DATOS (sin
//     resultado numerico por falta de un dato de entrada).
//   - VALOR_NEGATIVO / UNIDADES_INCOMPATIBLES -> CON_ERRORES (datos
//     presentes pero invalidos/contradictorios, señalados para revision).
// DUPLICADO (motor) no aparece aca -- el motor ya excluye los duplicados
// en conflicto ANTES de persistir (ver el comentario de
// EstadoObservacionCobertura en prisma/schema.prisma), asi que el enum de
// base de datos no lo incluye.
export type EstadoVisualizacionFilaCobertura = "SIN_DATOS" | "CERO_REAL" | "CON_ERRORES" | "VALOR";

export function clasificarFilaCobertura(
  estado: EstadoObservacionCobertura,
  coberturaDias: number | null,
): EstadoVisualizacionFilaCobertura {
  if (estado === "CALCULADA") {
    return coberturaDias === 0 ? "CERO_REAL" : "VALOR";
  }
  if (estado === "SIN_CONSUMO_REFERENCIA" || estado === "DATOS_INCOMPLETOS") {
    return "SIN_DATOS";
  }
  // VALOR_NEGATIVO | UNIDADES_INCOMPATIBLES
  return "CON_ERRORES";
}

// Motivo legible por fila -- para mostrar junto al estado, no solo la
// etiqueta generica (ej. distinguir "sin consumo de referencia" de "datos
// incompletos", ambos SIN_DATOS). Texto consistente con las advertencias
// que ya genera calcularCobertura() en src/engine/kpis/cobertura.ts,
// adaptado a una sola fila en vez de un resumen agregado.
export function motivoFilaCobertura(estado: EstadoObservacionCobertura): string | null {
  switch (estado) {
    case "SIN_CONSUMO_REFERENCIA":
      return "Sin consumo diario esperado -- no se calcula cobertura para esta fila.";
    case "DATOS_INCOMPLETOS":
      return "Inventario o consumo faltante.";
    case "VALOR_NEGATIVO":
      return "Inventario o consumo con valor negativo -- señalado para revisión.";
    case "UNIDADES_INCOMPATIBLES":
      return "Unidades incompatibles entre inventario y consumo diario.";
    default:
      return null;
  }
}

// -- ImportacionCsv (Incremento 4 Bloque B, Cobertura) --
//
// A diferencia de ObservacionKpi, una importacion SI tiene un paso de
// procesamiento asincrono real (pg-boss, ver src/infra/kpis/cobertura/
// job.ts) -- por eso aca SI existen los 4 estados que pidio Alex.
// `procesadaEn` es la marca de "termino con exito" (ver su comentario en
// prisma/schema.prisma): nunca se setea en un fallo definitivo.
export type EstadoVisualizacionImportacion =
  | "PENDIENTE_REVISION"
  | "PROCESANDO"
  | "PROCESADA"
  | "CON_ERRORES"
  | "DESCARTADA"
  | "INCONSISTENTE";

export function clasificarImportacion(
  estado: EstadoImportacion,
  confirmadaEn: Date | null,
  procesadaEn: Date | null,
): EstadoVisualizacionImportacion {
  if (estado === "PENDIENTE_REVISION") return "PENDIENTE_REVISION";
  if (estado === "DESCARTADA") return "DESCARTADA";
  if (estado === "ERROR") return "CON_ERRORES";
  // CONFIRMADA -- la transaccion de confirmar (ver .../confirmar/route.ts,
  // cabecera punto 1) escribe estado="CONFIRMADA" SIEMPRE junto con
  // confirmadaEn en la MISMA transaccion -- no deberia existir una fila
  // CONFIRMADA sin confirmadaEn. Correccion de Alex (2026-11-06, antes del
  // commit de PR1): la version anterior de esta funcion, al no tener
  // confirmadaEn, caia al "return PROCESADA" de abajo por descarte -- un
  // estado inconsistente terminaba mostrandose como un resultado exitoso y
  // confiable. Ahora se trata como su propia categoria, nunca como
  // PROCESADA (ni aunque procesadaEn este presente -- procesar sin haber
  // confirmado primero es la MISMA violacion de invariante).
  if (!confirmadaEn) return "INCONSISTENTE";
  if (!procesadaEn) return "PROCESANDO";
  return "PROCESADA";
}

// Resumen agregado de filas de Cobertura para UNA importacion -- "filas
// validas/excluidas" que pidio Alex para el detalle (punto 4), sin volver
// a calcular nada que el motor (src/engine/kpis/cobertura.ts) ya decidio:
// toma los conteos por estado que ya salen de un groupBy() sobre
// ObservacionCobertura (ver cobertura/importaciones/[id]/page.tsx) y los
// conteos de CALCULADA con 0 dias (necesarios para separar CERO_REAL de
// VALOR dentro de un mismo estado de BD, igual que clasificarFilaCobertura
// arriba) -- funcion pura, sin ninguna consulta propia, para poder
// probarla sin levantar Prisma.
//
// "Validas" = tienen un resultado numerico (CALCULADA, sea 0 o positivo).
// "Excluidas" = sin resultado numerico, por falta de datos o por un dato
// invalido/contradictorio señalado para revision.
export interface ResumenFilasCobertura {
  valor: number;
  ceroReal: number;
  sinDatos: number;
  conErrores: number;
  total: number;
}

export function resumirFilasCobertura(
  porEstado: Partial<Record<EstadoObservacionCobertura, number>>,
  calculadaConCeroDias: number,
): ResumenFilasCobertura {
  const calculada = porEstado.CALCULADA ?? 0;
  const sinConsumo = porEstado.SIN_CONSUMO_REFERENCIA ?? 0;
  const datosIncompletos = porEstado.DATOS_INCOMPLETOS ?? 0;
  const valorNegativo = porEstado.VALOR_NEGATIVO ?? 0;
  const unidadesIncompatibles = porEstado.UNIDADES_INCOMPATIBLES ?? 0;

  const ceroReal = calculadaConCeroDias;
  const valor = calculada - ceroReal;
  const sinDatos = sinConsumo + datosIncompletos;
  const conErrores = valorNegativo + unidadesIncompatibles;

  return { valor, ceroReal, sinDatos, conErrores, total: calculada + sinDatos + conErrores };
}

// -- Alcance de PR1 (Incremento 4) --
//
// Detalle duradero de observaciones solo para OTIF y Fill Rate -- los 2
// KPIs con flujo de ingesta completo hoy ademas de Cobertura (que tiene su
// propia pagina de resultado, distinta por su forma de datos por SKU, ver
// cobertura/importaciones/[id]/page.tsx). Los 7 KPIs restantes (Stockout,
// Lead time, Variabilidad de lead time, OTIF proveedor, Tiempo de
// deteccion/decision/recuperacion) no tienen ningun flujo de ingesta
// propio todavia (ver auditoria-incremento4-kpis-2026-11-06.md) -- esta
// funcion es la UNICA puerta que decide que codigo puede abrir la pagina
// de detalle generica, para que una futura adicion de KPI no quede
// expuesta por accidente antes de construirle su propio flujo completo.
const CODIGOS_CON_DETALLE_HABILITADO = new Set(["OTIF", "FILL_RATE"]);

export function esCodigoConDetalleHabilitado(codigo: string): boolean {
  return CODIGOS_CON_DETALLE_HABILITADO.has(codigo);
}
