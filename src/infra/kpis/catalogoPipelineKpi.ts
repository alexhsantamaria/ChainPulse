import { CODIGOS_KPI, type CodigoKpi } from "../../engine/kpis";

export type DireccionKpi = "MAYOR_ES_MEJOR" | "MENOR_ES_MEJOR" | "CONTEXTUAL";
export type PersistenciaPipelineKpi =
  | "OBSERVACION_KPI"
  | "IMPORTACION_COBERTURA"
  | "OBSERVACION_OTIF_PROVEEDOR";
export type DetallePipelineKpi = "OBSERVACION_KPI" | "COBERTURA" | "OTIF_PROVEEDOR";
export type HistoricoPipelineKpi = "OBSERVACION_KPI" | "COBERTURA" | "OTIF_PROVEEDOR";
export type AccionesPipelineKpi = "OBSERVACION_KPI" | "IMPORTACION_CSV";

export interface ConfiguracionPipelineKpi {
  unidad: "PORCENTAJE" | "DIAS" | "HORAS";
  direccion: DireccionKpi;
  persistencia: PersistenciaPipelineKpi | null;
  detalle: DetallePipelineKpi | null;
  historico: HistoricoPipelineKpi | null;
  acciones: AccionesPipelineKpi | null;
}

// Registro exhaustivo de capacidades ya construidas. Un KPI solo puede
// anunciar una capacidad cuando existe su adaptador concreto; `null` es una
// compuerta deliberada, no una inferencia a partir de la unidad o del motor.
export const PIPELINES_KPI = {
  OTIF: {
    unidad: "PORCENTAJE",
    direccion: "MAYOR_ES_MEJOR",
    persistencia: "OBSERVACION_KPI",
    detalle: "OBSERVACION_KPI",
    historico: "OBSERVACION_KPI",
    acciones: "OBSERVACION_KPI",
  },
  FILL_RATE: {
    unidad: "PORCENTAJE",
    direccion: "MAYOR_ES_MEJOR",
    persistencia: "OBSERVACION_KPI",
    detalle: "OBSERVACION_KPI",
    historico: "OBSERVACION_KPI",
    acciones: "OBSERVACION_KPI",
  },
  STOCKOUT: {
    unidad: "PORCENTAJE",
    direccion: "MENOR_ES_MEJOR",
    persistencia: null,
    detalle: null,
    historico: null,
    acciones: null,
  },
  COBERTURA: {
    unidad: "DIAS",
    direccion: "CONTEXTUAL",
    persistencia: "IMPORTACION_COBERTURA",
    detalle: "COBERTURA",
    historico: "COBERTURA",
    acciones: "IMPORTACION_CSV",
  },
  LEAD_TIME: {
    unidad: "DIAS",
    direccion: "MENOR_ES_MEJOR",
    persistencia: "OBSERVACION_KPI",
    detalle: "OBSERVACION_KPI",
    historico: "OBSERVACION_KPI",
    acciones: "OBSERVACION_KPI",
  },
  VARIABILIDAD_LEAD_TIME: {
    unidad: "DIAS",
    direccion: "MENOR_ES_MEJOR",
    persistencia: null,
    detalle: null,
    historico: null,
    acciones: null,
  },
  OTIF_PROVEEDOR: {
    unidad: "PORCENTAJE",
    direccion: "MAYOR_ES_MEJOR",
    persistencia: "OBSERVACION_OTIF_PROVEEDOR",
    detalle: "OTIF_PROVEEDOR",
    // historico: null (corregido 2026-11-23, segundo corte de PR-A) --
    // el primer corte (commit 7224e2c, ya en main) declaraba
    // historico: "OTIF_PROVEEDOR" sin que existiera ningun adaptador ni
    // analisis de historico real para este KPI (ver el comentario de
    // cabecera de app/dashboard/kpis/otif-proveedor/observaciones/[id]/page.tsx:
    // "no tiene relacion... con el historico/analisis de tendencia...
    // Alex no pidio analisis de tendencia... para este catalogo"). Alex
    // confirmo que OTIF Proveedor debe permanecer fuera del historico
    // generico; su persistencia y su detalle dedicados no cambian.
    historico: null,
    acciones: null,
  },
  TIEMPO_DETECCION: {
    unidad: "HORAS",
    direccion: "MENOR_ES_MEJOR",
    persistencia: null,
    detalle: null,
    historico: null,
    acciones: null,
  },
  TIEMPO_DECISION: {
    unidad: "HORAS",
    direccion: "MENOR_ES_MEJOR",
    persistencia: null,
    detalle: null,
    historico: null,
    acciones: null,
  },
  TIEMPO_RECUPERACION: {
    unidad: "HORAS",
    direccion: "MENOR_ES_MEJOR",
    persistencia: null,
    detalle: null,
    historico: null,
    acciones: null,
  },
} as const satisfies Record<CodigoKpi, ConfiguracionPipelineKpi>;

const CODIGOS_KPI_SET: ReadonlySet<string> = new Set(CODIGOS_KPI);

export function obtenerConfiguracionPipelineKpi(codigo: string): ConfiguracionPipelineKpi | null {
  if (!CODIGOS_KPI_SET.has(codigo)) return null;
  return PIPELINES_KPI[codigo as CodigoKpi];
}
