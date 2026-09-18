// Pruebas — Alineacion: gatillo de Q1, Q2 como principal, Q3 como corroboracion.
import { describe, expect, it } from "vitest";
import type { RespuestaPreguntaV2 } from "@/domain/types";
import { calcularAlineacion } from "../alineacion";

function resp(codigo: string, indiceOpcion: number, noSabe = false): RespuestaPreguntaV2 {
  return { codigoPregunta: codigo, dimension: "ALINEACION", esNoPuntuable: false, indiceOpcion, noSabe };
}

describe("calcularAlineacion", () => {
  it("Q2 determina el status en el caso normal (sin gatillo de Q1)", () => {
    const h = calcularAlineacion(resp("Q1", 2), resp("Q2", 1), resp("Q3", 1));
    expect(h.status).toBe("aplicada parcialmente"); // estados[1]
    expect(h.sourceQuestionIds).toEqual(["Q1", "Q2", "Q3"]);
    expect(h.confidenceCoverage).toBe(1); // las 3 sustantivas
    expect(h.missingEvidence).toEqual([]);
  });

  it("Q1 = 'no esta claramente definido' fuerza el peor estado, sin importar Q2", () => {
    const h = calcularAlineacion(resp("Q1", 7), resp("Q2", 0), resp("Q3", 0));
    expect(h.status).toBe("no comprobable");
    expect(h.missingEvidence).toHaveLength(1);
    expect(h.missingEvidence[0]).toMatch(/promesa al cliente no esta claramente definida/);
  });

  it("Q2 en 'no lo sé' tambien lleva a 'no comprobable', y reduce la cobertura", () => {
    const h = calcularAlineacion(resp("Q1", 0), resp("Q2", 4, true), resp("Q3", 0));
    expect(h.status).toBe("no comprobable");
    expect(h.confidenceCoverage).toBeCloseTo(2 / 3); // Q1 y Q3 sustantivas, Q2 no
  });

  it("Q3 contradice fuertemente a Q2: no mueve el status, pero se registra en missingEvidence", () => {
    // Q2 = 0 (misma respuesta, alineadas) pero Q3 = 3 (no esta claro) -> brecha de 3
    const h = calcularAlineacion(resp("Q1", 0), resp("Q2", 0), resp("Q3", 3));
    expect(h.status).toBe("compartida"); // status sigue siendo el de Q2
    expect(h.missingEvidence).toHaveLength(1);
    expect(h.missingEvidence[0]).toMatch(/se contradicen/);
  });

  it("brecha menor al umbral entre Q2 y Q3 no se marca como contradiccion", () => {
    const h = calcularAlineacion(resp("Q1", 0), resp("Q2", 1), resp("Q3", 2)); // brecha de 1
    expect(h.missingEvidence).toEqual([]);
  });

  it("lanza un error claro si falta alguna de las 3 preguntas fuente", () => {
    expect(() => calcularAlineacion(undefined, resp("Q2", 0), resp("Q3", 0))).toThrow(/Faltan Q1, Q2 o Q3/);
  });
});
