// Prueba de cordura -- el catalogo cerrado CODIGOS_KPI tiene los 10
// codigos del catalogo inicial (MVP-DEFINITIVO Seccion 6.3), y cada
// funcion de calculo se reexporta correctamente desde el punto de entrada
// publico.
import { describe, expect, it } from "vitest";
import * as kpis from "../index";

describe("engine/kpis index", () => {
  it("CODIGOS_KPI tiene los 10 codigos del catalogo inicial", () => {
    expect(kpis.CODIGOS_KPI).toHaveLength(10);
    expect(kpis.CODIGOS_KPI).toEqual([
      "OTIF",
      "FILL_RATE",
      "STOCKOUT",
      "COBERTURA",
      "LEAD_TIME",
      "VARIABILIDAD_LEAD_TIME",
      "OTIF_PROVEEDOR",
      "TIEMPO_DETECCION",
      "TIEMPO_DECISION",
      "TIEMPO_RECUPERACION",
    ]);
  });

  it("reexporta las 10 funciones de calculo mas RULE_VERSION_KPIS", () => {
    expect(typeof kpis.calcularOtif).toBe("function");
    expect(typeof kpis.calcularFillRate).toBe("function");
    expect(typeof kpis.calcularStockout).toBe("function");
    expect(typeof kpis.calcularCobertura).toBe("function");
    expect(typeof kpis.calcularLeadTime).toBe("function");
    expect(typeof kpis.calcularVariabilidadLeadTime).toBe("function");
    expect(typeof kpis.calcularOtifProveedor).toBe("function");
    expect(typeof kpis.calcularTiempoDeteccion).toBe("function");
    expect(typeof kpis.calcularTiempoDecision).toBe("function");
    expect(typeof kpis.calcularTiempoRecuperacion).toBe("function");
    expect(kpis.RULE_VERSION_KPIS).toBe("kpis-v1");
  });
});
