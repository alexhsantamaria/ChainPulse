import { describe, expect, it } from "vitest";
import { calcularStockout, type FilaStockout } from "../stockout";

function fila(over: Partial<FilaStockout> = {}): FilaStockout {
  return { sku: "SKU1", ubicacion: "L1", fecha: new Date("2026-01-01"), conStock: true, ...over };
}

describe("calcularStockout", () => {
  it("ejemplo de Alex: 100 observaciones validas, 12 con stock <= 0 -> 12%", () => {
    const filas: FilaStockout[] = [];
    for (let i = 0; i < 100; i++) {
      filas.push(fila({ sku: `SKU${i}`, conStock: i < 12 ? false : true }));
    }
    const r = calcularStockout(filas);
    expect(r.filasEvaluadas).toBe(100);
    expect(r.numerador).toBe(12);
    expect(r.denominador).toBe(100);
    // valor es fraccion (0..1), no 0..100 -- la UI multiplica por 100.
    expect(r.valor).toBeCloseTo(0.12);
  });

  it("0% cuando todas las observaciones tuvieron stock", () => {
    const r = calcularStockout([fila({ sku: "SKU1" }), fila({ sku: "SKU2" }), fila({ sku: "SKU3" })]);
    expect(r.valor).toBe(0);
    expect(r.numerador).toBe(0);
    expect(r.denominador).toBe(3);
  });

  it("excluye observaciones sin dato declarado (faltante o no numerico) y las informa", () => {
    const r = calcularStockout([fila({ conStock: null }), fila({ sku: "SKU2" })]);
    expect(r.filasEvaluadas).toBe(1);
    expect(r.filasExcluidas).toBe(1);
    expect(r.advertencias.some((a) => a.includes("1 fila(s) excluida(s)"))).toBe(true);
  });

  it("excluye productos inactivos", () => {
    const r = calcularStockout([fila({ conStock: false, activo: false }), fila({ sku: "SKU2" })]);
    expect(r.filasEvaluadas).toBe(1);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBe(0);
  });

  it("sin observaciones validas devuelve 'Sin datos suficientes'", () => {
    const r = calcularStockout([]);
    expect(r.valor).toBeNull();
    expect(r.advertencias).toContain("Sin datos suficientes para calcular este KPI en el periodo evaluado.");
  });

  it("duplicados que coinciden exactamente se colapsan a una sola observacion", () => {
    const r = calcularStockout([
      fila({ conStock: false }),
      fila({ conStock: false }), // misma SKU/ubicacion/dia, mismo valor -- redundancia de captura
      fila({ sku: "SKU2", conStock: true }),
    ]);
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
    expect(r.numerador).toBe(1);
    expect(r.denominador).toBe(2);
    expect(r.advertencias.some((a) => a.includes("colapsadas"))).toBe(true);
  });

  it("duplicados que difieren (conflicto) se excluyen y se señalan, sin elegir un ganador", () => {
    const r = calcularStockout([
      fila({ conStock: true }), // observacion original: con stock
      fila({ conStock: false }), // misma SKU/ubicacion/dia, VALOR DISTINTO -- conflicto real
      fila({ sku: "SKU2", conStock: true }),
    ]);
    expect(r.filasEvaluadas).toBe(1); // solo SKU2 entra al calculo
    expect(r.filasExcluidas).toBe(2); // las 2 filas en conflicto de SKU1, ninguna "gana"
    expect(r.valor).toBe(0);
    expect(r.advertencias.some((a) => a.includes("conflicto"))).toBe(true);
  });

  it("mismo SKU/ubicacion en dias distintos NO son duplicados", () => {
    const r = calcularStockout([
      fila({ fecha: new Date("2026-01-01"), conStock: true }),
      fila({ fecha: new Date("2026-01-02"), conStock: false }),
    ]);
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
  });

  it("la hora del dia se ignora para detectar duplicados (misma fecha de corte)", () => {
    const r = calcularStockout([
      fila({ fecha: new Date("2026-01-01T02:00:00Z"), conStock: true }),
      fila({ fecha: new Date("2026-01-01T22:00:00Z"), conStock: true }),
    ]);
    expect(r.filasEvaluadas).toBe(1); // mismo valor -> colapsa
    expect(r.filasExcluidas).toBe(0);
  });

  it("distinta ubicacion del mismo SKU en el mismo dia NO es duplicado", () => {
    const r = calcularStockout([
      fila({ ubicacion: "L1", conStock: true }),
      fila({ ubicacion: "L2", conStock: false }),
    ]);
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
  });
});
