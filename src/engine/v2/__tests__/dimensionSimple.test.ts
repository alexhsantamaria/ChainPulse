// Pruebas — dimensiones de una sola pregunta fuente (Coordinacion, Integracion, Evidencia, Resiliencia).
import { describe, expect, it } from "vitest";
import type { RespuestaPreguntaV2 } from "@/domain/types";
import { calcularCoordinacion } from "../coordinacion";
import { calcularResiliencia } from "../resiliencia";

function resp(codigo: string, indiceOpcion: number, noSabe = false): RespuestaPreguntaV2 {
  return { codigoPregunta: codigo, dimension: null, esNoPuntuable: false, indiceOpcion, noSabe };
}

describe("calcularDimensionSimple (via calcularCoordinacion/calcularResiliencia)", () => {
  it("Coordinacion: el indice de la opcion mapea 1:1 al estado (Q4)", () => {
    const h = calcularCoordinacion(resp("Q4", 1));
    expect(h.status).toBe("decision tardia");
    expect(h.confidenceCoverage).toBe(1);
    expect(h.sourceQuestionIds).toHaveLength(1);
    expect(h.ruleVersion).toBe("v2-preliminary");
  });

  it("Coordinacion: 'no lo sé' cae en el ultimo estado y reduce la cobertura a 0", () => {
    const h = calcularCoordinacion(resp("Q4", 4, true));
    expect(h.status).toBe("desconocida");
    expect(h.confidenceCoverage).toBe(0);
    expect(h.missingEvidence).toHaveLength(1);
  });

  it("Resiliencia: el peor estado real (no 'no lo sé') no se confunde con la cobertura baja", () => {
    const h = calcularResiliencia(resp("Q7", 3)); // "no existe alternativa definida" -- sustantiva, aunque mala
    expect(h.status).toBe("inexistente");
    expect(h.confidenceCoverage).toBe(1); // es sustantiva: sabemos que NO hay alternativa
    expect(h.missingEvidence).toEqual([]);
  });

  it("lanza un error claro si falta la respuesta fuente", () => {
    expect(() => calcularCoordinacion(undefined)).toThrow(/Falta la respuesta fuente/);
  });
});
