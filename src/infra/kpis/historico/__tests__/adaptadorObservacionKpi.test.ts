// Pruebas de caracterizacion -- demuestran que adaptarPuntoObservacionKpi()
// es un reshaping puro de PuntoObservacionKpi, sin cambiar ningun valor
// ni reimplementar la clasificacion (reutiliza clasificarValorObservacionKpi(),
// la misma funcion que ya usa la UI).
import { describe, expect, it } from "vitest";
import { clasificarValorObservacionKpi } from "../../estadoVisualizacion";
import type { PuntoObservacionKpi } from "../../analisisDecision";
import { adaptarPuntoObservacionKpi } from "../adaptadorObservacionKpi";

function puntoObs(valor: number | null, ruleVersion = "v1"): PuntoObservacionKpi {
  return {
    id: "obs-" + Math.random(),
    periodoInicio: new Date("2026-02-01"),
    periodoFin: new Date("2026-02-28"),
    valor,
    numerador: valor === null ? null : 65,
    denominador: valor === null ? null : 100,
    ruleVersion,
  };
}

describe("adaptarPuntoObservacionKpi", () => {
  it("valor null -> estado SIN_DATOS, valor null", () => {
    const punto = puntoObs(null);
    const adaptado = adaptarPuntoObservacionKpi(punto);
    expect(adaptado.estado).toBe("SIN_DATOS");
    expect(adaptado.valor).toBeNull();
  });

  it("valor 0 -> estado CERO_REAL, valor 0", () => {
    const punto = puntoObs(0);
    const adaptado = adaptarPuntoObservacionKpi(punto);
    expect(adaptado.estado).toBe("CERO_REAL");
    expect(adaptado.valor).toBe(0);
  });

  it("valor positivo -> estado VALOR, valor sin alterar", () => {
    const punto = puntoObs(0.873);
    const adaptado = adaptarPuntoObservacionKpi(punto);
    expect(adaptado.estado).toBe("VALOR");
    expect(adaptado.valor).toBe(0.873);
  });

  it("id, periodoInicio, periodoFin y ruleVersion pasan sin alterar", () => {
    const punto = puntoObs(0.5, "v2");
    const adaptado = adaptarPuntoObservacionKpi(punto);
    expect(adaptado.id).toBe(punto.id);
    expect(adaptado.periodoInicio).toBe(punto.periodoInicio);
    expect(adaptado.periodoFin).toBe(punto.periodoFin);
    expect(adaptado.ruleVersion).toBe("v2");
  });

  it("fuente siempre es OBSERVACION_KPI", () => {
    expect(adaptarPuntoObservacionKpi(puntoObs(0.5)).fuente).toBe("OBSERVACION_KPI");
  });

  it("caracterizacion: el estado del adaptador coincide exactamente con clasificarValorObservacionKpi() para cualquier valor", () => {
    for (const valor of [null, 0, -0.1, 0.001, 0.5, 1, 1.2]) {
      const punto = puntoObs(valor);
      const adaptado = adaptarPuntoObservacionKpi(punto);
      expect(adaptado.estado).toBe(clasificarValorObservacionKpi(valor));
    }
  });
});
