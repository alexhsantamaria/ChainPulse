import { describe, expect, it } from "vitest";
import { ejecutarOtifCaida, type ObservacionOtifParaConsulta } from "../otifCaida";

function observacion(over: Partial<ObservacionOtifParaConsulta> = {}): ObservacionOtifParaConsulta {
  return {
    valor: 0.8,
    numerador: 80,
    denominador: 100,
    periodoInicio: new Date("2026-09-01"),
    periodoFin: new Date("2026-09-30"),
    ruleVersion: "kpis-v1",
    ...over,
  };
}

const PERIODO = { inicio: new Date("2026-09-01"), fin: new Date("2026-09-30") };

describe("ejecutarOtifCaida", () => {
  it("I5-25: responde sin datos si falta la observacion actual, nunca inventa un numero", () => {
    const r = ejecutarOtifCaida({ actual: null, anterior: observacion(), periodoConsultado: PERIODO });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("no deberia ser ok");
    expect(r.error).toBe("SIN_DATOS_SUFICIENTES");
    // prueba negativa obligatoria (I5-25): ningun campo numerico de resultado
    expect((r as unknown as Record<string, unknown>).numerador).toBeUndefined();
    expect((r as unknown as Record<string, unknown>).denominador).toBeUndefined();
  });

  it("I5-25: responde sin datos si falta la observacion anterior", () => {
    const r = ejecutarOtifCaida({ actual: observacion(), anterior: null, periodoConsultado: PERIODO });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("no deberia ser ok");
    expect(r.error).toBe("SIN_DATOS_SUFICIENTES");
  });

  it("detecta una caida real y la interpretacion lo refleja", () => {
    const r = ejecutarOtifCaida({
      actual: observacion({ valor: 0.6, numerador: 60 }),
      anterior: observacion({ valor: 0.9, numerador: 90 }),
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.numerador).toBe(60);
    expect(r.interpretacion).toContain("bajó");
    expect(r.hecho).not.toBe(r.interpretacion); // I5-21/I5-29: hecho e interpretacion distintos
    expect(r.ruleVersion).toBe("kpis-v1");
  });

  it("cuando no cae, la interpretacion no afirma una caida", () => {
    const r = ejecutarOtifCaida({
      actual: observacion({ valor: 0.9 }),
      anterior: observacion({ valor: 0.8 }),
      periodoConsultado: PERIODO,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.interpretacion).not.toContain("bajó");
  });

  it("es reproducible: misma entrada, misma salida byte a byte (I5-26)", () => {
    const entrada = { actual: observacion(), anterior: observacion({ valor: 0.7 }), periodoConsultado: PERIODO };
    const r1 = JSON.stringify(ejecutarOtifCaida(entrada));
    const r2 = JSON.stringify(ejecutarOtifCaida(entrada));
    expect(r1).toBe(r2);
  });
});
