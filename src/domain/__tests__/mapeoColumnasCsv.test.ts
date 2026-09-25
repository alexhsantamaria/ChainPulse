// Pruebas -- mapeo de columnas de un CSV de Cobertura (Incremento 4
// Bloque B, vertical slice).
import { describe, expect, it } from "vitest";
import { proponerMapeoColumnas, validarMapeoColumnas, CAMPOS_COBERTURA_CSV } from "../mapeoColumnasCsv";

describe("proponerMapeoColumnas", () => {
  it("reconoce encabezados exactos", () => {
    const encabezados = [
      "sku",
      "ubicacion",
      "fecha de corte",
      "inventario disponible",
      "unidad inventario",
      "consumo diario esperado",
      "unidad consumo diario",
    ];
    const mapeo = proponerMapeoColumnas(encabezados);
    for (const def of CAMPOS_COBERTURA_CSV) {
      expect(mapeo[def.campo]).not.toBeNull();
    }
  });

  it("reconoce encabezados con acentos, mayusculas y guiones bajos distintos", () => {
    const encabezados = ["SKU", "Ubicación", "Fecha_Corte", "Inventario-Disponible", "Unidad Inventario", "Consumo_Diario_Esperado", "Unidad De Consumo Diario"];
    const mapeo = proponerMapeoColumnas(encabezados);
    expect(mapeo.sku).toBe("SKU");
    expect(mapeo.ubicacion).toBe("Ubicación");
    expect(mapeo.fechaCorte).toBe("Fecha_Corte");
    expect(mapeo.inventarioDisponible).toBe("Inventario-Disponible");
  });

  it("deja en null un campo sin encabezado candidato, sin inventar una columna", () => {
    const mapeo = proponerMapeoColumnas(["sku", "ubicacion"]);
    expect(mapeo.fechaCorte).toBeNull();
    expect(mapeo.inventarioDisponible).toBeNull();
  });

  it("nunca asigna el mismo encabezado a dos campos distintos por accidente de alias", () => {
    // "consumo" es alias de consumoDiarioEsperado -- confirma que un
    // encabezado ambiguo no se cuela tambien en otro campo con alias
    // parecido.
    const mapeo = proponerMapeoColumnas(["sku", "ubicacion", "fecha", "consumo"]);
    expect(mapeo.consumoDiarioEsperado).toBe("consumo");
    expect(mapeo.inventarioDisponible).toBeNull();
  });
});

describe("validarMapeoColumnas", () => {
  const encabezados = ["sku", "ubicacion", "fecha", "inventario", "unidad_inv", "consumo", "unidad_cons"];
  const mapeoCompleto = {
    sku: "sku",
    ubicacion: "ubicacion",
    fechaCorte: "fecha",
    inventarioDisponible: "inventario",
    unidadInventario: "unidad_inv",
    consumoDiarioEsperado: "consumo",
    unidadConsumoDiario: "unidad_cons",
  };

  it("acepta un mapeo completo y valido", () => {
    const r = validarMapeoColumnas(mapeoCompleto, encabezados);
    expect(r.valido).toBe(true);
    expect(r.camposFaltantes).toHaveLength(0);
    expect(r.columnasInvalidas).toHaveLength(0);
    expect(r.columnasDuplicadas).toHaveLength(0);
  });

  it("reporta campos sin columna asignada", () => {
    const r = validarMapeoColumnas({ ...mapeoCompleto, unidadConsumoDiario: null }, encabezados);
    expect(r.valido).toBe(false);
    expect(r.camposFaltantes).toEqual(["unidadConsumoDiario"]);
  });

  it("reporta una columna asignada que ya no existe en el archivo (editada a mano por el usuario)", () => {
    const r = validarMapeoColumnas({ ...mapeoCompleto, sku: "codigo_producto" }, encabezados);
    expect(r.valido).toBe(false);
    expect(r.columnasInvalidas).toEqual(["sku"]);
  });

  it("reporta cuando el usuario asigna la misma columna a dos campos distintos", () => {
    const r = validarMapeoColumnas({ ...mapeoCompleto, ubicacion: "sku" }, encabezados);
    expect(r.valido).toBe(false);
    expect(r.columnasDuplicadas).toEqual(["sku"]);
  });
});

describe("detectarColumnasSospechosasDeConsumo", () => {
  const mapeoBase = {
    sku: "sku",
    ubicacion: "ubicacion",
    fechaCorte: "fecha",
    inventarioDisponible: "inventario",
    unidadInventario: "unidad_inv",
    consumoDiarioEsperado: "consumo",
    unidadConsumoDiario: "unidad_cons",
  };

  it("detecta una columna de fuente de consumo que el archivo trae de mas (nunca se ignora en silencio)", async () => {
    const { detectarColumnasSospechosasDeConsumo } = await import("../mapeoColumnasCsv");
    const encabezados = [...Object.values(mapeoBase), "Fuente de Consumo"];
    const r = detectarColumnasSospechosasDeConsumo(encabezados, mapeoBase);
    expect(r).toEqual([{ encabezado: "Fuente de Consumo", campo: "fuenteConsumo" }]);
  });

  it("detecta una columna de periodo de referencia del consumo", async () => {
    const { detectarColumnasSospechosasDeConsumo } = await import("../mapeoColumnasCsv");
    const encabezados = [...Object.values(mapeoBase), "periodo_referencia_consumo_inicio"];
    const r = detectarColumnasSospechosasDeConsumo(encabezados, mapeoBase);
    expect(r).toEqual([{ encabezado: "periodo_referencia_consumo_inicio", campo: "periodoReferenciaConsumo" }]);
  });

  it("no marca como sospechosa una columna que YA esta mapeada a un campo del CSV", async () => {
    const { detectarColumnasSospechosasDeConsumo } = await import("../mapeoColumnasCsv");
    const r = detectarColumnasSospechosasDeConsumo(Object.values(mapeoBase), mapeoBase);
    expect(r).toEqual([]);
  });

  it("sin columnas sospechosas, devuelve una lista vacia", async () => {
    const { detectarColumnasSospechosasDeConsumo } = await import("../mapeoColumnasCsv");
    const r = detectarColumnasSospechosasDeConsumo([...Object.values(mapeoBase), "notas"], mapeoBase);
    expect(r).toEqual([]);
  });
});
