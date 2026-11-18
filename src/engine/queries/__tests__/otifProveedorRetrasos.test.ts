import { describe, expect, it } from "vitest";
import { ejecutarOtifProveedorRetrasos } from "../otifProveedorRetrasos";

const PERIODO = { inicio: new Date("2026-09-01"), fin: new Date("2026-09-30") };

function fila(proveedorAlias: string, valor: number | null, proveedorAliasClave?: string) {
  return { proveedorAlias, proveedorAliasClave: proveedorAliasClave ?? proveedorAlias.toLowerCase(), valor, ruleVersion: "kpis-v1" };
}

describe("ejecutarOtifProveedorRetrasos", () => {
  it("I5-25: sin filas, responde sin datos (ocurre cuando el periodo consultado no tiene observaciones persistidas)", () => {
    const r = ejecutarOtifProveedorRetrasos({ filas: [], periodoConsultado: PERIODO });
    expect(r.ok).toBe(false);
  });

  it("identifica al proveedor con menor OTIF proveedor como el que concentra mas retrasos", () => {
    const r = ejecutarOtifProveedorRetrasos({
      filas: [fila("Proveedor A", 0.9), fila("Proveedor B", 0.5), fila("Proveedor C", 0.8)],
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("Proveedor B");
  });

  it("ignora proveedores sin valor evaluable", () => {
    const r = ejecutarOtifProveedorRetrasos({
      filas: [fila("Sin datos", null), fila("Proveedor X", 0.4)],
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("Proveedor X");
  });

  it("empate exacto de valor: desempata por proveedorAliasClave ASCENDENTE, sin importar el orden de llegada de las filas", () => {
    const enUnOrden = ejecutarOtifProveedorRetrasos({
      filas: [fila("Proveedor Z", 0.5, "proveedor z"), fila("Proveedor A", 0.5, "proveedor a")],
      periodoConsultado: PERIODO,
    });
    const enOrdenInverso = ejecutarOtifProveedorRetrasos({
      filas: [fila("Proveedor A", 0.5, "proveedor a"), fila("Proveedor Z", 0.5, "proveedor z")],
      periodoConsultado: PERIODO,
    });
    expect(enUnOrden.ok).toBe(true);
    expect(enOrdenInverso.ok).toBe(true);
    if (!enUnOrden.ok || !enOrdenInverso.ok) throw new Error("deberia ser ok");
    // mismo resultado exacto sin importar el orden de entrada -- prueba de
    // que el motor NUNCA depende de un orderBy externo para desempatar.
    expect(enUnOrden.respuestaDirecta).toContain("Proveedor A");
    expect(enOrdenInverso.respuestaDirecta).toBe(enUnOrden.respuestaDirecta);
  });

  it("empate entre 3+ proveedores sigue siendo deterministico (clave ascendente completa, no solo el primer par)", () => {
    const r = ejecutarOtifProveedorRetrasos({
      filas: [
        fila("Proveedor C", 0.3, "proveedor c"),
        fila("Proveedor A", 0.3, "proveedor a"),
        fila("Proveedor B", 0.3, "proveedor b"),
      ],
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("Proveedor A");
  });

  it("sin empate, la clave nunca decide por encima del valor (menor OTIF siempre gana, aunque su clave sea 'mayor')", () => {
    const r = ejecutarOtifProveedorRetrasos({
      filas: [fila("Proveedor A", 0.9, "proveedor a"), fila("Proveedor Z", 0.1, "proveedor z")],
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("Proveedor Z");
  });
});
