// Pruebas -- los 3 agregadores genericos compartidos por las 10 funciones
// de calculo de KPIs, mas el helper de fecha de corte por zona horaria
// usado por Stockout y Cobertura.
import { describe, expect, it } from "vitest";
import { calcularDesviacionEstandar, calcularPromedio, calcularRatio, diaEnZona } from "../compartido";

describe("calcularRatio", () => {
  it("suma numerador/denominador fila a fila y calcula la fraccion", () => {
    const filas = [{ ok: true }, { ok: false }, { ok: true }];
    const r = calcularRatio(filas, (f) => ({ numerador: f.ok ? 1 : 0, denominador: 1 }), "motivo");
    expect(r.valor).toBeCloseTo(2 / 3);
    expect(r.numerador).toBe(2);
    expect(r.denominador).toBe(3);
    expect(r.filasEvaluadas).toBe(3);
    expect(r.filasExcluidas).toBe(0);
    expect(r.cobertura).toBe(1);
    expect(r.advertencias).toEqual([]);
  });

  it("excluye filas donde evaluar devuelve null y agrega advertencia", () => {
    const filas = [{ ok: true }, null];
    const r = calcularRatio(filas, (f) => (f ? { numerador: 1, denominador: 1 } : null), "sin dato");
    expect(r.filasEvaluadas).toBe(1);
    expect(r.filasExcluidas).toBe(1);
    expect(r.cobertura).toBe(0.5);
    expect(r.advertencias).toEqual(["1 fila(s) excluida(s): sin dato."]);
  });

  it("excluye una fila con denominador <= 0", () => {
    const filas = [{ d: 0 }];
    const r = calcularRatio(filas, (f) => ({ numerador: 5, denominador: f.d }), "denominador invalido");
    expect(r.filasEvaluadas).toBe(0);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBeNull();
  });

  it("valor es null cuando no hay ninguna fila evaluable", () => {
    const r = calcularRatio([], () => null, "sin filas");
    expect(r.valor).toBeNull();
    expect(r.numerador).toBeNull();
    expect(r.denominador).toBeNull();
    expect(r.cobertura).toBe(0);
    expect(r.advertencias).toEqual(["Sin datos suficientes para calcular este KPI en el periodo evaluado."]);
  });
});

describe("calcularPromedio", () => {
  it("promedia los valores evaluados y expone numerador=suma/denominador=cantidad", () => {
    const r = calcularPromedio([1, 2, 3, 4], (v) => v, "motivo");
    expect(r.valor).toBe(2.5);
    expect(r.numerador).toBe(10);
    expect(r.denominador).toBe(4);
    expect(r.filasExcluidas).toBe(0);
  });

  it("excluye valores null y sigue calculando el promedio del resto", () => {
    const r = calcularPromedio([1, null, 3], (v) => v, "sin dato");
    expect(r.valor).toBe(2);
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(1);
  });
});

describe("calcularDesviacionEstandar", () => {
  it("calcula la desviacion estandar muestral (n-1) con al menos 2 valores", () => {
    // valores 2,4,4,4,5,5,7,9 -> media 5, varianza muestral 4.571..., desv ~2.138
    const r = calcularDesviacionEstandar([2, 4, 4, 4, 5, 5, 7, 9], (v) => v, "motivo");
    expect(r.valor).toBeCloseTo(2.1381, 3);
    expect(r.numerador).toBeNull();
    expect(r.denominador).toBeNull();
    expect(r.filasEvaluadas).toBe(8);
  });

  it("devuelve valor null con menos de 2 observaciones y advierte", () => {
    const r = calcularDesviacionEstandar([5], (v) => v, "motivo");
    expect(r.valor).toBeNull();
    expect(r.advertencias).toContain(
      "Se necesitan al menos 2 observaciones comparables para calcular variabilidad; solo hay 1.",
    );
  });

  it("devuelve valor null sin ninguna observacion", () => {
    const r = calcularDesviacionEstandar([], (v: number) => v, "motivo");
    expect(r.valor).toBeNull();
    expect(r.filasEvaluadas).toBe(0);
  });
});

describe("diaEnZona", () => {
  it("calcula el dia calendario en la zona horaria indicada, no en UTC", () => {
    // 2026-01-01T02:00:00Z son las 21:00 del 2025-12-31 en Lima (UTC-5).
    expect(diaEnZona(new Date("2026-01-01T02:00:00Z"), "America/Lima")).toBe("2025-12-31");
    expect(diaEnZona(new Date("2026-01-01T02:00:00Z"), "UTC")).toBe("2026-01-01");
  });

  it("dos horas del mismo dia calendario en la zona indicada devuelven el mismo dia", () => {
    const a = diaEnZona(new Date("2026-01-01T14:00:00Z"), "America/Lima"); // 09:00 Lima
    const b = diaEnZona(new Date("2026-01-01T23:00:00Z"), "America/Lima"); // 18:00 Lima
    expect(a).toBe(b);
    expect(a).toBe("2026-01-01");
  });

  it("formato siempre AAAA-MM-DD", () => {
    expect(diaEnZona(new Date("2026-03-05T12:00:00Z"), "America/Lima")).toBe("2026-03-05");
  });
});
