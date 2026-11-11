import { describe, expect, it } from "vitest";
import { estadosSiguientesPosibles, mensajeParaError, validarFormularioCrearAccion } from "../accionesDecisionKpiUi";

describe("estadosSiguientesPosibles", () => {
  it("desde PENDIENTE permite EN_PROGRESO, COMPLETADA y DESCARTADA (nunca PENDIENTE)", () => {
    expect(estadosSiguientesPosibles("PENDIENTE").sort()).toEqual(["COMPLETADA", "DESCARTADA", "EN_PROGRESO"]);
  });

  it("desde EN_PROGRESO permite PENDIENTE, COMPLETADA y DESCARTADA (nunca EN_PROGRESO)", () => {
    expect(estadosSiguientesPosibles("EN_PROGRESO").sort()).toEqual(["COMPLETADA", "DESCARTADA", "PENDIENTE"]);
  });

  it("desde un estado terminal no permite ningun cambio", () => {
    expect(estadosSiguientesPosibles("COMPLETADA")).toEqual([]);
    expect(estadosSiguientesPosibles("DESCARTADA")).toEqual([]);
  });
});

describe("validarFormularioCrearAccion", () => {
  const formValido = { descripcionAccion: "Contactar al proveedor", responsableId: "resp-1", fechaObjetivo: "2026-12-01" };

  it("acepta un formulario completo", () => {
    expect(validarFormularioCrearAccion(formValido)).toEqual({ ok: true });
  });

  it("rechaza descripcion vacia", () => {
    expect(validarFormularioCrearAccion({ ...formValido, descripcionAccion: "" }).ok).toBe(false);
  });

  it("rechaza descripcion solo espacios", () => {
    expect(validarFormularioCrearAccion({ ...formValido, descripcionAccion: "   " }).ok).toBe(false);
  });

  it("rechaza sin responsable", () => {
    expect(validarFormularioCrearAccion({ ...formValido, responsableId: "" }).ok).toBe(false);
  });

  it("rechaza sin fecha objetivo", () => {
    expect(validarFormularioCrearAccion({ ...formValido, fechaObjetivo: "" }).ok).toBe(false);
  });
});

describe("mensajeParaError", () => {
  it("devuelve un mensaje especifico para un codigo conocido", () => {
    expect(mensajeParaError("RESPONSABLE_INEXISTENTE")).toMatch(/responsable/i);
  });

  it("cae a un mensaje generico para un codigo desconocido", () => {
    expect(mensajeParaError("ALGO_QUE_NO_EXISTE")).toBe("No se pudo guardar. Intentá de nuevo.");
  });

  it("cae a un mensaje generico cuando no hay codigo", () => {
    expect(mensajeParaError(undefined)).toBe("No se pudo guardar. Intentá de nuevo.");
  });

  // Correccion de ronda de revision -- mensajes nuevos para los 3
  // codigos que los bloqueantes corregidos pueden hacer llegar hasta el
  // formulario.
  it("ORIGEN_SIN_RECOMENDACION_ACCIONABLE (bloqueante 1) -- mensaje especifico", () => {
    expect(mensajeParaError("ORIGEN_SIN_RECOMENDACION_ACCIONABLE")).toMatch(/ya no sugiere/i);
  });

  it("ACCION_FINALIZADA_INMUTABLE (bloqueante 2) -- mensaje especifico, distinto de TRANSICION_INVALIDA", () => {
    const mensaje = mensajeParaError("ACCION_FINALIZADA_INMUTABLE");
    expect(mensaje).toMatch(/inmutable/i);
    expect(mensaje).not.toBe(mensajeParaError("TRANSICION_INVALIDA"));
  });

  it("ACCION_MODIFICADA_CONCURRENTEMENTE (bloqueante 3) -- mensaje especifico", () => {
    expect(mensajeParaError("ACCION_MODIFICADA_CONCURRENTEMENTE")).toMatch(/otra persona/i);
  });
});
