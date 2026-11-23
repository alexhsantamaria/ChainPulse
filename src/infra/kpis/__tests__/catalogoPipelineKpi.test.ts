import { describe, expect, it } from "vitest";
import { CODIGOS_KPI } from "../../../engine/kpis";
import { obtenerConfiguracionPipelineKpi, PIPELINES_KPI } from "../catalogoPipelineKpi";

describe("PIPELINES_KPI", () => {
  it("cubre exhaustivamente los 10 codigos canonicos, sin entradas extra", () => {
    expect(Object.keys(PIPELINES_KPI)).toEqual([...CODIGOS_KPI]);
  });

  it("declara las capacidades genericas existentes de OTIF y Fill Rate", () => {
    for (const codigo of ["OTIF", "FILL_RATE"] as const) {
      expect(PIPELINES_KPI[codigo]).toMatchObject({
        persistencia: "OBSERVACION_KPI",
        detalle: "OBSERVACION_KPI",
        historico: "OBSERVACION_KPI",
        acciones: "OBSERVACION_KPI",
      });
    }
  });

  it("declara los adaptadores dedicados sin confundirlos con el detalle generico", () => {
    expect(PIPELINES_KPI.COBERTURA).toMatchObject({
      persistencia: "IMPORTACION_COBERTURA",
      detalle: "COBERTURA",
      historico: "COBERTURA",
      acciones: "IMPORTACION_CSV",
    });
    // historico: null -- corregido 2026-11-23, segundo corte de PR-A:
    // OTIF Proveedor permanece fuera del historico generico (ver el
    // comentario junto a este campo en catalogoPipelineKpi.ts); su
    // persistencia y su detalle dedicados no cambian.
    expect(PIPELINES_KPI.OTIF_PROVEEDOR).toMatchObject({
      persistencia: "OBSERVACION_OTIF_PROVEEDOR",
      detalle: "OTIF_PROVEEDOR",
      historico: null,
      acciones: null,
    });
  });

  it("mantiene cerradas todas las capacidades de los seis KPIs pendientes", () => {
    for (const codigo of [
      "STOCKOUT",
      "LEAD_TIME",
      "VARIABILIDAD_LEAD_TIME",
      "TIEMPO_DETECCION",
      "TIEMPO_DECISION",
      "TIEMPO_RECUPERACION",
    ] as const) {
      expect(PIPELINES_KPI[codigo]).toMatchObject({
        persistencia: null,
        detalle: null,
        historico: null,
        acciones: null,
      });
    }
  });

  it("expresa direccion y unidad sin forzar una direccion artificial para Cobertura", () => {
    expect(PIPELINES_KPI.OTIF).toMatchObject({ unidad: "PORCENTAJE", direccion: "MAYOR_ES_MEJOR" });
    expect(PIPELINES_KPI.STOCKOUT).toMatchObject({ unidad: "PORCENTAJE", direccion: "MENOR_ES_MEJOR" });
    expect(PIPELINES_KPI.COBERTURA).toMatchObject({ unidad: "DIAS", direccion: "CONTEXTUAL" });
    expect(PIPELINES_KPI.TIEMPO_DECISION).toMatchObject({ unidad: "HORAS", direccion: "MENOR_ES_MEJOR" });
  });
});

describe("obtenerConfiguracionPipelineKpi", () => {
  it("devuelve la entrada canonica para un codigo conocido", () => {
    expect(obtenerConfiguracionPipelineKpi("OTIF")).toBe(PIPELINES_KPI.OTIF);
  });

  it("devuelve null para codigo desconocido o vacio", () => {
    expect(obtenerConfiguracionPipelineKpi("ALGO_QUE_NO_EXISTE")).toBeNull();
    expect(obtenerConfiguracionPipelineKpi("")).toBeNull();
  });
});
