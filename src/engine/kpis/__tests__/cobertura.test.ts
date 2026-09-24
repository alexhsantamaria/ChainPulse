import { describe, expect, it } from "vitest";
import { calcularCobertura, type FilaCobertura } from "../cobertura";

function fila(over: Partial<FilaCobertura> = {}): FilaCobertura {
  return {
    sku: "SKU-A",
    ubicacion: "L1",
    fecha: new Date("2026-01-01"),
    inventarioDisponible: 100,
    consumoDiarioEsperado: 10,
    unidadInventario: "unidades",
    unidadConsumoDiario: "unidades",
    ...over,
  };
}

describe("calcularCobertura", () => {
  it("ejemplo de Alex: SKU A (100/10 -> 10 dias) y SKU B (0/5 -> 0 dias), sin resumen", () => {
    const r = calcularCobertura([
      fila({ sku: "SKU-A", inventarioDisponible: 100, consumoDiarioEsperado: 10 }),
      fila({ sku: "SKU-B", inventarioDisponible: 0, consumoDiarioEsperado: 5 }),
    ]);
    expect(r.porSku).toHaveLength(2);
    const a = r.porSku.find((f) => f.sku === "SKU-A");
    const b = r.porSku.find((f) => f.sku === "SKU-B");
    expect(a?.estado).toBe("CALCULADA");
    expect(a?.coberturaDias).toBe(10);
    expect(b?.estado).toBe("CALCULADA");
    expect(b?.coberturaDias).toBe(0);
    // No debe existir ningun campo de agregado/resumen en el resultado.
    expect((r as unknown as { agregado?: unknown }).agregado).toBeUndefined();
  });

  it("consumo cero (sin inventario cero) -> Sin consumo de referencia, no 0 dias", () => {
    const r = calcularCobertura([fila({ consumoDiarioEsperado: 0 })]);
    expect(r.porSku[0]?.estado).toBe("SIN_CONSUMO_REFERENCIA");
    expect(r.porSku[0]?.coberturaDias).toBeNull();
    expect(r.advertencias.some((a) => a.includes("Sin consumo de referencia"))).toBe(true);
  });

  it("datos faltantes (inventario o consumo null) -> Datos incompletos", () => {
    const r = calcularCobertura([
      fila({ sku: "SKU-A", inventarioDisponible: null }),
      fila({ sku: "SKU-B", consumoDiarioEsperado: null }),
    ]);
    expect(r.porSku.every((f) => f.estado === "DATOS_INCOMPLETOS")).toBe(true);
    expect(r.porSku.every((f) => f.coberturaDias === null)).toBe(true);
    expect(r.advertencias.some((a) => a.includes("datos incompletos"))).toBe(true);
  });

  it("sin filas (denominador vacio) -> Sin datos suficientes", () => {
    const r = calcularCobertura([]);
    expect(r.porSku).toHaveLength(0);
    expect(r.advertencias).toContain("Sin datos suficientes para calcular cobertura en el periodo evaluado.");
  });

  it("valores negativos se señalan para revision, no se convierten silenciosamente", () => {
    const r = calcularCobertura([
      fila({ sku: "SKU-A", inventarioDisponible: -5 }),
      fila({ sku: "SKU-B", consumoDiarioEsperado: -1 }),
    ]);
    expect(r.porSku.every((f) => f.estado === "VALOR_NEGATIVO")).toBe(true);
    expect(r.porSku.every((f) => f.coberturaDias === null)).toBe(true);
    expect(r.advertencias.some((a) => a.includes("valor negativo"))).toBe(true);
  });

  it("unidades incompatibles entre inventario y consumo -> no se calcula", () => {
    const r = calcularCobertura([fila({ unidadInventario: "unidades", unidadConsumoDiario: "kg" })]);
    expect(r.porSku[0]?.estado).toBe("UNIDADES_INCOMPATIBLES");
    expect(r.porSku[0]?.coberturaDias).toBeNull();
    expect(r.advertencias.some((a) => a.includes("unidades incompatibles"))).toBe(true);
  });

  it("unidades declaradas vacias no se asumen compatibles", () => {
    const r = calcularCobertura([fila({ unidadInventario: "", unidadConsumoDiario: "" })]);
    expect(r.porSku[0]?.estado).toBe("UNIDADES_INCOMPATIBLES");
  });

  it("comparacion de unidades ignora mayusculas/espacios", () => {
    const r = calcularCobertura([fila({ unidadInventario: " Unidades ", unidadConsumoDiario: "unidades" })]);
    expect(r.porSku[0]?.estado).toBe("CALCULADA");
  });

  it("duplicados que coinciden exactamente (mismo SKU/ubicacion) se colapsan a una sola fila", () => {
    const r = calcularCobertura([fila(), fila(), fila({ sku: "SKU-B" })]);
    expect(r.porSku).toHaveLength(2);
    expect(r.porSku.filter((f) => f.sku === "SKU-A")).toHaveLength(1);
    expect(r.advertencias.some((a) => a.includes("colapsadas"))).toBe(true);
  });

  it("duplicados que difieren (conflicto) se marcan DUPLICADO y se excluyen del calculo, sin elegir un ganador", () => {
    const r = calcularCobertura([
      fila({ inventarioDisponible: 100 }),
      fila({ inventarioDisponible: 50 }), // mismo SKU/ubicacion, valor distinto -- conflicto real
      fila({ sku: "SKU-B" }),
    ]);
    const skuA = r.porSku.filter((f) => f.sku === "SKU-A");
    expect(skuA).toHaveLength(2);
    expect(skuA.every((f) => f.estado === "DUPLICADO")).toBe(true);
    expect(skuA.every((f) => f.coberturaDias === null)).toBe(true);
    const skuB = r.porSku.find((f) => f.sku === "SKU-B");
    expect(skuB?.estado).toBe("CALCULADA");
    expect(r.advertencias.some((a) => a.includes("conflicto"))).toBe(true);
  });

  it("distinta ubicacion del mismo SKU NO es duplicado", () => {
    const r = calcularCobertura([
      fila({ ubicacion: "L1", inventarioDisponible: 100 }),
      fila({ ubicacion: "L2", inventarioDisponible: 50 }),
    ]);
    expect(r.porSku).toHaveLength(2);
    expect(r.porSku.every((f) => f.estado === "CALCULADA")).toBe(true);
  });

  it("nunca suma inventarios/consumos de SKU distintos: cada fila conserva su propio resultado", () => {
    const r = calcularCobertura([
      fila({ sku: "SKU-A", inventarioDisponible: 100, consumoDiarioEsperado: 10 }),
      fila({ sku: "SKU-B", inventarioDisponible: 20, consumoDiarioEsperado: 20 }),
    ]);
    const a = r.porSku.find((f) => f.sku === "SKU-A");
    const b = r.porSku.find((f) => f.sku === "SKU-B");
    expect(a?.coberturaDias).toBe(10);
    expect(b?.coberturaDias).toBe(1);
    // (100+20)/(10+20) = 4 dias seria un promedio enganoso -- no debe
    // aparecer en ningun lado del resultado.
    expect(r.porSku.map((f) => f.coberturaDias)).not.toContain(4);
  });
});
