// Pruebas -- preparacion de filas de Cobertura antes de persistir
// (Incremento 4 Bloque B, vertical slice).
import { describe, expect, it } from "vitest";
import { prepararFilasCoberturaParaImportar } from "../prepararFilasCoberturaParaImportar";
import { interpretarFilaCobertura } from "../interpretarFilaCoberturaCsv";
import type { MapeoColumnasCobertura } from "../mapeoColumnasCsv";

const mapeo: MapeoColumnasCobertura = {
  sku: "sku",
  ubicacion: "ubicacion",
  fechaCorte: "fecha",
  inventarioDisponible: "inventario",
  unidadInventario: "unidad_inv",
  consumoDiarioEsperado: "consumo",
  unidadConsumoDiario: "unidad_cons",
};

function filaCruda(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    sku: "A-001",
    ubicacion: "Lima",
    fecha: "2026-09-24",
    inventario: "100",
    unidad_inv: "unidad",
    consumo: "10",
    unidad_cons: "unidad",
    ...overrides,
  };
}

function interpretarOFallar(cruda: Record<string, string>, numeroFila: number) {
  const r = interpretarFilaCobertura(cruda, numeroFila, mapeo);
  if (!r.ok) throw new Error(`fixture invalido en la fila ${numeroFila}: ${r.error}`);
  return { numeroFila, datos: r.datos };
}

describe("prepararFilasCoberturaParaImportar", () => {
  it("preserva la metadata adjunta (numeroFila/skuOriginal/ubicacionOriginal) a traves de calcularCobertura", () => {
    const entradas = [interpretarOFallar(filaCruda(), 1)];
    const r = prepararFilasCoberturaParaImportar(entradas, "America/Lima");
    expect(r.filasParaGuardar).toHaveLength(1);
    expect(r.filasParaGuardar[0]?.numeroFila).toBe(1);
    expect(r.filasParaGuardar[0]?.skuOriginal).toBe("A-001");
    expect(r.filasParaGuardar[0]?.ubicacionOriginal).toBe("Lima");
    expect(r.filasParaGuardar[0]?.estado).toBe("CALCULADA");
    expect(r.filasParaGuardar[0]?.coberturaDias).toBe(10);
  });

  it("colapsa dos filas identicas (mismo SKU/ubicacion/fecha, mismos valores) en una sola fila para guardar", () => {
    const entradas = [interpretarOFallar(filaCruda(), 1), interpretarOFallar(filaCruda(), 2)];
    const r = prepararFilasCoberturaParaImportar(entradas, "America/Lima");
    expect(r.filasParaGuardar).toHaveLength(1);
    expect(r.filasParaGuardar[0]?.numeroFila).toBe(1); // se queda con la primera ocurrencia, deterministico
    expect(r.erroresDuplicado).toHaveLength(0);
  });

  it("señala como error de duplicado (nunca las persiste) dos filas con la misma clave de negocio pero valores distintos", () => {
    const entradas = [
      interpretarOFallar(filaCruda({ inventario: "100" }), 1),
      interpretarOFallar(filaCruda({ inventario: "200" }), 2),
    ];
    const r = prepararFilasCoberturaParaImportar(entradas, "America/Lima");
    expect(r.filasParaGuardar).toHaveLength(0);
    expect(r.erroresDuplicado).toHaveLength(2);
    expect(r.erroresDuplicado.map((e) => e.numeroFila).sort()).toEqual([1, 2]);
  });

  it("nunca deja pasar el estado DUPLICADO hacia filasParaGuardar", () => {
    const entradas = [
      interpretarOFallar(filaCruda({ inventario: "100" }), 1),
      interpretarOFallar(filaCruda({ inventario: "200" }), 2),
    ];
    const r = prepararFilasCoberturaParaImportar(entradas, "America/Lima");
    expect(r.filasParaGuardar.every((f) => (f.estado as string) !== "DUPLICADO")).toBe(true);
  });

  it("filas de SKU/ubicacion/fecha distintos no se consideran duplicados entre si", () => {
    const entradas = [
      interpretarOFallar(filaCruda({ sku: "A-001" }), 1),
      interpretarOFallar(filaCruda({ sku: "A-002" }), 2),
    ];
    const r = prepararFilasCoberturaParaImportar(entradas, "America/Lima");
    expect(r.filasParaGuardar).toHaveLength(2);
    expect(r.erroresDuplicado).toHaveLength(0);
  });
});
