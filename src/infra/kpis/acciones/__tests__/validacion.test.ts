import { describe, expect, it } from "vitest";
import { validarAccionModificable, validarFinalizacionConsistente, validarOrigenUnico, validarTenantConsistente, validarTransicionEstado } from "../validacion";

describe("validarOrigenUnico", () => {
  it("rechaza cuando ambos origenes estan presentes", () => {
    const r = validarOrigenUnico("obs-1", "imp-1");
    expect(r.valido).toBe(false);
  });

  it("rechaza cuando ningun origen esta presente", () => {
    const r = validarOrigenUnico(null, null);
    expect(r.valido).toBe(false);
  });

  it("rechaza cuando ambos son undefined", () => {
    const r = validarOrigenUnico(undefined, undefined);
    expect(r.valido).toBe(false);
  });

  it("acepta solo observacionKpiId", () => {
    const r = validarOrigenUnico("obs-1", null);
    expect(r.valido).toBe(true);
  });

  it("acepta solo importacionCsvId", () => {
    const r = validarOrigenUnico(null, "imp-1");
    expect(r.valido).toBe(true);
  });

  it("rechaza una cadena vacia como si no estuviera presente", () => {
    const r = validarOrigenUnico("", null);
    expect(r.valido).toBe(false);
  });
});

describe("validarFinalizacionConsistente", () => {
  it("acepta PENDIENTE sin finalizadaEn ni finalizadaPorId", () => {
    const r = validarFinalizacionConsistente("PENDIENTE", null, null);
    expect(r.valido).toBe(true);
  });

  it("acepta EN_PROGRESO sin finalizadaEn ni finalizadaPorId", () => {
    const r = validarFinalizacionConsistente("EN_PROGRESO", null, null);
    expect(r.valido).toBe(true);
  });

  it("acepta COMPLETADA con ambos presentes", () => {
    const r = validarFinalizacionConsistente("COMPLETADA", new Date(), "u1");
    expect(r.valido).toBe(true);
  });

  it("acepta DESCARTADA con ambos presentes", () => {
    const r = validarFinalizacionConsistente("DESCARTADA", new Date(), "u1");
    expect(r.valido).toBe(true);
  });

  it("rechaza COMPLETADA sin finalizadaEn", () => {
    const r = validarFinalizacionConsistente("COMPLETADA", null, "u1");
    expect(r.valido).toBe(false);
  });

  it("rechaza COMPLETADA sin finalizadaPorId", () => {
    const r = validarFinalizacionConsistente("COMPLETADA", new Date(), null);
    expect(r.valido).toBe(false);
  });

  it("rechaza PENDIENTE con finalizadaEn presente (fuga de un estado anterior)", () => {
    const r = validarFinalizacionConsistente("PENDIENTE", new Date(), null);
    expect(r.valido).toBe(false);
  });

  it("rechaza EN_PROGRESO con finalizadaPorId presente sin finalizadaEn", () => {
    const r = validarFinalizacionConsistente("EN_PROGRESO", null, "u1");
    expect(r.valido).toBe(false);
  });
});

