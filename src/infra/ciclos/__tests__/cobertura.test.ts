import { describe, expect, it } from "vitest";
import { calcularCobertura } from "../cobertura";

describe("calcularCobertura", () => {
  it("es null cuando no hay responsables esperados", () => {
    expect(calcularCobertura(0, 0)).toBeNull();
  });

  it("calcula el porcentaje cuando responden todos", () => {
    expect(calcularCobertura(5, 5)).toBe(100);
  });

  it("calcula el porcentaje con cobertura parcial (criterio de aceptacion RF10)", () => {
    expect(calcularCobertura(5, 3)).toBe(60);
  });

  it("nunca supera 100 aunque respondan mas de los esperados", () => {
    expect(calcularCobertura(2, 5)).toBe(100);
  });

  it("es 0 cuando nadie respondio", () => {
    expect(calcularCobertura(4, 0)).toBe(0);
  });
});
