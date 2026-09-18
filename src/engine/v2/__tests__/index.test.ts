// Pruebas de integracion — calcularDiagnosticoV2 end-to-end.
import { describe, expect, it } from "vitest";
import type { RespuestaPreguntaV2 } from "@/domain/types";
import { calcularDiagnosticoV2 } from "../index";

// El mismo escenario "Empresa Ejemplo S.A." revisado con Alex antes de
// escribir el motor: confirma que la implementacion final reproduce el
// diseño acordado (Q1 gatillo, Q2 principal, Q3 corroboracion) end-to-end.
const RESPUESTAS_EMPRESA_EJEMPLO: RespuestaPreguntaV2[] = [
  { codigoPregunta: "Q1", dimension: "ALINEACION", esNoPuntuable: false, indiceOpcion: 2, noSabe: false }, // cumplimiento de fecha y cantidad
  { codigoPregunta: "Q2", dimension: "ALINEACION", esNoPuntuable: false, indiceOpcion: 1, noSabe: false }, // conocen la prioridad, no siempre la aplican
  { codigoPregunta: "Q3", dimension: "ALINEACION", esNoPuntuable: false, indiceOpcion: 3, noSabe: false }, // no esta claro
  { codigoPregunta: "Q4", dimension: "COORDINACION", esNoPuntuable: false, indiceOpcion: 1, noSabe: false }, // llega a tiempo, no siempre se decide
  { codigoPregunta: "Q5", dimension: "INTEGRACION", esNoPuntuable: false, indiceOpcion: 2, noSabe: false }, // conciliar manualmente
  { codigoPregunta: "Q5-fuente", dimension: null, esNoPuntuable: true, indiceOpcion: 4, noSabe: false }, // subpregunta no puntuable -- debe ser ignorada
  { codigoPregunta: "Q6", dimension: "EVIDENCIA", esNoPuntuable: false, indiceOpcion: 1, noSabe: false }, // indicador, datos incompletos
  { codigoPregunta: "Q7", dimension: "RESILIENCIA", esNoPuntuable: false, indiceOpcion: 1, noSabe: false }, // alternativa no probada
];

describe("calcularDiagnosticoV2", () => {
  it("produce 5 hallazgos, uno por dimension, en el orden de prioridad esperado", () => {
    const hallazgos = calcularDiagnosticoV2(RESPUESTAS_EMPRESA_EJEMPLO);

    expect(hallazgos).toHaveLength(5);
    expect(hallazgos.map((h) => h.dimension)).toEqual(["RESILIENCIA", "COORDINACION", "INTEGRACION", "EVIDENCIA", "ALINEACION"]);

    const alineacion = hallazgos.find((h) => h.dimension === "ALINEACION")!;
    expect(alineacion.status).toBe("aplicada parcialmente");
    expect(alineacion.missingEvidence).toHaveLength(1); // Q2 vs Q3, brecha de 2 -> contradiccion registrada
    expect(alineacion.confidenceCoverage).toBe(1);

    const resiliencia = hallazgos.find((h) => h.dimension === "RESILIENCIA")!;
    expect(resiliencia.status).toBe("no probada");

    for (const h of hallazgos) {
      expect(h.ruleVersion).toBe("v2-preliminary");
    }
  });

  it("la subpregunta no puntuable de Q5 nunca se usa como fuente de un hallazgo", () => {
    const hallazgos = calcularDiagnosticoV2(RESPUESTAS_EMPRESA_EJEMPLO);
    for (const h of hallazgos) {
      expect(h.sourceQuestionIds).not.toContain("Q5-fuente");
    }
  });
});
