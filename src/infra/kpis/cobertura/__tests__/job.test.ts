// Pruebas -- job de procesamiento de ImportacionCsv de Cobertura
// (Incremento 4 Bloque B). Todas las dependencias externas (Prisma, R2,
// cifrado, el CSV en si) van mockeadas -- mismo motivo que
// purgaHuellaOrigenJob.test.ts: importar el singleton real de
// prisma/client.ts construye un PrismaClient real al cargar el modulo, y
// eso falla mientras "prisma generate" siga bloqueado en este entorno
// (ver README.md).
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../prisma/client", () => ({ prisma: { definicionKpi: { findUnique: vi.fn() } } }));

const importacionCsvMock = {
  findUnique: vi.fn(),
  update: vi.fn(),
};
vi.mock("../../../prisma/tenantClient", () => ({
  tenantClient: () => ({ importacionCsv: importacionCsvMock }),
}));

const descargarObjetoMock = vi.fn();
vi.mock("../../../storage/r2", () => ({
  ClienteAlmacenamientoR2: vi.fn().mockImplementation(() => ({ descargarObjeto: descargarObjetoMock })),
}));

vi.mock("../../../storage/cifradoObjeto", () => ({
  obtenerClaveMaestraPorId: vi.fn().mockReturnValue(Buffer.alloc(32)),
  desenvolverDek: vi.fn().mockReturnValue(Buffer.alloc(32)),
  descifrarContenido: vi.fn(),
}));

const importarObservacionesCoberturaMock = vi.fn();
const retirarObservacionesFueraDeAlcanceMock = vi.fn();
vi.mock("../importar", async () => {
  const actual = await vi.importActual<typeof import("../importar")>("../importar");
  return {
    ...actual,
    importarObservacionesCobertura: (...args: unknown[]) => importarObservacionesCoberturaMock(...args),
    retirarObservacionesFueraDeAlcance: (...args: unknown[]) => retirarObservacionesFueraDeAlcanceMock(...args),
  };
});

const CSV_VALIDO = "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons\nA-001,LIMA,2026-09-24,100,unidad,10,unidad\n";

const MAPEO_CONFIRMADO = {
  sku: "sku",
  ubicacion: "ubicacion",
  fechaCorte: "fecha",
  inventarioDisponible: "inventario",
  unidadInventario: "unidad_inv",
  consumoDiarioEsperado: "consumo",
  unidadConsumoDiario: "unidad_cons",
};

function importacionBase(overrides: Record<string, unknown> = {}) {
  return {
    id: "import-1",
    empresaId: "empresa-1",
    cadenaId: "cadena-1",
    definicionKpiId: "def-1",
    objetoStorageKey: "empresas/empresa-1/imports/import-1/cifrado.bin",
    cifradoVersion: 1,
    cifradoClaveId: "clave-activa",
    cifradoDek: "dek",
    cifradoDekIv: "iv",
    cifradoDekAuthTag: "authTag",
    mapeoColumnas: { encabezados: Object.values(MAPEO_CONFIRMADO), propuesto: MAPEO_CONFIRMADO, confirmado: MAPEO_CONFIRMADO },
    estrategia: "CARGA_PARCIAL",
    alcanceFechaCorteInicio: null,
    alcanceFechaCorteFin: null,
    alcanceUbicaciones: null,
    fuenteConsumo: "ERP mayo 2026",
    periodoReferenciaConsumoInicio: new Date("2026-05-01T12:00:00.000Z"),
    periodoReferenciaConsumoFin: new Date("2026-05-31T12:00:00.000Z"),
    confirmadaEn: new Date("2026-09-25T00:00:00.000Z"),
    procesadaEn: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  descargarObjetoMock.mockResolvedValue(Buffer.from("cifrado"));
  importarObservacionesCoberturaMock.mockResolvedValue({ insertadas: 1, corregidas: 0, sinCambios: 0, yaProcesadas: 0 });
});

