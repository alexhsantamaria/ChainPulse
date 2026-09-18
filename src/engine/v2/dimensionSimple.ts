// Motor v2 — helper compartido por las 4 dimensiones de una sola pregunta
// fuente (Coordinacion=Q4, Integracion=Q5, Evidencia=Q6, Resiliencia=Q7).
// Alineacion (Q1+Q2+Q3) NO usa este helper — tiene su propia logica de
// gatillo/corroboracion en alineacion.ts.
import type { DiagnosticFinding, DimensionDiagnosticoV2, EstadoEvidenciaV2, RespuestaPreguntaV2 } from "@/domain/types";
import {
  enPosicion,
  ESTADOS_POR_DIMENSION,
  NEXT_CHECK_POR_DIMENSION,
  RULE_VERSION_V2,
  STATEMENT_POR_DIMENSION,
} from "./constantes";

const EVIDENCE_STATE_INICIAL: EstadoEvidenciaV2 = "DECLARADO"; // autorreporte de un unico respondente (Incremento 2)

export function calcularDimensionSimple(
  dimension: DimensionDiagnosticoV2,
  respuesta: RespuestaPreguntaV2 | undefined,
): DiagnosticFinding {
  if (!respuesta) {
    throw new Error(
      `Falta la respuesta fuente de la dimension ${dimension} — las 7 preguntas son obligatorias en la evaluacion expres v2.`,
    );
  }
  const estados = ESTADOS_POR_DIMENSION[dimension];
  const indice = respuesta.noSabe ? estados.length - 1 : respuesta.indiceOpcion;
  const sustantiva = !respuesta.noSabe;

  return {
    dimension,
    status: enPosicion(estados, indice, `ESTADOS_POR_DIMENSION.${dimension}`),
    statement: enPosicion(STATEMENT_POR_DIMENSION[dimension], indice, `STATEMENT_POR_DIMENSION.${dimension}`),
    sourceQuestionIds: [respuesta.codigoPregunta],
    evidenceState: EVIDENCE_STATE_INICIAL,
    confidenceCoverage: sustantiva ? 1 : 0,
    missingEvidence: sustantiva
      ? []
      : [`Respuesta "no lo se" en ${respuesta.codigoPregunta}; no se puede determinar el estado real de ${dimension}.`],
    nextCheck: enPosicion(NEXT_CHECK_POR_DIMENSION[dimension], indice, `NEXT_CHECK_POR_DIMENSION.${dimension}`),
    ruleVersion: RULE_VERSION_V2,
  };
}
