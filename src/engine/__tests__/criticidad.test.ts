import { describe, expect, it } from "vitest";
import { calcularCriticidad } from "../criticidad";

describe("calcularCriticidad", () => {
  it("maximiza con impacto/tolerancia/recuperacion en su peor nivel y sin alternativa", () => {
    const criticidad = calcularCriticidad({
      gradoDependencia: "CRITICA",
      impactoPromesaCliente: "CRITICO",
      tieneAlternativa: false,
      tiempoTolerable: "CORTO",
      tiempoRecuperacion: "LARGO",
    });
    expect(criticidad).toBe(100);
  });

  it("minimiza con impacto/tolerancia/recuperacion en su mejor nivel", () => {
    const criticidad = calcularCriticidad({
      gradoDependencia: "BAJA",
      impactoPromesaCliente: "BAJO",
      tieneAlternativa: true,
      tiempoTolerable: "LARGO",
      tiempoRecuperacion: "CORTO",
    });
    expect(criticidad).toBe(0);
  });

  it("una alternativa declarada amortigua la criticidad (Seccion 3: no se confunde con criticidad)", () => {
    const datosBase = {
      gradoDependencia: "CRITICA" as const,
      impactoPromesaCliente: "CRITICO" as const,
      tiempoTolerable: "CORTO" as const,
      tiempoRecuperacion: "LARGO" as const,
    };
    const sinAlternativa = calcularCriticidad({ ...datosBase, tieneAlternativa: false });
    const conAlternativa = calcularCriticidad({ ...datosBase, tieneAlternativa: true });
    expect(conAlternativa).toBeLessThan(sinAlternativa);
  });
});
