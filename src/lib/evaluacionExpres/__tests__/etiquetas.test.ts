// Pruebas — etiquetas en español para los enums de la evaluacion expres v2.
import { describe, expect, it } from "vitest";
import { etiquetaDimension, etiquetaEstadoEvidencia, mensajeError } from "../etiquetas";

describe("etiquetaDimension", () => {
  it("traduce las 5 dimensiones del motor v2", () => {
    expect(etiquetaDimension("ALINEACION")).toBe("Alineación");
    expect(etiquetaDimension("COORDINACION")).toBe("Coordinación");
    expect(etiquetaDimension("INTEGRACION")).toBe("Integración");
    expect(etiquetaDimension("EVIDENCIA")).toBe("Evidencia");
    expect(etiquetaDimension("RESILIENCIA")).toBe("Resiliencia");
  });
});

describe("etiquetaEstadoEvidencia", () => {
  it("traduce los 3 estados de evidencia", () => {
    expect(etiquetaEstadoEvidencia("DECLARADO")).toBe("Declarado");
    expect(etiquetaEstadoEvidencia("CONFIRMADO_POR_OTROS")).toBe("Confirmado por otros");
    expect(etiquetaEstadoEvidencia("VERIFICADO_CON_DATOS")).toBe("Verificado con datos");
  });
});

describe("mensajeError", () => {
  it("devuelve un mensaje especifico para codigos conocidos", () => {
    expect(mensajeError("LIMITE_TASA_EXCEDIDO")).toMatch(/Demasiados intentos/);
  });

  it("cae al mensaje generico de ERROR_INTERNO para codigos desconocidos", () => {
    expect(mensajeError("ALGO_NUEVO_NO_MAPEADO")).toBe(mensajeError("ERROR_INTERNO"));
  });
});
