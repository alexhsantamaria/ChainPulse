// Pruebas (unitarias, sin DB ni render de componentes) --
// construirMensajeError(), ConsultasPanel.tsx (Incremento 5). Mismo
// criterio que dashboard/kpis/otif/__tests__/construirMensajeError.test.ts:
// el repositorio no tiene @testing-library/react ni jsdom configurado,
// asi que la funcion pura se exporta desde el componente y se prueba
// aislada.
import { describe, expect, it } from "vitest";
import { construirMensajeError } from "../ConsultasPanel";

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

describe("construirMensajeError", () => {
  it("sin codigo (undefined) -> mensaje generico", () => {
    expect(construirMensajeError(undefined)).toBe(INESPERADO);
  });

  it.each(["CATALOGO_ID_INVALIDO", "CADENA_INEXISTENTE", "PERMISO_DENEGADO", "PERIODO_REQUERIDO", "PERIODO_INVALIDO", "PERIODO_DEMASIADO_LARGO"])(
    "%s -- mensaje especifico de Incremento 5, nunca el generico",
    (codigo) => {
      expect(construirMensajeError(codigo)).not.toBe(INESPERADO);
    },
  );

  it("NO_SESION -> mensaje reconocido (compartido con el resto de la app)", () => {
    expect(construirMensajeError("NO_SESION")).toMatch(/sesión/i);
  });

  it("ERROR_RED -> mensaje reconocido", () => {
    expect(construirMensajeError("ERROR_RED")).toMatch(/conectar|conexión/i);
  });

  it("codigo desconocido -> mensaje generico (nunca revienta ni muestra el codigo crudo)", () => {
    expect(construirMensajeError("ALGO_QUE_NO_EXISTE")).toBe(INESPERADO);
  });

  it("SIN_DATOS_SUFICIENTES nunca deberia llegar aca en la practica, pero si llega no revienta", () => {
    expect(() => construirMensajeError("SIN_DATOS_SUFICIENTES")).not.toThrow();
  });
});
