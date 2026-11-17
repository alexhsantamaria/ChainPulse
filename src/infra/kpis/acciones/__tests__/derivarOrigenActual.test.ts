// Pruebas -- derivarOrigenActualAccionKpi() (correccion de ronda de
// revision, bloqueante 1). Clientes falsos minimos (sin Prisma real,
// sin Neon) que simulan EXACTAMENTE las consultas que
// cargarHistoricoObservacionesKpi()/cargarResumenYVersionCobertura()/
// cargarHistoricoResumenCobertura() emiten -- mismo patron de dispatch
// por forma de `groupBy.by` que ya usa .../cobertura/importaciones/[id]/
// __tests__/page.test.ts (construirClienteFalso), para que sea el
// MISMO codigo real (no una copia) el que se ejercita.
import { describe, expect, it, vi } from "vitest";
import { derivarOrigenActualAccionKpi } from "../derivarOrigenActual";

function clienteObservacionKpi(opciones: {
  observacion?: Record<string, unknown> | null;
  historico?: Array<Record<string, unknown>>;
}) {
  return {
    observacionKpi: {
      findUnique: vi.fn(async () => opciones.observacion ?? null),
      findMany: vi.fn(async () => [...(opciones.historico ?? [])].reverse()),
    },
  } as unknown as Parameters<typeof derivarOrigenActualAccionKpi>[0];
}

function clienteImportacionCsv(opciones: {
  importacion?: Record<string, unknown> | null;
  porEstadoActual?: Array<{ estado: string; ruleVersion?: string; _count: { _all: number } }>;
  calculadaConCeroDiasActual?: number;
  importacionesHistoricas?: Array<{ id: string; confirmadaEn: Date }>;
  porEstadoHistoricoPorImport?: Record<string, Array<{ estado: string; ruleVersion?: string; _count: { _all: number } }>>;
  ceroDiasHistoricoPorImport?: Record<string, number>;
}) {
  const importacionCsvFindManyMock = vi.fn().mockImplementation((args: { where?: { confirmadaEn?: { lt?: Date } } }) => {
    const todas = opciones.importacionesHistoricas ?? [];
    const limite = args?.where?.confirmadaEn?.lt;
    if (!limite) return Promise.resolve(todas);
    return Promise.resolve(todas.filter((imp) => imp.confirmadaEn.getTime() < limite.getTime()));
  });

  const groupByMock = vi.fn().mockImplementation((args: { by: string[] }) => {
    if (!args.by.includes("importId")) {
      const filas = (opciones.porEstadoActual ?? []).map((g) => ({ estado: g.estado, ruleVersion: g.ruleVersion ?? "v1", _count: g._count }));
      return Promise.resolve(filas);
    }
    if (args.by.includes("estado")) {
      const mapa = opciones.porEstadoHistoricoPorImport ?? {};
      const salida: Array<{ importId: string; estado: string; ruleVersion: string; _count: { _all: number } }> = [];
      for (const [importId, grupos] of Object.entries(mapa)) {
        for (const g of grupos) salida.push({ importId, estado: g.estado, ruleVersion: g.ruleVersion ?? "v1", _count: g._count });
      }
      return Promise.resolve(salida);
    }
    const mapaCero = opciones.ceroDiasHistoricoPorImport ?? {};
    return Promise.resolve(Object.entries(mapaCero).map(([importId, cantidad]) => ({ importId, _count: { _all: cantidad } })));
  });

  return {
    importacionCsv: {
      findUnique: vi.fn(async () => opciones.importacion ?? null),
      findMany: importacionCsvFindManyMock,
    },
    observacionCobertura: {
      groupBy: groupByMock,
      count: vi.fn(async () => opciones.calculadaConCeroDiasActual ?? 0),
    },
  } as unknown as Parameters<typeof derivarOrigenActualAccionKpi>[0];
}