describe("procesarUnaImportacionCsv", () => {
  it("importacion inexistente (o de otro tenant, filtrada por tenantClient) -- no hace nada, no lanza", async () => {
    importacionCsvMock.findUnique.mockResolvedValue(null);
    const { procesarUnaImportacionCsv } = await import("../job");
    await expect(procesarUnaImportacionCsv({ importId: "x", empresaId: "empresa-1" })).resolves.toBeUndefined();
    expect(importacionCsvMock.update).not.toHaveBeenCalled();
  });

  it("ya procesada (procesadaEn seteado) -- no-op, nunca reprocesa ni repite el retiro", async () => {
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ procesadaEn: new Date() }));
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importacionCsvMock.update).not.toHaveBeenCalled();
    expect(importarObservacionesCoberturaMock).not.toHaveBeenCalled();
  });

  it("sin confirmadaEn -- lanza (no deberia estar en la cola)", async () => {
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ confirmadaEn: null }));
    const { procesarUnaImportacionCsv } = await import("../job");
    await expect(procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" })).rejects.toThrow();
  });

  it("falta fuenteConsumo -- marca ERROR y no procesa ninguna fila", async () => {
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ fuenteConsumo: null }));
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ERROR" }) }),
    );
    expect(importarObservacionesCoberturaMock).not.toHaveBeenCalled();
  });

  it("falta el mapeo confirmado -- marca ERROR", async () => {
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({ mapeoColumnas: { encabezados: [], propuesto: {}, confirmado: null } }),
    );
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ERROR" }) }),
    );
  });

  it("REEMPLAZO_ALCANCE sin alcance completo -- marca ERROR, nunca retira nada", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({ estrategia: "REEMPLAZO_ALCANCE", alcanceFechaCorteInicio: null }),
    );
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(retirarObservacionesFueraDeAlcanceMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ERROR" }) }),
    );
  });

  it("procesamiento exitoso: escribe las filas, marca CONFIRMADA + procesadaEn", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase());
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importarObservacionesCoberturaMock).toHaveBeenCalledTimes(1);
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: "CONFIRMADA", procesadaEn: expect.any(Date), filasDetectadas: 1, filasConError: 0 }),
      }),
    );
  });

  it("mapeo confirmado ya no coincide con los encabezados reales del archivo -- marca ERROR, nunca procesa a ciegas", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from("otra,cosa\n1,2\n"));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase());
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importarObservacionesCoberturaMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ERROR" }) }),
    );
  });
});

describe("procesarImportacionesCsv", () => {
  function bossFalso(overrides?: { jobs?: Array<{ id: string; data: unknown }> }) {
    return {
      fetch: vi.fn().mockResolvedValue(overrides?.jobs ?? []),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue("job-id"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo los 4 metodos de arriba hacen falta.
    } as any;
  }

  it("sin jobs pendientes -- no llama a complete/fail", async () => {
    const { procesarImportacionesCsv } = await import("../job");
    const boss = bossFalso({ jobs: [] });
    const r = await procesarImportacionesCsv(boss);
    expect(r).toEqual({ procesados: 0 });
    expect(boss.complete).not.toHaveBeenCalled();
    expect(boss.fail).not.toHaveBeenCalled();
  });

  it("un job que falla se marca con fail(), no interrumpe el resto de la cola", async () => {
    importacionCsvMock.findUnique.mockRejectedValueOnce(new Error("conexion caida"));
    importacionCsvMock.findUnique.mockResolvedValueOnce(null); // el segundo job: importacion inexistente, no-op exitoso
    const { procesarImportacionesCsv, COLA_IMPORTACION_CSV } = await import("../job");
    const boss = bossFalso({
      jobs: [
        { id: "job-1", data: { importId: "import-1", empresaId: "empresa-1" } },
        { id: "job-2", data: { importId: "import-2", empresaId: "empresa-1" } },
      ],
    });
    const r = await procesarImportacionesCsv(boss);
    expect(r).toEqual({ procesados: 2 });
    expect(boss.fail).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-1", { mensaje: "conexion caida" });
    expect(boss.complete).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-2");
  });
});

describe("encolarImportacionCsv", () => {
  it("usa singletonKey=importId y retryLimit>0 (nunca duplica el job de la misma importacion)", async () => {
    const { encolarImportacionCsv, COLA_IMPORTACION_CSV } = await import("../job");
    const boss = { send: vi.fn().mockResolvedValue("job-id") } as unknown as import("pg-boss").PgBoss;
    await encolarImportacionCsv(boss, { importId: "import-1", empresaId: "empresa-1" });
    expect(boss.send).toHaveBeenCalledWith(
      COLA_IMPORTACION_CSV,
      { importId: "import-1", empresaId: "empresa-1" },
      expect.objectContaining({ singletonKey: "import-1", retryLimit: expect.any(Number) }),
    );
  });
});
