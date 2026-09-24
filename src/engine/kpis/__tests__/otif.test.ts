import { describe, expect, it } from "vitest";
import { calcularOtif, type FilaOtif } from "../otif";

function fila(over: Partial<FilaOtif> = {}): FilaOtif {
  return {
    pedido: "P1",
    fechaPrometida: new Date("2026-01-10"),
    fechaReal: new Date("2026-01-10"),
    cantidadPedida: 100,
    cantidadEntregada: 100,
    ...over,
  };
}

describe("calcularOtif", () => {
  it("cuenta un pedido completo y a tiempo", () => {
    const r = calcularOtif([fila()]);
    expect(r.valor).toBe(1);
    expect(r.numerador).toBe(1);
    expect(r.denominador).toBe(1);
  });

  it("no cuenta un pedido entregado tarde aunque este completo", () => {
    const r = calcularOtif([fila({ fechaReal: new Date("2026-01-11") })]);
    expect(r.valor).toBe(0);
  });

  it("no cuenta un pedido incompleto aunque llegue a tiempo", () => {
    const r = calcularOtif([fila({ cantidadEntregada: 90 })]);
    expect(r.valor).toBe(0);
  });

  it("una entrega adelantada cuenta como a tiempo", () => {
    const r = calcularOtif([fila({ fechaReal: new Date("2026-01-05") })]);
    expect(r.valor).toBe(1);
  });

  it("excluye pedidos sin fecha real o sin cantidad entregada (todavia no cerrados)", () => {
    const r = calcularOtif([fila({ fechaReal: null }), fila({ cantidadEntregada: null })]);
    expect(r.filasEvaluadas).toBe(0);
    expect(r.filasExcluidas).toBe(2);
    expect(r.valor).toBeNull();
  });

  it("mezcla pedidos evaluables y no evaluables correctamente", () => {
    const r = calcularOtif([fila(), fila({ fechaReal: new Date("2026-01-12") }), fila({ fechaReal: null })]);
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBeCloseTo(0.5);
    expect(r.ruleVersion).toBe("kpis-v1");
  });
});
