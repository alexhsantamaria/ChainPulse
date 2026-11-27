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

  // Correccion de la revision del PR #40: la version anterior solo
  // exigia "al menos uno null", lo cual tambien es cierto (y por lo
  // tanto no detectaria) si la funcion devolviera los 2 campos en null
  // a la vez -- un resultado invalido que violaria el mismo invariante
  // que validarOrigenUnico() aplica en runtime (exactamente un origen).
  // Esta version exige exactamente un id no nulo, en ambos sentidos.
  it("nunca pobla los dos ids a la vez, y nunca deja los dos en null -- exactamente un id no nulo", () => {
    const porObservacion = idsDeOrigenAccionKpi({ tipo: "OBSERVACION_KPI", observacionKpiId: "obs-2" });
    const porImportacion = idsDeOrigenAccionKpi({ tipo: "IMPORTACION_CSV", importacionCsvId: "imp-2" });

    for (const resultado of [porObservacion, porImportacion]) {
      const idsNoNulos = [resultado.observacionKpiId, resultado.importacionCsvId].filter(
        (id): id is string => id !== null,
      );
      expect(idsNoNulos).toHaveLength(1);
    }
  });
});
