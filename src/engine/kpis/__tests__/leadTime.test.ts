import { describe, expect, it } from "vitest";
import { calcularLeadTime, type FilaLeadTime } from "../leadTime";

function fila(over: Partial<FilaLeadTime> = {}): FilaLeadTime {
  return { proceso: "P1", inicio: new Date("2026-01-01T00:00:00Z"), fin: new Date("2026-01-03T00:00:00Z"), ...over };
}

describe("calcularLeadTime", () => {
  it("calcula el lead time en dias de una sola fila", () => {
    const r = calcularLeadTime([fila()]);
    expect(r.valor).toBe(2);
    expect(r.numerador).toBe(2);
    expect(r.denominador).toBe(1);
  });

  it("promedia varios procesos", () => {
    const r = calcularLeadTime([fila(), fila({ fin: new Date("2026-01-05T00:00:00Z") })]); // 2 dias y 4 dias
    expect(r.valor).toBe(3);
  });

  it("excluye filas sin fecha de fin", () => {
    const r = calcularLeadTime([fila({ fin: null })]);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBeNull();
  });

  it("excluye filas donde fin es anterior a inicio (dato invertido)", () => {
    const r = calcularLeadTime([fila({ fin: new Date("2025-12-31T00:00:00Z") })]);
    expect(r.filasExcluidas).toBe(1);
  });
});
