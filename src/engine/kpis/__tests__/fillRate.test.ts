import { describe, expect, it } from "vitest";
import { calcularFillRate, type FilaFillRate } from "../fillRate";

function fila(over: Partial<FilaFillRate> = {}): FilaFillRate {
  return { sku: "SKU1", pedido: "P1", solicitado: 100, servido: 100, ...over };
}

describe("calcularFillRate", () => {
  it("100% cuando se sirve exactamente lo solicitado", () => {
    const r = calcularFillRate([fila()]);
    expect(r.valor).toBe(1);
  });

  it("agrega numerador/denominador entre varias filas (SKUs distintos)", () => {
    const r = calcularFillRate([fila({ solicitado: 100, servido: 80 }), fila({ solicitado: 50, servido: 50 })]);
    expect(r.numerador).toBe(130);
    expect(r.denominador).toBe(150);
    expect(r.valor).toBeCloseTo(130 / 150);
  });

  it("una fila sobre-servida no aporta mas de 100% (se limita a solicitado)", () => {
    const r = calcularFillRate([fila({ solicitado: 100, servido: 120 })]);
    expect(r.numerador).toBe(100);
    expect(r.valor).toBe(1);
  });

  it("excluye filas sin cantidad servida", () => {
    const r = calcularFillRate([fila({ servido: null })]);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBeNull();
  });
});
