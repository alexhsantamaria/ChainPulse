import { describe, expect, it } from "vitest";
import { calcularStockout, type FilaStockout } from "../stockout";

function fila(over: Partial<FilaStockout> = {}): FilaStockout {
  return { sku: "SKU1", ubicacion: "L1", fecha: new Date("2026-01-01"), conStock: true, ...over };
}

describe("calcularStockout", () => {
  it("0% cuando todas las observaciones tuvieron stock", () => {
    const r = calcularStockout([fila(), fila(), fila()]);
    expect(r.valor).toBe(0);
    expect(r.numerador).toBe(0);
    expect(r.denominador).toBe(3);
  });

  it("cuenta la proporcion de observaciones sin stock", () => {
    const r = calcularStockout([fila(), fila({ conStock: false }), fila({ conStock: false }), fila()]);
    expect(r.valor).toBe(0.5);
    expect(r.numerador).toBe(2);
  });

  it("excluye observaciones sin dato declarado", () => {
    const r = calcularStockout([fila({ conStock: null })]);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBeNull();
  });
});
