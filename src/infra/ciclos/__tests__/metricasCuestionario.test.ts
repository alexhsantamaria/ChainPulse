import { describe, expect, it } from "vitest";
import { calcularMetricasCuestionario } from "../metricasCuestionario";

describe("calcularMetricasCuestionario", () => {
  it("sin ninguna duracion registrada, devuelve null en vez de 0", () => {
    const resultado = calcularMetricasCuestionario([]);
    expect(resultado).toEqual({
      total: 0,
      promedioSegundos: null,
      dentroDelLimite: 0,
      porcentajeDentroDelLimite: null,
    });
  });

  it("promedia correctamente y cuenta cuantas quedaron dentro del limite de 5 minutos (300s)", () => {
    const resultado = calcularMetricasCuestionario([120, 200, 400]);
    expect(resultado.total).toBe(3);
    expect(resultado.promedioSegundos).toBeCloseTo((120 + 200 + 400) / 3);
    expect(resultado.dentroDelLimite).toBe(2);
    expect(resultado.porcentajeDentroDelLimite).toBeCloseTo((2 / 3) * 100);
  });

  it("una duracion exactamente en el limite (300s) cuenta como dentro del limite", () => {
    const resultado = calcularMetricasCuestionario([300]);
    expect(resultado.dentroDelLimite).toBe(1);
    expect(resultado.porcentajeDentroDelLimite).toBe(100);
  });

  it("todas por encima del limite da 0% dentro del limite, no null", () => {
    const resultado = calcularMetricasCuestionario([301, 500]);
    expect(resultado.dentroDelLimite).toBe(0);
    expect(resultado.porcentajeDentroDelLimite).toBe(0);
  });
});
