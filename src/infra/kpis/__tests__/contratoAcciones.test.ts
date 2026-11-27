import { describe, expect, it } from "vitest";
import type { AccionesPipelineKpi } from "../catalogoPipelineKpi";
import type { OrigenAccionKpi } from "../acciones/tipos";

// Infraestructura (dominio puro) -- prueba de contrato cruzado entre dos
// tipos declarados de forma totalmente independiente que DEBEN compartir
// el mismo vocabulario:
//   - AccionesPipelineKpi (catalogoPipelineKpi.ts): que KPIs anuncian la
//     capacidad de acciones, y a traves de que origen.
//   - OrigenAccionKpi["tipo"] (acciones/tipos.ts): el discriminante real
//     de la union que representa de donde viene una accion ya
//     persistida (respaldado por el CHECK de Postgres
//     chk_accion_decision_kpi_un_origen).
// Nada en el codigo de produccion vincula estos dos tipos -- si alguien
// agrega un tercer origen a OrigenAccionKpi sin actualizar
// AccionesPipelineKpi (o viceversa), este archivo es el unico lugar que
// lo detecta. Tercer corte de PR-A, ver
// diseno-pr-a-tercer-corte-acciones-origen-2026-11-23.md.
//
// Los dos objetos "as const satisfies Record<Union, true>" de abajo dan
// exhaustividad en tiempo de compilacion para cada union por separado
// (mismo patron que PIPELINES_KPI en catalogoPipelineKpi.ts): si se
// agrega o quita un literal de cualquiera de las 2 uniones sin
// actualizar el objeto correspondiente, TypeScript marca un error aca
// (propiedad faltante o excedente). La prueba en tiempo de ejecucion de
// abajo es la que detecta que ambos vocabularios, aun actualizados por
// separado, sigan conteniendo exactamente los mismos valores.
const CONJUNTO_ACCIONES_PIPELINE_KPI = {
  OBSERVACION_KPI: true,
  IMPORTACION_CSV: true,
} as const satisfies Record<AccionesPipelineKpi, true>;

const CONJUNTO_ORIGEN_ACCION_KPI_TIPO = {
  OBSERVACION_KPI: true,
  IMPORTACION_CSV: true,
} as const satisfies Record<OrigenAccionKpi["tipo"], true>;

describe("contrato cruzado -- AccionesPipelineKpi vs OrigenAccionKpi['tipo'] (tercer corte de PR-A)", () => {
  it("ambos vocabularios tienen exactamente los mismos valores", () => {
    expect(Object.keys(CONJUNTO_ACCIONES_PIPELINE_KPI).sort()).toEqual(
      Object.keys(CONJUNTO_ORIGEN_ACCION_KPI_TIPO).sort(),
    );
  });
});
