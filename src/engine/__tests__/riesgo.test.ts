import { describe, expect, it } from "vitest";
import { calcularRiesgo } from "../riesgo";

describe("calcularRiesgo", () => {
  it("un historico de salud volatil da mas riesgo que uno estable, misma criticidad", () => {
    const estable = calcularRiesgo(80, 80, [80, 80, 80], false);
    const volatil = calcularRiesgo(80, 80, [10, 90, 30], false);
    expect(volatil).toBeGreaterThan(estable);
  });

  it("con una sola muestra de historico la variabilidad es 0 (limitacion v1 documentada)", () => {
    const riesgo = calcularRiesgo(50, 50, [], false);
    // sin variabilidad, el riesgo se apoya solo en la criticidad (peso 0.6)
    expect(riesgo).toBe(30);
  });

  it("tener alternativa reduce el riesgo, no solo la criticidad", () => {
    const sinAlternativa = calcularRiesgo(90, 90, [90, 90], false);
    const conAlternativa = calcularRiesgo(90, 90, [90, 90], true);
    expect(conAlternativa).toBeLessThan(sinAlternativa);
  });
});
