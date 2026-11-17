// Pruebas -- helpers de src/infra/kpis/cobertura/resumenCobertura.ts
// (extraidos de cobertura/importaciones/[id]/page.tsx, correccion de
// ronda de revision, bloqueante 1). derivarEstadoVersionCobertura()/
// derivarEstadoVersionCoberturaPorImport() son PURAS -- se prueban con
// datos de entrada directos, sin mockear Prisma. cargarResumenYVersionCobertura()/
// cargarHistoricoResumenCobertura() se prueban con un cliente falso
// minimo, mismo patron que .../page.test.ts.
import { describe, expect, it, vi } from "vitest";
import {
  cargarHistoricoResumenCobertura,
  cargarResumenYVersionCobertura,
  derivarEstadoVersionCobertura,
  derivarEstadoVersionCoberturaPorImport,
  LIMITE_HISTORICO_COBERTURA,
} from "../resumenCobertura";

describe("derivarEstadoVersionCobertura (pura)", () => {
  it("SIN_FILAS cuando no hay ningun grupo", () => {
    const { estadoVersion, ruleVersion } = derivarEstadoVersionCobertura([]);
    expect(estadoVersion).toBe("SIN_FILAS");
    expect(ruleVersion).toBeNull();
  });

  it("UNICA cuando todos los grupos declaran la misma ruleVersion", () => {
    const { estadoVersion, ruleVersion, porEstado } = derivarEstadoVersionCobertura([
      { estado: "CALCULADA", ruleVersion: "v1", _count: { _all: 8 } },
      { estado: "VALOR_NEGATIVO", ruleVersion: "v1", _count: { _all: 2 } },
    ]);
    expect(estadoVersion).toBe("UNICA");
    expect(ruleVersion).toBe("v1");
    expect(porEstado.CALCULADA).toBe(8);
    expect(porEstado.VALOR_NEGATIVO).toBe(2);
  });

  it("MEZCLADA cuando hay 2+ ruleVersion distintas", () => {
    const { estadoVersion, ruleVersion } = derivarEstadoVersionCobertura([
      { estado: "CALCULADA", ruleVersion: "v1", _count: { _all: 5 } },
      { estado: "CALCULADA", ruleVersion: "v2", _count: { _all: 5 } },
    ]);
    expect(estadoVersion).toBe("MEZCLADA");
    expect(ruleVersion).toBeNull();
  });
});

describe("derivarEstadoVersionCoberturaPorImport (pura)", () => {
  it("deriva estadoVersion/ruleVersion por importId de forma independiente", () => {
    const { estadoVersionPorImport, ruleVersionPorImport, porImportEstado } = derivarEstadoVersionCoberturaPorImport([
      { importId: "imp-1", estado: "CALCULADA", ruleVersion: "v1", _count: { _all: 10 } },
      { importId: "imp-2", estado: "CALCULADA", ruleVersion: "v1", _count: { _all: 5 } },
      { importId: "imp-2", estado: "CALCULADA", ruleVersion: "v2", _count: { _all: 5 } },
    ]);
    expect(estadoVersionPorImport.get("imp-1")).toBe("UNICA");
    expect(ruleVersionPorImport.get("imp-1")).toBe("v1");
    expect(estadoVersionPorImport.get("imp-2")).toBe("MEZCLADA");
    expect(ruleVersionPorImport.get("imp-2")).toBeNull();
    expect(porImportEstado.get("imp-1")?.CALCULADA).toBe(10);
  });

  it("un importId sin ningun grupo no aparece en ningun Map (el llamador lo trata como SIN_FILAS)", () => {
    const { estadoVersionPorImport } = derivarEstadoVersionCoberturaPorImport([]);
    expect(estadoVersionPorImport.get("imp-fantasma")).toBeUndefined();
  });
});

