// Pruebas -- casosExplainConsultas.ts (Incremento 5 PR4, ronda de
// revision 2026-11-19). PURO -- sin red, sin Prisma, sin pg.
import { describe, expect, it } from "vitest";
import { construirCasosExplain, type IdsResueltosParaExplain } from "../casosExplainConsultas";

const IDS: IdsResueltosParaExplain = {
  empresaId: "empresa-1",
  cadenaId: "cadena-1",
  definicionOtifId: "def-otif-AAA",
  definicionOtifProveedorId: "def-otif-proveedor-BBB",
  definicionFillRateId: "def-fill-rate-CCC",
};

describe("construirCasosExplain()", () => {
  it("genera exactamente 8 casos (6 preguntas, 2 de ellas partidas en 2 lecturas)", () => {
    const casos = construirCasosExplain(IDS);
    expect(casos).toHaveLength(8);
  });

  it("REGRESION -- FALTANTES_FILL_RATE usa definicionFillRateId, nunca definicionOtifId (el error real que encontro la ronda de revision)", () => {
    const casos = construirCasosExplain(IDS);
    const caso = casos.find((c) => c.id === "FALTANTES_FILL_RATE_periodo_exacto");
    expect(caso).toBeDefined();
    expect(caso!.params).toContain(IDS.definicionFillRateId);
    expect(caso!.params).not.toContain(IDS.definicionOtifId);
  });

  it("los 2 casos de OTIF_CAIDA usan definicionOtifId, nunca definicionFillRateId ni definicionOtifProveedorId", () => {
    const casos = construirCasosExplain(IDS);
    const casosOtifCaida = casos.filter((c) => c.id.startsWith("OTIF_CAIDA_"));
    expect(casosOtifCaida).toHaveLength(2);
    for (const caso of casosOtifCaida) {
      expect(caso.params).toContain(IDS.definicionOtifId);
      expect(caso.params).not.toContain(IDS.definicionFillRateId);
      expect(caso.params).not.toContain(IDS.definicionOtifProveedorId);
    }
  });

  it("OTIF_PROVEEDOR_RETRASOS usa definicionOtifProveedorId, nunca definicionOtifId", () => {
    const casos = construirCasosExplain(IDS);
    const caso = casos.find((c) => c.id === "OTIF_PROVEEDOR_RETRASOS_periodo_exacto");
    expect(caso).toBeDefined();
    expect(caso!.params).toContain(IDS.definicionOtifProveedorId);
    expect(caso!.params).not.toContain(IDS.definicionOtifId);
  });

  it("marca exactamente los 3 candidatos senalados por Alex (OTIF_CAIDA lectura2 + los 2 de CAMBIOS_ULTIMO_PULSO), ningun otro", () => {
    const casos = construirCasosExplain(IDS);
    const candidatos = casos.filter((c) => c.esCandidatoSenaladoPorAlex).map((c) => c.id);
    expect(candidatos.sort()).toEqual(
      [
        "OTIF_CAIDA_lectura2_anterior_CANDIDATO_SENALADO_POR_ALEX",
        "CAMBIOS_ULTIMO_PULSO_antes_del_corte_CANDIDATO_SENALADO_POR_ALEX",
        "CAMBIOS_ULTIMO_PULSO_desde_el_corte_CANDIDATO_SENALADO_POR_ALEX",
      ].sort(),
    );
  });

  it("todos los casos filtran por cadenaId como primer parametro (aislamiento de tenant en el SQL medido)", () => {
    const casos = construirCasosExplain(IDS);
    for (const caso of casos) {
      expect(caso.params[0]).toBe(IDS.cadenaId);
      expect(caso.sql).toContain('"cadenaId"=$1');
    }
  });
});