describe("validarTenantConsistente", () => {
  const accion = { empresaId: "emp-1", cadenaId: "cad-1" };
  const origenValido = { empresaId: "emp-1", cadenaId: "cad-1" };
  const responsableValido = { empresaId: "emp-1" };
  const creadaPorValido = { empresaId: "emp-1" };

  it("acepta cuando todo coincide (sin finalizadaPor)", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: responsableValido,
      creadaPor: creadaPorValido,
      origen: origenValido,
    });
    expect(r.valido).toBe(true);
  });

  it("acepta cuando finalizadaPor tambien coincide", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: responsableValido,
      creadaPor: creadaPorValido,
      finalizadaPor: { empresaId: "emp-1" },
      origen: origenValido,
    });
    expect(r.valido).toBe(true);
  });

  it("rechaza un responsable de otra empresa", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: { empresaId: "emp-2" },
      creadaPor: creadaPorValido,
      origen: origenValido,
    });
    expect(r.valido).toBe(false);
    expect(r.errores.join(" ")).toContain("responsable");
  });

  it("rechaza un creador de otra empresa", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: responsableValido,
      creadaPor: { empresaId: "emp-2" },
      origen: origenValido,
    });
    expect(r.valido).toBe(false);
  });

  it("rechaza un finalizador de otra empresa", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: responsableValido,
      creadaPor: creadaPorValido,
      finalizadaPor: { empresaId: "emp-2" },
      origen: origenValido,
    });
    expect(r.valido).toBe(false);
  });

  it("rechaza un origen de otra empresa", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: responsableValido,
      creadaPor: creadaPorValido,
      origen: { empresaId: "emp-2", cadenaId: "cad-1" },
    });
    expect(r.valido).toBe(false);
  });

  it("rechaza un origen de otra cadena DENTRO de la misma empresa (el caso que tenantClient() por si solo no detecta)", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: responsableValido,
      creadaPor: creadaPorValido,
      origen: { empresaId: "emp-1", cadenaId: "cad-OTRA" },
    });
    expect(r.valido).toBe(false);
    expect(r.errores.join(" ")).toContain("cadena");
  });

  it("acumula todos los errores aplicables en una sola llamada", () => {
    const r = validarTenantConsistente({
      accion,
      responsable: { empresaId: "emp-2" },
      creadaPor: { empresaId: "emp-3" },
      origen: { empresaId: "emp-4", cadenaId: "cad-OTRA" },
    });
    expect(r.valido).toBe(false);
    expect(r.errores.length).toBe(4);
  });
});

describe("validarTransicionEstado", () => {
  it("permite PENDIENTE -> EN_PROGRESO", () => {
    expect(validarTransicionEstado("PENDIENTE", "EN_PROGRESO").valido).toBe(true);
  });

  it("permite PENDIENTE -> COMPLETADA directo (sin pasar por EN_PROGRESO)", () => {
    expect(validarTransicionEstado("PENDIENTE", "COMPLETADA").valido).toBe(true);
  });

  it("permite EN_PROGRESO -> DESCARTADA", () => {
    expect(validarTransicionEstado("EN_PROGRESO", "DESCARTADA").valido).toBe(true);
  });

  it("permite quedarse en el mismo estado no terminal", () => {
    expect(validarTransicionEstado("EN_PROGRESO", "EN_PROGRESO").valido).toBe(true);
  });

  it("permite quedarse en el mismo estado terminal (idempotente)", () => {
    expect(validarTransicionEstado("COMPLETADA", "COMPLETADA").valido).toBe(true);
  });

  it("rechaza salir de COMPLETADA hacia cualquier otro estado", () => {
    expect(validarTransicionEstado("COMPLETADA", "EN_PROGRESO").valido).toBe(false);
    expect(validarTransicionEstado("COMPLETADA", "PENDIENTE").valido).toBe(false);
  });

  it("rechaza salir de DESCARTADA incluso hacia el otro estado terminal", () => {
    expect(validarTransicionEstado("DESCARTADA", "COMPLETADA").valido).toBe(false);
  });
});

// Correccion de ronda de revision (bloqueante 2): validarAccionModificable()
// es independiente de `estadoNuevo` -- a diferencia de
// validarTransicionEstado(), que solo rechaza si ADEMAS se declara un
// estado nuevo distinto. Ver el comentario de cabecera de la funcion
// (validacion.ts) para el bug real que esto corrige.
describe("validarAccionModificable", () => {
  it("permite modificar una accion PENDIENTE", () => {
    expect(validarAccionModificable("PENDIENTE").valido).toBe(true);
  });

  it("permite modificar una accion EN_PROGRESO", () => {
    expect(validarAccionModificable("EN_PROGRESO").valido).toBe(true);
  });

  it("rechaza modificar una accion COMPLETADA", () => {
    expect(validarAccionModificable("COMPLETADA").valido).toBe(false);
  });

  it("rechaza modificar una accion DESCARTADA", () => {
    expect(validarAccionModificable("DESCARTADA").valido).toBe(false);
  });
});
