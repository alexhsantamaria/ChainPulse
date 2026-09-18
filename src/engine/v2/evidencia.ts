// Motor v2 — Evidencia, unica fuente: Q6 (Evidencia de cumplimiento).
import type { DiagnosticFinding, RespuestaPreguntaV2 } from "@/domain/types";
import { calcularDimensionSimple } from "./dimensionSimple";

export function calcularEvidencia(respuestaQ6: RespuestaPreguntaV2 | undefined): DiagnosticFinding {
  return calcularDimensionSimple("EVIDENCIA", respuestaQ6);
}