describe("cargarResumenYVersionCobertura", () => {
  it("consulta groupBy+count con el where esperado y deriva resumen/estadoVersion/ruleVersion", async () => {
    const groupByMock = vi.fn(async () => [
      { estado: "CALCULADA", ruleVersion: "v1", _count: { _all: 8 } },
      { estado: "VALOR_NEGATIVO", ruleVersion: "v1", _count: { _all: 2 } },
    ]);
    const countMock = vi.fn(async () => 0);
    const cliente = {
      observacionCobertura: { groupBy: groupByMock, count: countMock },
    } as unknown as Parameters<typeof cargarResumenYVersionCobertura>[0];

    const resultado = await cargarResumenYVersionCobertura(cliente, "imp-1");

    expect(groupByMock).toHaveBeenCalledWith({ by: ["estado", "ruleVersion"], where: { importId: "imp-1" }, _count: { _all: true } });
    expect(countMock).toHaveBeenCalledWith({ where: { importId: "imp-1", estado: "CALCULADA", coberturaDias: 0 } });
    expect(resultado.estadoVersion).toBe("UNICA");
    expect(resultado.ruleVersion).toBe("v1");
    expect(resultado.totalFilasPersistidas).toBe(10);
    expect(resultado.resumen.total).toBe(10);
  });
});

describe("cargarHistoricoResumenCobertura", () => {
  it("sin confirmadaEnActual -- devuelve [] sin consultar nada", async () => {
    const importacionCsvFindManyMock = vi.fn();
    const cliente = {
      importacionCsv: { findMany: importacionCsvFindManyMock },
      observacionCobertura: { groupBy: vi.fn() },
    } as unknown as Parameters<typeof cargarHistoricoResumenCobertura>[0];

    const resultado = await cargarHistoricoResumenCobertura(cliente, "cad-1", "imp-2", null);

    expect(resultado).toEqual([]);
    expect(importacionCsvFindManyMock).not.toHaveBeenCalled();
  });

  it("sin importaciones historicas -- devuelve [] y NUNCA llama a groupBy (early return)", async () => {
    const groupByMock = vi.fn();
    const cliente = {
      importacionCsv: { findMany: vi.fn(async () => []) },
      observacionCobertura: { groupBy: groupByMock },
    } as unknown as Parameters<typeof cargarHistoricoResumenCobertura>[0];

    const resultado = await cargarHistoricoResumenCobertura(cliente, "cad-1", "imp-2", new Date("2026-11-10"));

    expect(resultado).toEqual([]);
    expect(groupByMock).not.toHaveBeenCalled();
  });

  it("con importaciones historicas -- pide el limite esperado y devuelve en orden cronologico ascendente", async () => {
    const importacionCsvFindManyMock = vi.fn(async () => [
      { id: "imp-1", periodoReferenciaConsumoInicio: null, periodoReferenciaConsumoFin: null },
    ]);
    const groupByMock = vi.fn().mockImplementation((args: { by: string[] }) => {
      if (args.by.includes("estado")) {
        return Promise.resolve([{ importId: "imp-1", estado: "CALCULADA", ruleVersion: "v1", _count: { _all: 10 } }]);
      }
      return Promise.resolve([{ importId: "imp-1", _count: { _all: 0 } }]);
    });
    const cliente = {
      importacionCsv: { findMany: importacionCsvFindManyMock },
      observacionCobertura: { groupBy: groupByMock },
    } as unknown as Parameters<typeof cargarHistoricoResumenCobertura>[0];

    const resultado = await cargarHistoricoResumenCobertura(cliente, "cad-1", "imp-2", new Date("2026-11-10"));

    expect(importacionCsvFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: LIMITE_HISTORICO_COBERTURA, where: expect.objectContaining({ cadenaId: "cad-1" }) }),
    );
    expect(resultado).toHaveLength(1);
    const [primero] = resultado;
    expect(primero?.importId).toBe("imp-1");
    expect(primero?.estadoVersion).toBe("UNICA");
    expect(primero?.ruleVersion).toBe("v1");
  });
});
