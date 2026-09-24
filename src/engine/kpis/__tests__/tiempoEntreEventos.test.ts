import { describe, expect, it } from "vitest";
import { calcularTiempoDeteccion } from "../tiempoDeteccion";
import { calcularTiempoDecision } from "../tiempoDecision";
import { calcularTiempoRecuperacion } from "../tiempoRecuperacion";
import type { FilaTiempoEntreEventos } from "../tiempoEntreEventos";

function fila(horas: number): FilaTiempoEntreEventos {
  const inicio = new Date("2026-01-01T00:00:00Z");
  return { incidente: "I1", inicio, fin: new Date(inicio.getTime() + horas * 3_600_000) };
}

describe("calcularTiempoDeteccion / calcularTiempoDecision / calcularTiempoRecuperacion", () => {
  it("calcularTiempoDeteccion promedia horas entre ocurrencia y deteccion", () => {
    const r = calcularTiempoDeteccion([fila(2), fila(4)]);
    expect(r.valor).toBe(3);
    expect(r.ruleVersion).toBe("kpis-v1");
  });

  it("calcularTiempoDecision promedia horas entre deteccion y decision", () => {
    const r = calcularTiempoDecision([fila(1), fila(3)]);
    expect(r.valor).toBe(2);
  });

  it("calcularTiempoRecuperacion promedia horas entre interrupcion y recuperacion", () => {
    const r = calcularTiempoRecuperacion([fila(10)]);
    expect(r.valor).toBe(10);
  });

  it("excluye incidentes sin fecha de cierre y usa el mensaje propio de cada KPI", () => {
    const rDeteccion = calcularTiempoDeteccion([fila(1), { incidente: "I2", inicio: new Date(), fin: null }]);
    expect(rDeteccion.filasExcluidas).toBe(1);
    expect(rDeteccion.advertencias[0]).toMatch(/deteccion/);

    const rDecision = calcularTiempoDecision([{ incidente: "I3", inicio: new Date(), fin: null }]);
    expect(rDecision.advertencias[0]).toMatch(/decision/);

    const rRecuperacion = calcularTiempoRecuperacion([{ incidente: "I4", inicio: new Date(), fin: null }]);
    expect(rRecuperacion.advertencias[0]).toMatch(/recuperacion/);
  });
});
