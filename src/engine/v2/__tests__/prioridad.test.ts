// Pruebas — orden de prioridad de los hallazgos (V2 §8.3).
import { describe, expect, it } from "vitest";
import type { DiagnosticFinding } from "@/domain/types";
import { ordenarPorPrioridad } from "../prioridad";

function hallazgo(dimension: DiagnosticFinding["dimension"], status: string): DiagnosticFinding {
  return {
    dimension,
    status,
    statement: "",
    sourceQuestionIds: [],
    evidenceState: "DECLARADO",
    confidenceCoverage: 1,
    missingEvidence: [],
    nextCheck: "",
    ruleVersion: "v2-preliminary",
  };
}

describe("ordenarPorPrioridad", () => {
  it("regla 1 (afecta la promesa) gana aunque no sea la primera de la lista, si esta en uno de los 2 peores estados", () => {
    // Promesa = disponibilidad (indice 0) -> criticas: INTEGRACION, RESILIENCIA
    const hallazgos = [
      hallazgo("EVIDENCIA", "incompleta"), // regla 5
      hallazgo("INTEGRACION", "inconsistente"), // uno de los 2 peores estados de Integracion Y relevante a la promesa -> regla 1
      hallazgo("COORDINACION", "oportuna"), // buen estado -> regla 6
    ];
    const ordenado = ordenarPorPrioridad(hallazgos, 0);
    expect(ordenado[0]?.dimension).toBe("INTEGRACION");
  });

  it("sin gatillo de regla 1, se respeta el orden de severidad generica 2 > 3 > 4 > 5 > 6", () => {
    // Escenario "Empresa Ejemplo" (ver ejemplo compartido con Alex): promesa =
    // cumplimiento de fecha y cantidad (indice 2), pero ninguna dimension
    // esta en sus 2 peores estados -> regla 1 no dispara para ninguna.
    const hallazgos = [
      hallazgo("ALINEACION", "aplicada parcialmente"),
      hallazgo("COORDINACION", "decision tardia"), // regla 3
      hallazgo("INTEGRACION", "conciliacion manual"), // regla 4
      hallazgo("EVIDENCIA", "incompleta"), // regla 5
      hallazgo("RESILIENCIA", "no probada"), // regla 2
    ];
    const ordenado = ordenarPorPrioridad(hallazgos, 2);
    expect(ordenado.map((h) => h.dimension)).toEqual(["RESILIENCIA", "COORDINACION", "INTEGRACION", "EVIDENCIA", "ALINEACION"]);
  });

  it("todas las dimensiones en su mejor estado quedan todas en regla 6, sin reordenar entre si", () => {
    const hallazgos = [
      hallazgo("ALINEACION", "compartida"),
      hallazgo("COORDINACION", "oportuna"),
      hallazgo("INTEGRACION", "fuente compartida"),
      hallazgo("EVIDENCIA", "verificada declarada"),
      hallazgo("RESILIENCIA", "alternativa probada"),
    ];
    const ordenado = ordenarPorPrioridad(hallazgos, 0);
    expect(ordenado).toEqual(hallazgos); // sort estable: mismo orden de entrada
  });
});
