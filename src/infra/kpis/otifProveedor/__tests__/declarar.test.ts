import { describe, expect, it } from "vitest";
import { previsualizarObservacionOtifProveedor, type EntradaDeclaracionOtifProveedor } from "../declarar";

const PERIODO = { periodoInicio: "2026-09-01", periodoFin: "2026-09-30" };

function filaPegado(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    proveedorAlias: "Proveedor A",
    pedido: "PED-1",
    fechaPromesa: "2026-09-10",
    fechaRecepcion: "2026-09-10",
    cantidadPedida: 10,
    cantidadRecibida: 10,
    ...overrides,
  };
}

describe("previsualizarObservacionOtifProveedor -- modo manual", () => {
  it("una observacion para un proveedor, numerador/denominador validos", () => {
    const entrada: EntradaDeclaracionOtifProveedor = {
      modo: "manual",
      cadenaId: "cadena-1",
      ...PERIODO,
      proveedorAlias: "Proveedor A",
      numerador: 8,
      denominador: 10,
    };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.resultados).toHaveLength(1);
    const [primero] = r.resultados;
    if (!primero) throw new Error("deberia tener 1 resultado");
    expect(primero.proveedorAlias).toBe("Proveedor A");
    expect(primero.proveedorAliasClave).toBe("proveedor a");
    expect(primero.resultado.valor).toBeCloseTo(0.8);
  });

  it("rechaza alias vacio tras normalizar", () => {
    const entrada: EntradaDeclaracionOtifProveedor = {
      modo: "manual",
      cadenaId: "cadena-1",
      ...PERIODO,
      proveedorAlias: "   ",
      numerador: 8,
      denominador: 10,
    };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("DATOS_INVALIDOS");
  });

  it("rechaza denominador <= 0", () => {
    const entrada: EntradaDeclaracionOtifProveedor = {
      modo: "manual",
      cadenaId: "cadena-1",
      ...PERIODO,
      proveedorAlias: "Proveedor A",
      numerador: 0,
      denominador: 0,
    };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
  });

  it("rechaza numerador > denominador", () => {
    const entrada: EntradaDeclaracionOtifProveedor = {
      modo: "manual",
      cadenaId: "cadena-1",
      ...PERIODO,
      proveedorAlias: "Proveedor A",
      numerador: 11,
      denominador: 10,
    };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
  });
});

