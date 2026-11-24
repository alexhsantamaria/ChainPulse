import { describe, expect, it } from "vitest";
import { idsDeOrigenAccionKpi, type OrigenAccionKpi } from "../tipos";

// Caracterizacion de idsDeOrigenAccionKpi() -- extraida de los 2
// ternarios que antes vivian inline en crearAccionDecisionKpi()
// (servicio.ts). Tercer corte de PR-A, ver
// diseno-pr-a-tercer-corte-acciones-origen-2026-11-23.md.
describe("idsDeOrigenAccionKpi", () => {
  it("origen OBSERVACION_KPI -> observacionKpiId poblado, importacionCsvId null", () => {
    const origen: OrigenAccionKpi = { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" };
    expect(idsDeOrigenAccionKpi(origen)).toEqual({
      observacionKpiId: "obs-1",
      importacionCsvId: null,
    });
  });

  it("origen IMPORTACION_CSV -> importacionCsvId poblado, observacionKpiId null", () => {
    const origen: OrigenAccionKpi = { tipo: "IMPORTACION_CSV", importacionCsvId: "imp-1" };
    expect(idsDeOrigenAccionKpi(origen)).toEqual({
      observacionKpiId: null,
      importacionCsvId: "imp-1",
    });
  });

  it("nunca pobla los dos ids a la vez (mismo invariante que validarOrigenUnico)", () => {
    const porObservacion = idsDeOrigenAccionKpi({ tipo: "OBSERVACION_KPI", observacionKpiId: "obs-2" });
    const porImportacion = idsDeOrigenAccionKpi({ tipo: "IMPORTACION_CSV", importacionCsvId: "imp-2" });

    expect(porObservacion.observacionKpiId === null || porObservacion.importacionCsvId === null).toBe(true);
    expect(porImportacion.observacionKpiId === null || porImportacion.importacionCsvId === null).toBe(true);
  });
});
