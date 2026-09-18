// Motor v2 — Integracion, unica fuente: Q5 (Integracion operativa).
// La subpregunta contextual de Q5 (fuente principal: SAP/ERP, Excel,
// WMS/TMS/APS, ...) es esNoPuntuable=true y NUNCA llega hasta aqui como
// señal de madurez por si sola (principio 7 de V2) — infra/ no debe
// incluirla en el array que recibe el motor para esta dimension.
import type { DiagnosticFinding, RespuestaPreguntaV2 } from "@/domain/types";
import { calcularDimensionSimple } from "./dimensionSimple";

export function calcularIntegracion(respuestaQ5: RespuestaPreguntaV2 | undefined): DiagnosticFinding {
  return calcularDimensionSimple("INTEGRACION", respuestaQ5);
}
