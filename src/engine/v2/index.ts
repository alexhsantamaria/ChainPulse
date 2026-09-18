// Motor v2 — punto de entrada publico. Reexporta las funciones puras del
// motor de la evaluacion expres v2 (RF21/RF22). Igual que el motor v1
// (ADR-0002): sin Prisma, sin Next; infra/ es lo unico que deberia
// importar desde aqui fuera de los propios tests.
import type { DiagnosticFinding, RespuestaPreguntaV2 } from "@/domain/types";
import { calcularAlineacion } from "./alineacion";
import { calcularCoordinacion } from "./coordinacion";
import { calcularEvidencia } from "./evidencia";
import { calcularIntegracion } from "./integracion";
import { ordenarPorPrioridad } from "./prioridad";
import { calcularResiliencia } from "./resiliencia";

export { RULE_VERSION_V2 } from "./constantes";
export { calcularAlineacion } from "./alineacion";
export { calcularCoordinacion } from "./coordinacion";
export { calcularIntegracion } from "./integracion";
export { calcularEvidencia } from "./evidencia";
export { calcularResiliencia } from "./resiliencia";
export { ordenarPorPrioridad } from "./prioridad";

/**
 * Calcula el diagnostico completo (RF21): las 5 dimensiones, en el orden
 * de prioridad de §8.3. `respuestas` debe traer las 7 preguntas puntuables
 * (Q1..Q7) ya resueltas contra su PreguntaVersion — la subpregunta no
 * puntuable de Q5 (fuente principal) se ignora si viene incluida.
 */
export function calcularDiagnosticoV2(respuestas: readonly RespuestaPreguntaV2[]): DiagnosticFinding[] {
  const porCodigo = new Map(respuestas.filter((r) => !r.esNoPuntuable).map((r) => [r.codigoPregunta, r]));

  const hallazgos: DiagnosticFinding[] = [
    calcularAlineacion(porCodigo.get("Q1"), porCodigo.get("Q2"), porCodigo.get("Q3")),
    calcularCoordinacion(porCodigo.get("Q4")),
    calcularIntegracion(porCodigo.get("Q5")),
    calcularEvidencia(porCodigo.get("Q6")),
    calcularResiliencia(porCodigo.get("Q7")),
  ];

  const q1 = porCodigo.get("Q1");
  return ordenarPorPrioridad(hallazgos, q1 ? q1.indiceOpcion : null);
}
