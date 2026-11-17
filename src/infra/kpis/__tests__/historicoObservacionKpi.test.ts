// Prueba minima directa -- cargarHistoricoObservacionesKpi() se extrajo
// de DetalleObservacionKpi.tsx a este archivo (correccion de ronda de
// revision, bloqueante 1) para que derivarOrigenActual.ts pueda
// reutilizarla sin duplicar la consulta. La cobertura de COMPORTAMIENTO
// (orden, filtro por cadena/definicion/periodo) ya vive, indirectamente,
// en DetalleObservacionKpi.test.ts y derivarOrigenActual.test.ts -- esta
// prueba solo confirma, de forma directa y aislada, que la funcion
// invierte el orden (desc -> asc) y pasa el `where` esperado.
import { describe, expect, it, vi } from "vitest";
import { cargarHistoricoObservacionesKpi, LIMITE_HISTORICO_OBSERVACION_KPI } from "../historicoObservacionKpi";

describe("cargarHistoricoObservacionesKpi", () => {
  it("consulta con el where/orderBy/take esperados y devuelve el resultado en orden cronologico ascendente", async () => {
    const findManyMock = vi.fn(async () => [
      { id: "p2", periodoInicio: new Date("2026-10-01"), periodoFin: new Date("2026-10-31"), valor: 0.8, numerador: 80, denominador: 100, ruleVersion: "v1" },
      { id: "p1", periodoInicio: new Date("2026-09-01"), periodoFin: new Date("2026-09-30"), valor: 0.7, numerador: 70, denominador: 100, ruleVersion: "v1" },
    ]);
    const cliente = { observacionKpi: { findMany: findManyMock } } as unknown as Parameters<typeof cargarHistoricoObservacionesKpi>[0];

    const resultado = await cargarHistoricoObservacionesKpi(cliente, "cad-1", "def-otif", new Date("2026-11-01"));

    expect(findManyMock).toHaveBeenCalledWith({
      where: { cadenaId: "cad-1", definicionKpiId: "def-otif", periodoInicio: { lt: new Date("2026-11-01") } },
      orderBy: { periodoInicio: "desc" },
      take: LIMITE_HISTORICO_OBSERVACION_KPI,
      select: { id: true, periodoInicio: true, periodoFin: true, valor: true, numerador: true, denominador: true, ruleVersion: true },
    });
    expect(resultado.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("sin historico -- devuelve un arreglo vacio", async () => {
    const cliente = {
      observacionKpi: { findMany: vi.fn(async () => []) },
    } as unknown as Parameters<typeof cargarHistoricoObservacionesKpi>[0];
    const resultado = await cargarHistoricoObservacionesKpi(cliente, "cad-1", "def-otif", new Date("2026-11-01"));
    expect(resultado).toEqual([]);
  });
});
