// Motor v2 — Coordinacion, unica fuente: Q4 (Informacion y decision).
import type { DiagnosticFinding, RespuestaPreguntaV2 } from "@/domain/types";
import { calcularDimensionSimple } from "./dimensionSimple";

export function calcularCoordinacion(respuestaQ4: RespuestaPreguntaV2 | undefined): DiagnosticFinding {
  return calcularDimensionSimple("COORDINACION", respuestaQ4);
}
