// Pruebas -- huella de contenido de una fila de Cobertura (Incremento 4
// Bloque B).
import { describe, expect, it } from "vitest";
import { calcularContenidoHashCobertura, type DatosParaHashCobertura } from "../contenidoHashCobertura";

function base(overrides: Partial<DatosParaHashCobertura> = {}): DatosParaHashCobertura {
  return {
    sku: "A-001",
    ubicacion: "LIMA",
    fechaCorte: new Date("2026-09-24T12:00:00.000Z"),
    inventarioDisponible: 100,
    unidadInventario: "unidad",
    consumoDiarioEsperado: 10,
    unidadConsumoDiario: "unidad",
    fuenteConsumo: "ERP mayo 2026",
    periodoReferenciaConsumoInicio: new Date("2026-05-01T12:00:00.000Z"),
    periodoReferenciaConsumoFin: new Date("2026-05-31T12:00:00.000Z"),
    ruleVersion: "v1",
    ...overrides,
  };
}

describe("calcularContenidoHashCobertura", () => {
  it("es deterministico: mismos datos producen el mismo hash", () => {
    expect(calcularContenidoHashCobertura(base())).toBe(calcularContenidoHashCobertura(base()));
  });

  it("cambia si el inventario cambia", () => {
    expect(calcularContenidoHashCobertura(base())).not.toBe(calcularContenidoHashCobertura(base({ inventarioDisponible: 200 })));
  });

  it("cambia si fuenteConsumo cambia (aunque el resto sea igual)", () => {
    expect(calcularContenidoHashCobertura(base())).not.toBe(
      calcularContenidoHashCobertura(base({ fuenteConsumo: "ERP junio 2026" })),
    );
  });

  it("no depende de la hora del dia dentro de fechaCorte (solo el dia calendario cuenta)", () => {
    const a = calcularContenidoHashCobertura(base({ fechaCorte: new Date("2026-09-24T00:00:01.000Z") }));
    const b = calcularContenidoHashCobertura(base({ fechaCorte: new Date("2026-09-24T23:59:00.000Z") }));
    expect(a).toBe(b);
  });

  it("trata inventario null distinto de 0", () => {
    expect(calcularContenidoHashCobertura(base({ inventarioDisponible: null }))).not.toBe(
      calcularContenidoHashCobertura(base({ inventarioDisponible: 0 })),
    );
  });

  it("periodoReferenciaConsumo null produce un hash distinto a uno con fechas", () => {
    expect(
      calcularContenidoHashCobertura(base({ periodoReferenciaConsumoInicio: null, periodoReferenciaConsumoFin: null })),
    ).not.toBe(calcularContenidoHashCobertura(base()));
  });
});
