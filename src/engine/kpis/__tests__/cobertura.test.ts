import { describe, expect, it } from "vitest";
import { calcularCobertura, type FilaCobertura } from "../cobertura";

function fila(over: Partial<FilaCobertura> = {}): FilaCobertura {
  return { sku: "SKU1", inventarioDisponible: 100, consumoDiarioEsperado: 10, ...over };
}

describe("calcularCobertura", () => {
  it("dias de cobertura = inventario / consumo diario", () => {
    const r = calcularCobertura([fila()]);
    expect(r.valor).toBe(10);
  });

  it("agrega varias filas como promedio ponderado (suma inventario / suma consumo)", () => {
    // SKU1: 100/10=10 dias; SKU2: 20/20=1 dia -- promedio simple seria 5.5,
    // el ponderado es (100+20)/(10+20) = 4.
    const r = calcularCobertura([fila(), fila({ inventarioDisponible: 20, consumoDiarioEsperado: 20 })]);
    expect(r.numerador).toBe(120);
    expect(r.denominador).toBe(30);
    expect(r.valor).toBe(4);
  });

  it("excluye filas con consumo diario invalido (<=0)", () => {
    const r = calcularCobertura([fila({ consumoDiarioEsperado: 0 })]);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBeNull();
  });

  it("excluye filas con inventario negativo", () => {
    const r = calcularCobertura([fila({ inventarioDisponible: -5 })]);
    expect(r.filasExcluidas).toBe(1);
  });
});
