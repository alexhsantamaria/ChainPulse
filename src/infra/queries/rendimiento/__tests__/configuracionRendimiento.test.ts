// Pruebas -- configuracionRendimiento.ts (Incremento 5 PR4). Todo PURO,
// sin Prisma ni red -- verifica las 4 escalas exigidas por Alex
// (2026-11-19), la marca de limpieza recuperable y el plan de siembra
// por tabla.
import { describe, expect, it } from "vitest";
import {
  ESCALAS_FILAS_POR_CADENA,
  esEscalaValida,
  MARCA_SINTETICA_RENDIMIENTO_PR4,
  nombreEmpresaSinteticaParaEscala,
  planSiembraParaEscala,
} from "../configuracionRendimiento";

describe("ESCALAS_FILAS_POR_CADENA", () => {
  it("son exactamente 100/1.000/10.000/50.000, en ese orden ascendente (las 4 escalas que pidio Alex)", () => {
    expect(ESCALAS_FILAS_POR_CADENA).toEqual([100, 1_000, 10_000, 50_000]);
  });

  it("esEscalaValida() acepta las 4 escalas reales y rechaza cualquier otro numero", () => {
    for (const escala of ESCALAS_FILAS_POR_CADENA) {
      expect(esEscalaValida(escala)).toBe(true);
    }
    for (const invalida of [0, 50, 999, 100_000, -100]) {
      expect(esEscalaValida(invalida)).toBe(false);
    }
  });
});

describe("MARCA_SINTETICA_RENDIMIENTO_PR4 / nombreEmpresaSinteticaParaEscala", () => {
  it("el nombre generado para cada escala SIEMPRE contiene la marca completa (para que una limpieza por `contains` la encuentre)", () => {
    for (const escala of ESCALAS_FILAS_POR_CADENA) {
      expect(nombreEmpresaSinteticaParaEscala(escala)).toContain(MARCA_SINTETICA_RENDIMIENTO_PR4);
    }
  });

  it("el nombre es reproducible (misma escala -> mismo nombre) y distinto entre escalas distintas (sin colisiones)", () => {
    const nombres = ESCALAS_FILAS_POR_CADENA.map(nombreEmpresaSinteticaParaEscala);
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(nombreEmpresaSinteticaParaEscala(1_000)).toBe(nombreEmpresaSinteticaParaEscala(1_000));
  });
});

describe("planSiembraParaEscala()", () => {
  it("las 5 columnas reciben exactamente `escala` filas (ninguna se multiplica ni se divide silenciosamente)", () => {
    for (const escala of ESCALAS_FILAS_POR_CADENA) {
      const plan = planSiembraParaEscala(escala);
      expect(plan).toEqual({
        observacionKpiOtif: escala,
        observacionKpiFillRate: escala,
        observacionOtifProveedor: escala,
        conexionCadena: escala,
        hallazgoCadena: escala,
      });
    }
  });

  // REGRESION (ronda 2 de revision, 2026-11-19, punto 5): la version
  // anterior solo tenia "observacionKpi" y semillaSinteticaConsultas.ts
  // sembraba TODO bajo definicionOtif.id -- el EXPLAIN de
  // FALTANTES_FILL_RATE mediria un conjunto vacio. Ahora deben existir 2
  // columnas separadas, ambas con la MISMA escala.
  it("observacionKpiOtif y observacionKpiFillRate son campos separados, ambos presentes, con la MISMA escala cada uno", () => {
    for (const escala of ESCALAS_FILAS_POR_CADENA) {
      const plan = planSiembraParaEscala(escala);
      expect(plan.observacionKpiOtif).toBe(escala);
      expect(plan.observacionKpiFillRate).toBe(escala);
    }
  });
});
