// Pruebas del contrato -- contrato.ts es puramente de tipos, sin ninguna
// funcion que ejecutar; esta prueba fija en codigo ejecutable (no solo
// en comentarios) la forma exacta del contrato y su vocabulario de 4
// estados, para que un cambio futuro que lo reduzca o lo amplíe sin
// querer falle aca, en vez de solo en los adaptadores que lo consumen.
import { describe, expect, it } from "vitest";
import type { EstadoDatoNormalizado, PuntoHistoricoKpi } from "../contrato";

describe("PuntoHistoricoKpi -- forma del contrato", () => {
  it("acepta periodoInicio/periodoFin nulos -- Cobertura los tiene nulos en datos reales (ver cargarHistoricoResumenCobertura())", () => {
    const punto: PuntoHistoricoKpi = {
      id: "importacion-x",
      periodoInicio: null,
      periodoFin: null,
      valor: null,
      estado: "SIN_DATOS",
      fuente: "COBERTURA",
      ruleVersion: null,
    };
    expect(punto.periodoInicio).toBeNull();
    expect(punto.periodoFin).toBeNull();
  });

  it("acepta periodoInicio/periodoFin presentes -- caso tipico de ObservacionKpi", () => {
    const punto: PuntoHistoricoKpi = {
      id: "observacion-x",
      periodoInicio: new Date("2026-01-01"),
      periodoFin: new Date("2026-01-31"),
      valor: 0.9,
      estado: "VALOR",
      fuente: "OBSERVACION_KPI",
      ruleVersion: "v1",
    };
    expect(punto.periodoInicio).toBeInstanceOf(Date);
    expect(punto.periodoFin).toBeInstanceOf(Date);
  });

  it("el vocabulario de estado tiene exactamente estos 4 valores, ni mas ni menos", () => {
    const estados: EstadoDatoNormalizado[] = ["SIN_DATOS", "CERO_REAL", "VALOR", "CON_ERRORES"];
    expect(estados).toHaveLength(4);
    expect(new Set(estados).size).toBe(4);
  });
});
