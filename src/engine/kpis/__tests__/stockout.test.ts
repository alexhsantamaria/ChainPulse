import { describe, expect, it } from "vitest";
import { calcularStockout, type FilaStockout } from "../stockout";

const LIMA = "America/Lima";

function fila(over: Partial<FilaStockout> = {}): FilaStockout {
  return { sku: "SKU1", ubicacion: "L1", fecha: new Date("2026-01-01T12:00:00Z"), stockDisponible: 10, ...over };
}

describe("calcularStockout", () => {
  it("ejemplo de Alex: 100 observaciones validas, 12 con stock <= 0 -> 12%", () => {
    const filas: FilaStockout[] = [];
    for (let i = 0; i < 100; i++) {
      filas.push(fila({ sku: `SKU${i}`, stockDisponible: i < 12 ? 0 : 10 }));
    }
    const r = calcularStockout(filas, LIMA);
    expect(r.filasEvaluadas).toBe(100);
    expect(r.numerador).toBe(12);
    expect(r.denominador).toBe(100);
    // valor es fraccion (0..1), no 0..100 -- la UI multiplica por 100.
    expect(r.valor).toBeCloseTo(0.12);
  });

  it("0% cuando todas las observaciones tuvieron stock", () => {
    const r = calcularStockout(
      [fila({ sku: "SKU1" }), fila({ sku: "SKU2" }), fila({ sku: "SKU3" })],
      LIMA,
    );
    expect(r.valor).toBe(0);
    expect(r.numerador).toBe(0);
    expect(r.denominador).toBe(3);
  });

  it("excluye observaciones sin dato declarado (faltante o no numerico) y las informa", () => {
    const r = calcularStockout([fila({ stockDisponible: null }), fila({ sku: "SKU2" })], LIMA);
    expect(r.filasEvaluadas).toBe(1);
    expect(r.filasExcluidas).toBe(1);
    expect(r.advertencias.some((a) => a.includes("1 fila(s) excluida(s)"))).toBe(true);
  });

  it("excluye productos inactivos", () => {
    const r = calcularStockout([fila({ stockDisponible: 0, activo: false }), fila({ sku: "SKU2" })], LIMA);
    expect(r.filasEvaluadas).toBe(1);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBe(0);
  });

  it("sin observaciones validas devuelve 'Sin datos suficientes'", () => {
    const r = calcularStockout([], LIMA);
    expect(r.valor).toBeNull();
    expect(r.advertencias).toContain("Sin datos suficientes para calcular este KPI en el periodo evaluado.");
  });

  it("stock negativo cuenta como sin stock y se señala como anomalia (no se excluye)", () => {
    const r = calcularStockout([fila({ stockDisponible: -5 }), fila({ sku: "SKU2", stockDisponible: 10 })], LIMA);
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
    expect(r.numerador).toBe(1); // el negativo cuenta como "sin stock"
    expect(r.advertencias.some((a) => a.includes("negativo") && a.includes("anomalia"))).toBe(true);
  });

  it("stock cero (sin ser negativo) tambien cuenta como sin stock pero NO se señala como anomalia", () => {
    const r = calcularStockout([fila({ stockDisponible: 0 })], LIMA);
    expect(r.numerador).toBe(1);
    expect(r.advertencias.some((a) => a.includes("anomalia"))).toBe(false);
  });

  it("duplicados que coinciden exactamente se colapsan a una sola observacion", () => {
    const r = calcularStockout(
      [
        fila({ stockDisponible: 0 }),
        fila({ stockDisponible: 0 }), // misma SKU/ubicacion/dia, mismo valor -- redundancia de captura
        fila({ sku: "SKU2", stockDisponible: 10 }),
      ],
      LIMA,
    );
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
    expect(r.numerador).toBe(1);
    expect(r.denominador).toBe(2);
    expect(r.advertencias.some((a) => a.includes("colapsadas"))).toBe(true);
  });

  it("duplicados que difieren (conflicto) se excluyen y se señalan, sin elegir un ganador", () => {
    const r = calcularStockout(
      [
        fila({ stockDisponible: 10 }), // observacion original: con stock
        fila({ stockDisponible: 0 }), // misma SKU/ubicacion/dia, VALOR DISTINTO -- conflicto real
        fila({ sku: "SKU2", stockDisponible: 10 }),
      ],
      LIMA,
    );
    expect(r.filasEvaluadas).toBe(1); // solo SKU2 entra al calculo
    expect(r.filasExcluidas).toBe(2); // las 2 filas en conflicto de SKU1, ninguna "gana"
    expect(r.valor).toBe(0);
    expect(r.advertencias.some((a) => a.includes("conflicto"))).toBe(true);
  });

  it("mismo SKU/ubicacion en dias distintos (misma zona) NO son duplicados", () => {
    const r = calcularStockout(
      [
        fila({ fecha: new Date("2026-01-01T15:00:00Z"), stockDisponible: 10 }),
        fila({ fecha: new Date("2026-01-02T15:00:00Z"), stockDisponible: 0 }),
      ],
      LIMA,
    );
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
  });

  it("la hora del dia se ignora para detectar duplicados dentro de la misma fecha de corte (zona horaria)", () => {
    const r = calcularStockout(
      [
        fila({ fecha: new Date("2026-01-01T14:00:00Z"), stockDisponible: 10 }), // 09:00 Lima
        fila({ fecha: new Date("2026-01-01T23:00:00Z"), stockDisponible: 10 }), // 18:00 Lima, mismo dia
      ],
      LIMA,
    );
    expect(r.filasEvaluadas).toBe(1); // mismo valor -> colapsa
    expect(r.filasExcluidas).toBe(0);
  });

  it("la fecha de corte se calcula en la zona horaria indicada, no en UTC", () => {
    // 2026-01-01T02:00:00Z es 2025-12-31 21:00 en Lima (UTC-5) -- dia
    // calendario distinto segun se use UTC o America/Lima.
    const r = calcularStockout(
      [
        fila({ fecha: new Date("2026-01-01T02:00:00Z"), stockDisponible: 10 }), // 2025-12-31 en Lima
        fila({ fecha: new Date("2026-01-01T15:00:00Z"), stockDisponible: 0 }), // 2026-01-01 en Lima
      ],
      LIMA,
    );
    // En UTC ambas caerian el mismo dia calendario (2026-01-01) y
    // entrarian en conflicto; en America/Lima son dias distintos.
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
  });

  it("distinta ubicacion del mismo SKU en el mismo dia NO es duplicado", () => {
    const r = calcularStockout(
      [
        fila({ ubicacion: "L1", stockDisponible: 10 }),
        fila({ ubicacion: "L2", stockDisponible: 0 }),
      ],
      LIMA,
    );
    expect(r.filasEvaluadas).toBe(2);
    expect(r.filasExcluidas).toBe(0);
  });
});
