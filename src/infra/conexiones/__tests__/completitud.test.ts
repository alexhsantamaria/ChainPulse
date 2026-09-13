import { describe, expect, it } from "vitest";
import { calcularCompletitud } from "../completitud";

const COMPLETOS = {
  gradoDependencia: "ALTA",
  impactoPromesaCliente: "MEDIO",
  tieneAlternativa: false,
  tiempoTolerable: "CORTO",
  tiempoRecuperacion: "MEDIO",
};

describe("calcularCompletitud", () => {
  it("es completa cuando los 5 datos de RF3 estan presentes", () => {
    expect(calcularCompletitud(COMPLETOS)).toBe(true);
  });

  it("tieneAlternativa=false cuenta como respondido, no como faltante", () => {
    expect(calcularCompletitud({ ...COMPLETOS, tieneAlternativa: false })).toBe(true);
  });

  it("es incompleta si falta el grado de dependencia", () => {
    expect(calcularCompletitud({ ...COMPLETOS, gradoDependencia: null })).toBe(false);
  });

  it("es incompleta si falta el tiempo de recuperacion", () => {
    expect(calcularCompletitud({ ...COMPLETOS, tiempoRecuperacion: undefined })).toBe(false);
  });

  it("es incompleta si tieneAlternativa nunca se respondio", () => {
    expect(calcularCompletitud({ ...COMPLETOS, tieneAlternativa: null })).toBe(false);
  });

  it("es incompleta recien creada, sin ningun dato de criticidad", () => {
    expect(
      calcularCompletitud({
        gradoDependencia: null,
        impactoPromesaCliente: null,
        tieneAlternativa: null,
        tiempoTolerable: null,
        tiempoRecuperacion: null,
      }),
    ).toBe(false);
  });
});
