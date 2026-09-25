import { describe, expect, it } from "vitest";
import { confirmacionesCoinciden, type DatosConfirmacionCobertura } from "../compararConfirmacionImportacionCsv";

const MAPEO = {
  sku: "sku",
  ubicacion: "ubicacion",
  fechaCorte: "fecha",
  inventarioDisponible: "inventario",
  unidadInventario: "unidad_inv",
  consumoDiarioEsperado: "consumo",
  unidadConsumoDiario: "unidad_cons",
};

function base(overrides: Partial<DatosConfirmacionCobertura> = {}): DatosConfirmacionCobertura {
  return {
    mapeoColumnas: MAPEO,
    estrategia: "CARGA_PARCIAL",
    alcanceFechaCorteInicio: null,
    alcanceFechaCorteFin: null,
    alcanceUbicaciones: null,
    fuenteConsumo: "ERP mayo 2026",
    periodoReferenciaConsumoInicio: new Date("2026-05-01T12:00:00.000Z"),
    periodoReferenciaConsumoFin: new Date("2026-05-31T12:00:00.000Z"),
    ...overrides,
  };
}

describe("confirmacionesCoinciden", () => {
  it("idénticas -> coinciden", () => {
    expect(confirmacionesCoinciden(base(), base())).toBe(true);
  });

  it("mismas fechas pero con distinta hora (Date vs medianoche vs mediodia) -> coinciden igual (solo importa el dia)", () => {
    const a = base({ periodoReferenciaConsumoInicio: new Date("2026-05-01T00:00:00.000Z") });
    const b = base({ periodoReferenciaConsumoInicio: new Date("2026-05-01T23:59:00.000Z") });
    expect(confirmacionesCoinciden(a, b)).toBe(true);
  });

  it("alcanceUbicaciones en distinto orden -> coinciden (comparacion como conjunto)", () => {
    const a = base({ estrategia: "REEMPLAZO_ALCANCE", alcanceFechaCorteInicio: new Date("2026-09-01"), alcanceFechaCorteFin: new Date("2026-09-30"), alcanceUbicaciones: ["LIMA", "AREQUIPA"] });
    const b = base({ estrategia: "REEMPLAZO_ALCANCE", alcanceFechaCorteInicio: new Date("2026-09-01"), alcanceFechaCorteFin: new Date("2026-09-30"), alcanceUbicaciones: ["AREQUIPA", "LIMA"] });
    expect(confirmacionesCoinciden(a, b)).toBe(true);
  });

  it("mapeo con una columna distinta -> no coinciden", () => {
    const a = base();
    const b = base({ mapeoColumnas: { ...MAPEO, sku: "codigo_sku" } });
    expect(confirmacionesCoinciden(a, b)).toBe(false);
  });

  it("estrategia distinta -> no coinciden", () => {
    const a = base({ estrategia: "CARGA_PARCIAL" });
    const b = base({ estrategia: "REEMPLAZO_ALCANCE", alcanceFechaCorteInicio: new Date(), alcanceFechaCorteFin: new Date(), alcanceUbicaciones: ["LIMA"] });
    expect(confirmacionesCoinciden(a, b)).toBe(false);
  });

  it("una ubicacion de mas en el alcance -> no coinciden", () => {
    const a = base({ estrategia: "REEMPLAZO_ALCANCE", alcanceFechaCorteInicio: new Date("2026-09-01"), alcanceFechaCorteFin: new Date("2026-09-30"), alcanceUbicaciones: ["LIMA"] });
    const b = base({ estrategia: "REEMPLAZO_ALCANCE", alcanceFechaCorteInicio: new Date("2026-09-01"), alcanceFechaCorteFin: new Date("2026-09-30"), alcanceUbicaciones: ["LIMA", "AREQUIPA"] });
    expect(confirmacionesCoinciden(a, b)).toBe(false);
  });

  it("fuenteConsumo distinta -> no coinciden", () => {
    expect(confirmacionesCoinciden(base(), base({ fuenteConsumo: "ERP junio 2026" }))).toBe(false);
  });

  it("periodo de referencia distinto -> no coinciden", () => {
    expect(confirmacionesCoinciden(base(), base({ periodoReferenciaConsumoFin: new Date("2026-06-30T12:00:00.000Z") }))).toBe(false);
  });

  it("una con alcanceUbicaciones null y otra con lista vacia -> no coinciden (null != [])", () => {
    const a = base({ alcanceUbicaciones: null });
    const b = base({ alcanceUbicaciones: [] });
    expect(confirmacionesCoinciden(a, b)).toBe(false);
  });
});
