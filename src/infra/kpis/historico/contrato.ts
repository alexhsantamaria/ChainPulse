// Infraestructura (PURA -- sin Prisma) -- contrato normalizado de
// lectura de histórico, compartido entre orígenes de persistencia
// distintos (ObservacionKpi para OTIF/Fill Rate, ImportacionCsv +
// ObservacionCobertura para Cobertura). Segundo corte de PR-A, ver
// diseno-pr-a-segundo-corte-contrato-historico-2026-11-23.md (Proyecto,
// 2026-11-23).
//
// Este archivo es EXCLUSIVAMENTE el tipo de lectura y su vocabulario de
// estado -- no calcula nada ni decide ninguna recomendacion: eso sigue
// siendo responsabilidad de analisisDecision.ts, cuyos 2 algoritmos (por
// valor para ObservacionKpi, por tasa para Cobertura) este corte
// deliberadamente NO unifica (ver la Sección 7 del diseño, "riesgo de
// unificación prematura").
import type { HistoricoPipelineKpi } from "../catalogoPipelineKpi";

export type { HistoricoPipelineKpi };

// Mismo vocabulario de 4 valores que ya usan EstadoVisualizacionObservacionKpi
// (3 de los 4) y EstadoVisualizacionFilaCobertura (los 4) en
// estadoVisualizacion.ts -- declarado aca como su propio tipo (no
// reexportado de ninguno de los 2) porque "un punto de histórico" no es
// ni "un valor de ObservacionKpi" ni "una fila de Cobertura": es un
// concepto de nivel superior que cada adaptador mapea desde su propio
// vocabulario de origen, nunca reinterpretando ni inventando una
// categoría nueva.
export type EstadoDatoNormalizado = "SIN_DATOS" | "CERO_REAL" | "VALOR" | "CON_ERRORES";

export interface PuntoHistoricoKpi {
  id: string;
  // `Date | null`, NO `Date` -- corrección sobre el diseño original
  // (2026-11-23), descubierta al implementar el adaptador de Cobertura:
  // ImportacionCsv.periodoReferenciaConsumoInicio/Fin son columnas
  // nullable (ver cargarHistoricoResumenCobertura() en
  // cobertura/resumenCobertura.ts) y derivarOrigenActual.ts construye a
  // propósito un PuntoResumenCobertura con ambas en null cuando no las
  // necesita -- un contrato con fechas obligatorias habría forzado a
  // fabricar un valor que el dominio de Cobertura no siempre tiene.
  periodoInicio: Date | null;
  periodoFin: Date | null;
  valor: number | null;
  estado: EstadoDatoNormalizado;
  fuente: HistoricoPipelineKpi;
  ruleVersion: string | null;
}
