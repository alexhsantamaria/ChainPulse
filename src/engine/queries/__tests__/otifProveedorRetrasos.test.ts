import { describe, expect, it } from "vitest";
import { ejecutarOtifProveedorRetrasos } from "../otifProveedorRetrasos";

const PERIODO = { inicio: new Date("2026-09-01"), fin: new Date("2026-09-30") };

describe("ejecutarOtifProveedorRetrasos", () => {
  it("I5-25: sin filas, responde sin datos (hoy siempre el caso real -- ver limitacion de esquema documentada)", () => {
    const r = ejecutarOtifProveedorRetrasos({ filas: [], periodoConsultado: PERIODO });
    expect(r.ok).toBe(false);
  });

  it("identifica al proveedor con menor OTIF proveedor como el que concentra mas retrasos", () => {
    const r = ejecutarOtifProveedorRetrasos({
      filas: [
        { proveedorAlias: "Proveedor A", valor: 0.9, ruleVersion: "kpis-v1" },
        { proveedorAlias: "Proveedor B", valor: 0.5, ruleVersion: "kpis-v1" },
        { proveedorAlias: "Proveedor C", valor: 0.8, ruleVersion: "kpis-v1" },
      ],
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("Proveedor B");
  });

  it("ignora proveedores sin valor evaluable", () => {
    const r = ejecutarOtifProveedorRetrasos({
      filas: [
        { proveedorAlias: "Sin datos", valor: null, ruleVersion: "kpis-v1" },
        { proveedorAlias: "Proveedor X", valor: 0.4, ruleVersion: "kpis-v1" },
      ],
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("Proveedor X");
  });
});
