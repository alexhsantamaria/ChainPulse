// Motor v2 — Resiliencia, unica fuente: Q7 (Respuesta ante falla).
import type { DiagnosticFinding, RespuestaPreguntaV2 } from "@/domain/types";
import { calcularDimensionSimple } from "./dimensionSimple";

export function calcularResiliencia(respuestaQ7: RespuestaPreguntaV2 | undefined): DiagnosticFinding {
  return calcularDimensionSimple("RESILIENCIA", respuestaQ7);
}