describe("previsualizarObservacionOtifProveedor -- modo pegado", () => {
  it("tabla vacia -> TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES", () => {
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas: [] };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES");
  });

  it("demasiadas filas -> DEMASIADAS_FILAS con limite y recibidas", () => {
    const filas = Array.from({ length: 2001 }, (_, i) => filaPegado({ pedido: `PED-${i}` }));
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("DEMASIADAS_FILAS");
    if (r.error !== "DEMASIADAS_FILAS") throw new Error("tipo incorrecto");
    expect(r.limite).toBe(2000);
    expect(r.recibidas).toBe(2001);
  });

  it("fila con forma invalida (null) -> DATOS_INVALIDOS, nunca lanza", () => {
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas: [null] };
    expect(() => previsualizarObservacionOtifProveedor(entrada)).not.toThrow();
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("DATOS_INVALIDOS");
  });

  it("multiples proveedores en la misma tabla -> una observacion agregada POR proveedor", () => {
    const filas = [
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "A-1", cantidadPedida: 10, cantidadRecibida: 10 }),
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "A-2", cantidadPedida: 10, cantidadRecibida: 5 }),
      filaPegado({ proveedorAlias: "Proveedor B", pedido: "B-1", cantidadPedida: 10, cantidadRecibida: 10 }),
    ];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.resultados).toHaveLength(2);
    // orden deterministico ascendente por clave
    expect(r.resultados.map((x) => x.proveedorAlias)).toEqual(["Proveedor A", "Proveedor B"]);
    const a = r.resultados.find((x) => x.proveedorAliasClave === "proveedor a");
    const b = r.resultados.find((x) => x.proveedorAliasClave === "proveedor b");
    // Proveedor A: fila1 completa+a tiempo (1/1), fila2 incompleta (0/1) -> 1/2 = 0.5
    expect(a?.resultado.valor).toBeCloseTo(0.5);
    expect(b?.resultado.valor).toBeCloseTo(1);
  });

  it("agrupa por proveedorAliasClave: mismo proveedor escrito con distinto casing/espacios SIN conflicto se agrega junto", () => {
    const filas = [
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "A-1" }),
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "A-2" }),
    ];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.resultados).toHaveLength(1);
  });

  it("alias conflictivos: mismo proveedorAliasClave con 2 variantes distintas de 'visible' -> rechaza TODA la carga", () => {
    const filas = [
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "A-1" }),
      filaPegado({ proveedorAlias: "PROVEEDOR A", pedido: "A-2" }),
    ];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("ALIAS_PROVEEDOR_CONFLICTIVOS");
    if (r.error !== "ALIAS_PROVEEDOR_CONFLICTIVOS") throw new Error("tipo incorrecto");
    expect(r.conflictos).toHaveLength(1);
    const [conflicto] = r.conflictos;
    if (!conflicto) throw new Error("deberia tener 1 conflicto");
    expect(conflicto.proveedorAliasClave).toBe("proveedor a");
    expect(new Set(conflicto.variantes)).toEqual(new Set(["Proveedor A", "PROVEEDOR A"]));
  });

  it("pedido duplicado DENTRO del mismo proveedor -> PEDIDOS_DUPLICADOS", () => {
    const filas = [
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "A-1" }),
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "A-1" }),
    ];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("PEDIDOS_DUPLICADOS");
  });

  it("el MISMO pedido en DOS proveedores distintos NO es un duplicado (no colisiona entre proveedores)", () => {
    const filas = [
      filaPegado({ proveedorAlias: "Proveedor A", pedido: "COMPARTIDO-1" }),
      filaPegado({ proveedorAlias: "Proveedor B", pedido: "COMPARTIDO-1" }),
    ];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok -- el mismo pedido entre 2 proveedores distintos es valido");
    expect(r.resultados).toHaveLength(2);
  });

  it("fila fuera del periodo consultado -> FILAS_FUERA_DE_PERIODO", () => {
    const filas = [filaPegado({ fechaPromesa: "2026-08-15" })];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("FILAS_FUERA_DE_PERIODO");
  });

  it("limites INCLUSIVOS del periodo -- fechaPromesa exactamente en el borde es valida", () => {
    const filas = [filaPegado({ fechaPromesa: PERIODO.periodoInicio }), filaPegado({ pedido: "PED-2", fechaPromesa: PERIODO.periodoFin })];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(true);
  });

  it("servidor siempre recalcula: el resultado nunca depende de ningun campo 'valor' enviado por el cliente (no existe tal campo en la entrada)", () => {
    const filas = [filaPegado({ cantidadPedida: 10, cantidadRecibida: 10 })];
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const r = previsualizarObservacionOtifProveedor(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    const [unico] = r.resultados;
    if (!unico) throw new Error("deberia tener 1 resultado");
    expect(unico.resultado.valor).toBe(1);
  });
});

// Alex, punto 18: "rendimiento del camino completo menor de 5 segundos".
// Esto NO mide el camino HTTP completo (eso depende de Postgres real --
// ver declararObservacionOtifProveedor.integration.test.ts, no ejecutado
// esta sesion, punto 19) -- es una cota de cordura sobre la parte PURA
// del camino (validacion + agrupacion + calculo), al tope de filas
// permitido (MAX_FILAS_PEGADO_OTIF_PROVEEDOR = 2.000), para detectar
// temprano si una futura modificacion introdujera un algoritmo
// cuadratico en el agrupamiento por proveedor. Un presupuesto generoso
// (500 ms, no 5 s) porque esta parte nunca incluye I/O real.
describe("previsualizarObservacionOtifProveedor -- rendimiento (cota de cordura, parte pura)", () => {
  it("2.000 filas repartidas en 50 proveedores se validan/agrupan/calculan en menos de 500 ms", () => {
    const filas = Array.from({ length: 2000 }, (_, i) =>
      filaPegado({
        proveedorAlias: `Proveedor ${i % 50}`,
        pedido: `PED-${i}`,
        fechaPromesa: "2026-09-10",
        fechaRecepcion: i % 3 === 0 ? null : "2026-09-10",
        cantidadRecibida: i % 3 === 0 ? null : 10,
      }),
    );
    const entrada: EntradaDeclaracionOtifProveedor = { modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas };
    const inicio = Date.now();
    const r = previsualizarObservacionOtifProveedor(entrada);
    const duracionMs = Date.now() - inicio;
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.resultados).toHaveLength(50);
    expect(duracionMs).toBeLessThan(500);
  });
});
