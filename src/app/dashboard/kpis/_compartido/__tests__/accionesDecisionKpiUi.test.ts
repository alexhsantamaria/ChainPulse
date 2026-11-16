import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  estadosSiguientesPosibles,
  formatearFechaObjetivo,
  mensajeParaError,
  validarFormularioCrearAccion,
} from "../accionesDecisionKpiUi";
import { fijarZonaHorariaDePrueba } from "./entornoPruebaZonaHoraria";

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

// Correccion de validacion real en Windows (2026-11-16, bloqueante 1):
// fechaObjetivo es date-only, persistida a medianoche UTC exacta. Sin
// timeZone: "UTC" en toLocaleDateString, el resultado depende de la
// zona horaria del HOST que ejecuta la UI -- en Node, process.env.TZ.
// America/Lima (UTC-5) es la zona de offset negativo que ya se usa como
// fixture en este repo para esta misma clase de defecto (ver
// src/engine/kpis/__tests__/cobertura.test.ts y
// src/domain/__tests__/interpretarFilaCoberturaCsv.test.ts) y es,
// ademas, la que reprodujo el defecto reportado por el usuario en
// Windows. Node (confirmado en esta version, v22.23.4) relee
// process.env.TZ en cada llamada a Intl/Date, asi que mutarla en
// beforeEach/afterEach alcanza para simular el entorno sin cambiar la
// configuracion del sistema operativo.
describe("formatearFechaObjetivo", () => {
  // Correccion de ronda de revision (2026-11-16): la restauracion de TZ
  // se delega a fijarZonaHorariaDePrueba()/su funcion de restauracion
  // (ver entornoPruebaZonaHoraria.ts) -- restaura la AUSENCIA real de
  // TZ cuando no estaba definida antes, nunca el string literal
  // "undefined" que resultaba de `process.env.TZ = tzOriginal` cuando
  // tzOriginal es `undefined` (el caso real en este sandbox).
  let restaurarTZ: () => void;

  beforeEach(() => {
    restaurarTZ = fijarZonaHorariaDePrueba("America/Lima");
  });

  afterEach(() => {
    restaurarTZ();
  });

  it("en America/Lima (UTC-5), 2026-11-20T00:00:00.000Z se muestra como 20, no como 19 (defecto reportado)", () => {
    expect(formatearFechaObjetivo("2026-11-20T00:00:00.000Z")).toBe("20 de nov de 2026");
  });

  it("en America/Lima (UTC-5), 2026-09-30T00:00:00.000Z se muestra como 30, no como 29", () => {
    expect(formatearFechaObjetivo("2026-09-30T00:00:00.000Z")).toBe("30 de sept de 2026");
  });

  it("en una zona de offset positivo (Europe/Moscow, UTC+3) tambien muestra el dia correcto", () => {
    process.env.TZ = "Europe/Moscow";
    expect(formatearFechaObjetivo("2026-11-20T00:00:00.000Z")).toBe("20 de nov de 2026");
  });
});
