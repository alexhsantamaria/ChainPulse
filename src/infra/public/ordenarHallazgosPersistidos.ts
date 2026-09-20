// Infraestructura publica — reconstruye el orden de prioridad (V2 Sec.
// 8.3) de HallazgoExpres ya persistidos. El orden NO se guarda como
// columna propia (evita una migracion mas hoy -- ver
// chainpulse/pendientes-tecnicos-incremento2.md): se recalcula leyendo,
// que es barato (5 filas, sin I/O adicional mas alla de la respuesta de
// Q1 ya necesaria) y determinista -- ordenarPorPrioridad() es la misma
// funcion pura ya usada al calcular, nunca diverge del orden original.
import { ordenarPorPrioridad } from "@/engine/v2";
import type { DiagnosticFinding, DimensionDiagnosticoV2, EstadoEvidenciaV2 } from "@/domain/types";

export interface HallazgoPersistidoMinimo {
  dimension: DimensionDiagnosticoV2;
  estadoCategoria: string;
  enunciado: string;
  estadoEvidencia: EstadoEvidenciaV2;
  coberturaConfianza: number;
  evidenciaFaltante: string[];
  siguienteVerificacion: string | null;
  ruleVersion: string;
}

export function ordenarHallazgosPersistidos<T extends HallazgoPersistidoMinimo>(
  hallazgos: readonly T[],
  q1IndiceOpcion: number | null,
): T[] {
  const comoFindings: DiagnosticFinding[] = hallazgos.map((h) => ({
    dimension: h.dimension,
    status: h.estadoCategoria,
    statement: h.enunciado,
    sourceQuestionIds: [],
    evidenceState: h.estadoEvidencia,
    confidenceCoverage: h.coberturaConfianza,
    missingEvidence: h.evidenciaFaltante,
    nextCheck: h.siguienteVerificacion ?? "",
    ruleVersion: h.ruleVersion,
  }));
  const ordenComoFindings = ordenarPorPrioridad(comoFindings, q1IndiceOpcion);
  // Cada dimension aparece una sola vez -- basta buscarla por nombre para
  // recuperar el objeto original completo (con su id real, etc.) sin
  // perder nada del mapeo minimo de arriba.
  return ordenComoFindings.map((f) => hallazgos.find((h) => h.dimension === f.dimension)!);
}
