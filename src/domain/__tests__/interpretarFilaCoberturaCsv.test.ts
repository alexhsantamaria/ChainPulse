// Pruebas -- interpretacion de filas de un CSV de Cobertura (Incremento
// 4 Bloque B, vertical slice).
import { describe, expect, it } from "vitest";
import { interpretarFilaCobertura } from "../interpretarFilaCoberturaCsv";
import type { MapeoColumnasCobertura } from "../mapeoColumnasCsv";

const mapeo: MapeoColumnasCobertura = {
  sku: "sku",
  ubicacion: "ubicacion",
  fechaCorte: "fecha",
  inventarioDisponible: "inventario",
  unidadInventario: "unidad_inv",
  consumoDiarioEsperado: "consumo",
  unidadConsumoDiario: "unidad_cons",
};

function fila(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    sku: "  a-001  ",
    ubicacion: " Lima Centro ",
    fecha: "2026-09-24",
    inventario: "100",
    unidad_inv: "unidad",
    consumo: "10",
    unidad_cons: "unidad",
    ...overrides,
  };
}

describe("interpretarFilaCobertura", () => {
  it("interpreta una fila valida y normaliza sku/ubicacion (mayusculas + trim, preserva guiones/espacios internos)", () => {
    const r = interpretarFilaCobertura(fila(), 1, mapeo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.fila.sku).toBe("A-001");
    expect(r.datos.fila.ubicacion).toBe("LIMA CENTRO");
    expect(r.datos.skuOriginal).toBe("a-001");
    expect(r.datos.ubicacionOriginal).toBe("Lima Centro");
    expect(r.datos.fila.inventarioDisponible).toBe(100);
    expect(r.datos.fila.consumoDiarioEsperado).toBe(10);
  });

  it("recupera el mismo dia calendario (2026-09-24) via diaEnZona en America/Lima, evitando el corrimiento de medianoche UTC", async () => {
    const { diaEnZona } = await import("../../engine/kpis/compartido");
    const r = interpretarFilaCobertura(fila(), 1, mapeo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(diaEnZona(r.datos.fila.fecha, "America/Lima")).toBe("2026-09-24");
  });

  it("rechaza SKU vacio", () => {
    const r = interpretarFilaCobertura(fila({ sku: "" }), 3, mapeo);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.numeroFila).toBe(3);
    expect(r.error).toMatch(/sku/i);
  });

  it("rechaza ubicacion vacia", () => {
    const r = interpretarFilaCobertura(fila({ ubicacion: "" }), 1, mapeo);
    expect(r.ok).toBe(false);
  });

  it("rechaza fecha en formato DD/MM/AAAA en vez de exigir AAAA-MM-DD (evita ambiguedad silenciosa)", () => {
    const r = interpretarFilaCobertura(fila({ fecha: "24/09/2026" }), 1, mapeo);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/AAAA-MM-DD/);
  });

  it("rechaza fecha vacia", () => {
    const r = interpretarFilaCobertura(fila({ fecha: "" }), 1, mapeo);
    expect(r.ok).toBe(false);
  });

  it("trata inventario vacio como null (Datos incompletos), no como error ni como 0", () => {
    const r = interpretarFilaCobertura(fila({ inventario: "" }), 1, mapeo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.fila.inventarioDisponible).toBeNull();
  });

  it("rechaza inventario no numerico (nunca se coacciona en silencio)", () => {
    const r = interpretarFilaCobertura(fila({ inventario: "N/A" }), 1, mapeo);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/inventario/i);
  });

  it("trata consumo vacio como null", () => {
    const r = interpretarFilaCobertura(fila({ consumo: "" }), 1, mapeo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.fila.consumoDiarioEsperado).toBeNull();
  });

  it("rechaza consumo no numerico", () => {
    const r = interpretarFilaCobertura(fila({ consumo: "abc" }), 1, mapeo);
    expect(r.ok).toBe(false);
  });

  it("acepta unidad de inventario/consumo vacias sin rechazar la fila -- el motor las trata como incompatibles", () => {
    const r = interpretarFilaCobertura(fila({ unidad_inv: "", unidad_cons: "" }), 1, mapeo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.fila.unidadInventario).toBe("");
    expect(r.datos.fila.unidadConsumoDiario).toBe("");
  });
});
