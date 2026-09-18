// Motor v2 — Alineacion: la unica dimension con mas de una pregunta fuente
// (Q1 Promesa, Q2 Objetivo comun, Q3 Interdependencia). Decision de diseño
// confirmada con Alex (2026-09-18): Q2 determina el status en el caso
// normal; Q1 actua como GATILLO (si la promesa no esta claramente
// definida, fuerza el estado mas cauto sin importar Q2/Q3, "sin falsa
// precision"); Q3 CORROBORA sin mover el status, y si contradice
// fuertemente a Q2 se registra en missingEvidence en vez de ignorarse.
import type { DiagnosticFinding, RespuestaPreguntaV2 } from "@/domain/types";
import {
  enPosicion,
  ESTADOS_POR_DIMENSION,
  NEXT_CHECK_POR_DIMENSION,
  Q1_INDICE_PROMESA_NO_DEFINIDA,
  RULE_VERSION_V2,
  STATEMENT_POR_DIMENSION,
  UMBRAL_BRECHA_CONTRADICCION_ALINEACION,
} from "./constantes";

const ESTADOS = ESTADOS_POR_DIMENSION.ALINEACION;
const INDICE_NO_COMPROBABLE = ESTADOS.length - 1; // "no comprobable" — ultimo estado, gatillo y Q2="no lo sé"

function esQ1Gatillo(q1: RespuestaPreguntaV2): boolean {
  return q1.noSabe || q1.indiceOpcion === Q1_INDICE_PROMESA_NO_DEFINIDA;
}

// "Sustantiva" para efectos de confidenceCoverage: la respuesta señala
// positiva o negativamente el estado evaluado. "No lo sé" (Q2/Q3) y "no
// esta claramente definido" (Q1, que no tiene una opcion "no lo sé"
// literal) no son sustantivas — cuentan igual para el denominador, pero no
// para el numerador (principio "no sé no es cero": igual mapean a su
// propio estado categorico, nunca a cero).
function esSustantiva(respuesta: RespuestaPreguntaV2): boolean {
  if (respuesta.codigoPregunta === "Q1") return !esQ1Gatillo(respuesta);
  return !respuesta.noSabe;
}

export function calcularAlineacion(
  q1: RespuestaPreguntaV2 | undefined,
  q2: RespuestaPreguntaV2 | undefined,
  q3: RespuestaPreguntaV2 | undefined,
): DiagnosticFinding {
  if (!q1 || !q2 || !q3) {
    throw new Error("Faltan Q1, Q2 o Q3 — las 7 preguntas son obligatorias en la evaluacion expres v2.");
  }

  const gatillo = esQ1Gatillo(q1);
  const indiceEstado = gatillo ? INDICE_NO_COMPROBABLE : q2.noSabe ? INDICE_NO_COMPROBABLE : q2.indiceOpcion;

  const missingEvidence: string[] = [];
  if (gatillo) {
    missingEvidence.push(
      "Q1 indica que la promesa al cliente no esta claramente definida; no es posible evaluar alineacion alrededor de un objetivo indefinido.",
    );
  }
  if (q2.noSabe) {
    missingEvidence.push('Q2 respondida como "no puedo responder por las otras areas"; falta contrastar con otra area.');
  }
  if (!gatillo && !q2.noSabe && !q3.noSabe && Math.abs(q3.indiceOpcion - q2.indiceOpcion) >= UMBRAL_BRECHA_CONTRADICCION_ALINEACION) {
    missingEvidence.push(
      `Q2 y Q3 se contradicen (brecha de ${Math.abs(q3.indiceOpcion - q2.indiceOpcion)} posiciones): Q2 sugiere un nivel de alineacion distinto al que sugiere la claridad de interdependencias declarada en Q3.`,
    );
  }

  const preguntasFuente = [q1, q2, q3];
  const sustantivas = preguntasFuente.filter(esSustantiva).length;

  return {
    dimension: "ALINEACION",
    status: enPosicion(ESTADOS, indiceEstado, "ESTADOS_POR_DIMENSION.ALINEACION"),
    statement: enPosicion(STATEMENT_POR_DIMENSION.ALINEACION, indiceEstado, "STATEMENT_POR_DIMENSION.ALINEACION"),
    sourceQuestionIds: ["Q1", "Q2", "Q3"],
    evidenceState: "DECLARADO",
    confidenceCoverage: sustantivas / preguntasFuente.length,
    missingEvidence,
    nextCheck: enPosicion(NEXT_CHECK_POR_DIMENSION.ALINEACION, indiceEstado, "NEXT_CHECK_POR_DIMENSION.ALINEACION"),
    ruleVersion: RULE_VERSION_V2,
  };
}
