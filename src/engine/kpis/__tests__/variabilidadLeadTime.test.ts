import { describe, expect, it } from "vitest";
import { calcularVariabilidadLeadTime } from "../variabilidadLeadTime";
import type { FilaLeadTime } from "../leadTime";

function fila(dias: number): FilaLeadTime {
  const inicio = new Date("2026-01-01T00:00:00Z");
  return { proceso: "P1", inicio, fin: new Date(inicio.getTime() + dias * 86_400_000) };
}

describe("calcularVariabilidadLeadTime", () => {
  it("calcula la desviacion estandar de varios lead times comparables", () => {
    const r = calcularVariabilidadLeadTime([fila(2), fila(4), fila(4), fila(4), fila(5), fila(5), fila(7), fila(9)]);
    expect(r.valor).toBeCloseTo(2.1381, 3);
    expect(r.numerador).toBeNull();
    expect(r.denominador).toBeNull();
  });

  it("valor null con un solo lead time (no hay dispersion que medir)", () => {
    const r = calcularVariabilidadLeadTime([fila(3)]);
    expect(r.valor).toBeNull();
    expect(r.advertencias.some((a) => a.includes("al menos 2 observaciones"))).toBe(true);
  });

  it("dos lead times identicos dan desviacion 0", () => {
    const r = calcularVariabilidadLeadTime([fila(3), fila(3)]);
    expect(r.valor).toBe(0);
  });
});
