import { describe, expect, it } from "vitest";
import { ejecutarFaltantesFillRate } from "../faltantesFillRate";

const PERIODO = { inicio: new Date("2026-09-01"), fin: new Date("2026-09-30") };

describe("ejecutarFaltantesFillRate", () => {
  it("I5-04: nunca responde SIN_DATOS_SUFICIENTES, incluso sin observacion", () => {
    const r = ejecutarFaltantesFillRate({ observacionExiste: false, valor: null, ruleVersion: "kpis-v1", periodoConsultado: PERIODO });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.calidad.faltantes.length).toBeGreaterThan(0);
  });

  it("si la observacion existe y tiene valor, no reporta faltantes", () => {
    const r = ejecutarFaltantesFillRate({ observacionExiste: true, valor: 0.95, ruleVersion: "kpis-v1", periodoConsultado: PERIODO });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.calidad.faltantes).toEqual([]);
  });

  it("si existe pero no tiene filas evaluables, lo reporta como faltante", () => {
    const r = ejecutarFaltantesFillRate({ observacionExiste: true, valor: null, ruleVersion: "kpis-v1", periodoConsultado: PERIODO });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.calidad.faltantes.length).toBe(1);
  });
});
