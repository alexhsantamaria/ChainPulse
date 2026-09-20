// Infraestructura publica — formatea un HallazgoExpres ya persistido para
// la respuesta HTTP, aplicando el gate macro/detalle (RF12/RF13: capa de
// presentacion, nunca de computo -- ver ADR-0001). "Macro" es literalmente
// un subconjunto de campos de "detalle", nunca datos distintos.
import type { DimensionDiagnosticoV2, EstadoEvidenciaV2 } from "@/domain/types";

interface HallazgoParaFormatear {
  dimension: DimensionDiagnosticoV2;
  estadoCategoria: string;
  enunciado: string;
  estadoEvidencia: EstadoEvidenciaV2;
  coberturaConfianza: number;
  evidenciaFaltante: string[];
  siguienteVerificacion: string | null;
}

export interface HallazgoMacro {
  dimension: DimensionDiagnosticoV2;
  status: string;
  statement: string;
}

export interface HallazgoDetalle extends HallazgoMacro {
  evidenceState: EstadoEvidenciaV2;
  confidenceCoverage: number;
  missingEvidence: string[];
  nextCheck: string | null;
}

export function formatearHallazgoMacro(h: HallazgoParaFormatear): HallazgoMacro {
  return { dimension: h.dimension, status: h.estadoCategoria, statement: h.enunciado };
}

export function formatearHallazgoDetalle(h: HallazgoParaFormatear): HallazgoDetalle {
  return {
    ...formatearHallazgoMacro(h),
    evidenceState: h.estadoEvidencia,
    confidenceCoverage: h.coberturaConfianza,
    missingEvidence: h.evidenciaFaltante,
    nextCheck: h.siguienteVerificacion,
  };
}