describe("derivarOrigenActualAccionKpi -- OBSERVACION_KPI", () => {
  it("rechaza con OBSERVACION_KPI_INEXISTENTE cuando el id no existe", async () => {
    const cliente = clienteObservacionKpi({ observacion: null });
    const resultado = await derivarOrigenActualAccionKpi(cliente, { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-x" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("OBSERVACION_KPI_INEXISTENTE");
  });

  it("rechaza con ORIGEN_SIN_RECOMENDACION_ACCIONABLE cuando no hay historico (SIN_HISTORICO)", async () => {
    const cliente = clienteObservacionKpi({
      observacion: {
        id: "obs-1",
        empresaId: "emp-1",
        cadenaId: "cad-1",
        definicionKpiId: "def-otif",
        periodoInicio: new Date("2026-11-01"),
        periodoFin: new Date("2026-11-30"),
        valor: 0.7,
        numerador: 70,
        denominador: 100,
        ruleVersion: "kpis-v1",
      },
      historico: [],
    });
    const resultado = await derivarOrigenActualAccionKpi(cliente, { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("ORIGEN_SIN_RECOMENDACION_ACCIONABLE");
  });

  it("rechaza con ORIGEN_SIN_RECOMENDACION_ACCIONABLE cuando el periodo anterior es MEJOR (prioridad BAJA, sin siguienteAccionPropuesta)", async () => {
    const cliente = clienteObservacionKpi({
      observacion: {
        id: "obs-1",
        empresaId: "emp-1",
        cadenaId: "cad-1",
        definicionKpiId: "def-otif",
        periodoInicio: new Date("2026-11-01"),
        periodoFin: new Date("2026-11-30"),
        valor: 0.9,
        numerador: 90,
        denominador: 100,
        ruleVersion: "kpis-v1",
      },
      historico: [
        {
          id: "obs-0",
          periodoInicio: new Date("2026-10-01"),
          periodoFin: new Date("2026-10-31"),
          valor: 0.7,
          numerador: 70,
          denominador: 100,
          ruleVersion: "kpis-v1",
        },
      ],
    });
    const resultado = await derivarOrigenActualAccionKpi(cliente, { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("ORIGEN_SIN_RECOMENDACION_ACCIONABLE");
  });

  it("deriva ruleVersionOrigen/prioridadOrigen=ALTA cuando el analisis real detecta un empeoramiento grande", async () => {
    const cliente = clienteObservacionKpi({
      observacion: {
        id: "obs-1",
        empresaId: "emp-1",
        cadenaId: "cad-1",
        definicionKpiId: "def-otif",
        periodoInicio: new Date("2026-11-01"),
        periodoFin: new Date("2026-11-30"),
        valor: 0.65,
        numerador: 65,
        denominador: 100,
        ruleVersion: "kpis-v2",
      },
      historico: [
        {
          id: "obs-0",
          periodoInicio: new Date("2026-10-01"),
          periodoFin: new Date("2026-10-31"),
          valor: 0.8,
          numerador: 80,
          denominador: 100,
          ruleVersion: "kpis-v2",
        },
      ],
    });
    const resultado = await derivarOrigenActualAccionKpi(cliente, { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.empresaId).toBe("emp-1");
      expect(resultado.cadenaId).toBe("cad-1");
      expect(resultado.ruleVersionOrigen).toBe("kpis-v2");
      expect(resultado.prioridadOrigen).toBe("ALTA");
    }
  });
});

describe("derivarOrigenActualAccionKpi -- IMPORTACION_CSV", () => {
  it("rechaza con IMPORTACION_CSV_INEXISTENTE cuando el id no existe", async () => {
    const cliente = clienteImportacionCsv({ importacion: null });
    const resultado = await derivarOrigenActualAccionKpi(cliente, { tipo: "IMPORTACION_CSV", importacionCsvId: "imp-x" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("IMPORTACION_CSV_INEXISTENTE");
  });

  it("rechaza con ORIGEN_SIN_RECOMENDACION_ACCIONABLE cuando la importacion actual no tiene filas (SIN_FILAS -> TOTAL_CERO)", async () => {
    const cliente = clienteImportacionCsv({
      importacion: { id: "imp-1", empresaId: "emp-1", cadenaId: "cad-1", confirmadaEn: new Date("2026-11-05") },
      porEstadoActual: [],
    });
    const resultado = await derivarOrigenActualAccionKpi(cliente, { tipo: "IMPORTACION_CSV", importacionCsvId: "imp-1" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("ORIGEN_SIN_RECOMENDACION_ACCIONABLE");
  });

  it("deriva ruleVersionOrigen/prioridadOrigen=ALTA cuando el analisis real detecta un aumento grande de la tasa de errores", async () => {
    const cliente = clienteImportacionCsv({
      importacion: { id: "imp-2", empresaId: "emp-1", cadenaId: "cad-1", confirmadaEn: new Date("2026-11-10") },
      porEstadoActual: [
        { estado: "VALOR_NEGATIVO", ruleVersion: "cobertura-v1", _count: { _all: 40 } },
        { estado: "CALCULADA", ruleVersion: "cobertura-v1", _count: { _all: 60 } },
      ],
      calculadaConCeroDiasActual: 0,
      importacionesHistoricas: [{ id: "imp-1", confirmadaEn: new Date("2026-11-01") }],
      porEstadoHistoricoPorImport: {
        "imp-1": [
          { estado: "CALCULADA", ruleVersion: "cobertura-v1", _count: { _all: 100 } },
        ],
      },
      ceroDiasHistoricoPorImport: { "imp-1": 0 },
    });
    const resultado = await derivarOrigenActualAccionKpi(cliente, { tipo: "IMPORTACION_CSV", importacionCsvId: "imp-2" });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.empresaId).toBe("emp-1");
      expect(resultado.cadenaId).toBe("cad-1");
      expect(resultado.ruleVersionOrigen).toBe("cobertura-v1");
      expect(resultado.prioridadOrigen).toBe("ALTA");
    }
  });
});
