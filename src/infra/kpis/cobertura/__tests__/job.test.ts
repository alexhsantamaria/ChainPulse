// Pruebas -- job de procesamiento de ImportacionCsv de Cobertura
// (Incremento 4 Bloque B). Todas las dependencias externas (Prisma, R2,
// cifrado, el CSV en si) van mockeadas -- mismo motivo que
// purgaHuellaOrigenJob.test.ts: importar el singleton real de
// prisma/client.ts construye un PrismaClient real al cargar el modulo, y
// eso falla mientras "prisma generate" siga bloqueado en este entorno
// (ver README.md).
import { describe, expect, it, vi, beforeEach } from "vitest";

// erroresMuestra es Json? -- job.ts usa Prisma.DbNull (nunca `null` a
// secas) cuando no hay errores, ver el comentario en job.ts. El stub
// degradado de @prisma/client en la Mac no expone Prisma.DbNull en
// runtime (confirmado con un smoke test manual, node -e) -- mismo
// mock-centinela que importar.test.ts, para que las aserciones de abajo
// sean deterministas sin depender de ese stub roto.
vi.mock("@prisma/client", () => ({ Prisma: { DbNull: "PRISMA_DB_NULL_MOCK" } }));

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
const finalizarConRetiroAutorizadoMock = vi.fn();
vi.mock("../importar", async () => {
  const actual = await vi.importActual<typeof import("../importar")>("../importar");
  return {
    ...actual,
    importarObservacionesCobertura: (...args: unknown[]) => importarObservacionesCoberturaMock(...args),
    finalizarConRetiroAutorizado: (...args: unknown[]) => finalizarConRetiroAutorizadoMock(...args),
  };
});

const CSV_VALIDO = "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons\nA-001,LIMA,2026-09-24,100,unidad,10,unidad\n";

// Segunda fila con SKU vacio -- interpretarFilaCoberturaCsv.ts la rechaza
// con "SKU vacio" (dominio puro), asi erroresTotales queda con 1 entrada
// real para probar la rama CON errores de CARGA_PARCIAL (erroresMuestra
// != Prisma.DbNull).
const CSV_CON_ERROR =
  "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons\nA-001,LIMA,2026-09-24,100,unidad,10,unidad\n,LIMA,2026-09-24,100,unidad,10,unidad\n";

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
    retiroHashConfirmado: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  descargarObjetoMock.mockResolvedValue(Buffer.from("cifrado"));
  importarObservacionesCoberturaMock.mockResolvedValue({ insertadas: 1, corregidas: 0, sinCambios: 0, yaProcesadas: 0 });
  finalizarConRetiroAutorizadoMock.mockResolvedValue({ ok: true, retiradas: 0 });
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
    expect(finalizarConRetiroAutorizadoMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ERROR" }) }),
    );
  });

  it("REEMPLAZO_ALCANCE con alcance completo pero SIN retiroHashConfirmado -- marca ERROR, nunca llama a finalizarConRetiroAutorizado", async () => {
    // No deberia poder pasar en la practica (la ruta de confirmar siempre
    // lo persiste para REEMPLAZO_ALCANCE) -- el job falla cerrado en vez
    // de asumir una autorizacion que no quedo registrada.
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({
        estrategia: "REEMPLAZO_ALCANCE",
        alcanceFechaCorteInicio: new Date("2026-09-01"),
        alcanceFechaCorteFin: new Date("2026-09-30"),
        alcanceUbicaciones: ["LIMA"],
        retiroHashConfirmado: null,
      }),
    );
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(finalizarConRetiroAutorizadoMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ERROR" }) }),
    );
  });

  // Alex, 2026-09-25 (condiciones de cierre, punto 3, "Opcion A"): el job
  // recomprueba el retiro autorizado antes de retirar/publicar. Estas dos
  // pruebas fijan el contrato de procesarUnaImportacionCsv con
  // finalizarConRetiroAutorizado() (probada aparte, con un `tx` real
  // contra Postgres, en el test de integracion 5.3 -- aca solo se prueba
  // COMO reacciona el job al resultado, con la funcion mockeada).
  it("REEMPLAZO_ALCANCE, el hash recomprobado coincide -- delega retiro+finalizacion a finalizarConRetiroAutorizado, el job NO escribe estado/procesadaEn por su cuenta", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    finalizarConRetiroAutorizadoMock.mockResolvedValue({ ok: true, retiradas: 3 });
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({
        estrategia: "REEMPLAZO_ALCANCE",
        alcanceFechaCorteInicio: new Date("2026-09-01"),
        alcanceFechaCorteFin: new Date("2026-09-30"),
        alcanceUbicaciones: ["LIMA"],
        retiroHashConfirmado: "hash-de-la-confirmacion",
      }),
    );
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(finalizarConRetiroAutorizadoMock).toHaveBeenCalledWith(
      { empresaId: "empresa-1", cadenaId: "cadena-1", importId: "import-1" },
      { fechaCorteInicio: new Date("2026-09-01"), fechaCorteFin: new Date("2026-09-30"), ubicaciones: ["LIMA"] },
      expect.any(Set),
      "hash-de-la-confirmacion",
      expect.objectContaining({ filasDetectadas: 1, filasConError: 0 }),
    );
    // La finalizacion (estado=CONFIRMADA+procesadaEn) ya ocurrio DENTRO de
    // finalizarConRetiroAutorizado (mockeada aca) -- procesarUnaImportacionCsv
    // nunca vuelve a escribir la importacion por su cuenta en este camino.
    expect(importacionCsvMock.update).not.toHaveBeenCalled();
  });

  it("REEMPLAZO_ALCANCE, el hash recomprobado NO coincide -- marca ERROR identificable, nunca retira ni publica nada", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    finalizarConRetiroAutorizadoMock.mockResolvedValue({ ok: false, motivo: "HASH_DESACTUALIZADO" });
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({
        estrategia: "REEMPLAZO_ALCANCE",
        alcanceFechaCorteInicio: new Date("2026-09-01"),
        alcanceFechaCorteFin: new Date("2026-09-30"),
        alcanceUbicaciones: ["LIMA"],
        retiroHashConfirmado: "hash-de-la-confirmacion",
      }),
    );
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(finalizarConRetiroAutorizadoMock).toHaveBeenCalledTimes(1);
    // Identificable (Alex: "marcar un error identificable") -- el mensaje
    // menciona explicitamente que es por desactualizacion del retiro, no
    // un error generico.
    expect(importacionCsvMock.update).toHaveBeenCalledTimes(1);
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "import-1" },
        data: expect.objectContaining({
          estado: "ERROR",
          erroresMuestra: [expect.objectContaining({ error: expect.stringContaining("RETIRO_DESACTUALIZADO_EN_JOB") })],
        }),
      }),
    );
    // Nunca se toca procesadaEn en este camino -- ni aca ni dentro de
    // finalizarConRetiroAutorizado (mockeada: no hizo ninguna escritura
    // real, y el propio contrato de la funcion garantiza que un ok:false
    // no escribe nada, ver importar.ts).
    expect(importacionCsvMock.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ procesadaEn: expect.anything() }) }),
    );
  });

  it("CARGA_PARCIAL nunca llama a finalizarConRetiroAutorizado -- finaliza con su propia escritura directa", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ estrategia: "CARGA_PARCIAL" }));
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(finalizarConRetiroAutorizadoMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "CONFIRMADA", procesadaEn: expect.any(Date) }) }),
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

  it("CARGA_PARCIAL sin errores -- erroresMuestra usa Prisma.DbNull, nunca `null` a secas (Json? lo exige)", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ estrategia: "CARGA_PARCIAL" }));
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        // "PRISMA_DB_NULL_MOCK" es el centinela del mock de @prisma/client
        // de arriba, no el valor real de Prisma.DbNull (undefined en la
        // Mac, un objeto real en Windows) -- lo que prueba esta asercion
        // es que el codigo tomo la rama Prisma.DbNull, no `null`.
        data: expect.objectContaining({ filasConError: 0, erroresMuestra: "PRISMA_DB_NULL_MOCK" }),
      }),
    );
  });

  it("CARGA_PARCIAL con errores -- erroresMuestra guarda el array de muestras, nunca Prisma.DbNull", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_CON_ERROR));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ estrategia: "CARGA_PARCIAL" }));
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          filasDetectadas: 2,
          filasConError: 1,
          erroresMuestra: [expect.objectContaining({ numeroFila: 2, error: expect.stringContaining("SKU vacio") })],
        }),
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

  // Alex, 2026-09-25 (segunda ronda): "recuperacion garantizada... sin
  // BYPASSRLS" se resolvio encolando DENTRO de la misma transaccion de
  // Postgres que persiste la confirmacion (ver [id]/confirmar/route.ts,
  // tenantTransaction() + fromPrisma(tx)) -- esta prueba fija el
  // contrato que esa ruta necesita: pasar `{db: adaptador}` tiene que
  // llegar tal cual a boss.send(), nunca perderse ni ser sobreescrito.
  it("con opciones.db, lo pasa a boss.send() junto con singletonKey/retryLimit (para encolar dentro de una transaccion externa)", async () => {
    const { encolarImportacionCsv, COLA_IMPORTACION_CSV } = await import("../job");
    const boss = { send: vi.fn().mockResolvedValue("job-id") } as unknown as import("pg-boss").PgBoss;
    const dbFalso = { executeSql: vi.fn() } as unknown as import("pg-boss").Db;
    await encolarImportacionCsv(boss, { importId: "import-1", empresaId: "empresa-1" }, { db: dbFalso });
    expect(boss.send).toHaveBeenCalledWith(
      COLA_IMPORTACION_CSV,
      { importId: "import-1", empresaId: "empresa-1" },
      expect.objectContaining({ singletonKey: "import-1", retryLimit: expect.any(Number), db: dbFalso }),
    );
  });

  it("sin opciones.db, no manda la clave db en absoluto (deja que PgBoss use su propio pool)", async () => {
    const { encolarImportacionCsv, COLA_IMPORTACION_CSV } = await import("../job");
    const boss = { send: vi.fn().mockResolvedValue("job-id") } as unknown as import("pg-boss").PgBoss;
    await encolarImportacionCsv(boss, { importId: "import-1", empresaId: "empresa-1" });
    const llamada = (boss.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(llamada).toBeDefined();
    expect(llamada?.[2]).not.toHaveProperty("db");
    void COLA_IMPORTACION_CSV;
  });
});

describe("procesarUnaImportacionCsv -- fallos entre lotes y recuperacion", () => {
  // Alex, 2026-09-25 (segunda ronda), punto 4: "agregá pruebas explícitas
  // de caída entre lotes... singletonKey y procesadaEn son protecciones,
  // pero no sustituyen esas pruebas."
  it("un lote falla a mitad de camino -- nunca llega al retiro por alcance ni marca CONFIRMADA/procesadaEn", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importarObservacionesCoberturaMock.mockRejectedValueOnce(new Error("timeout de Neon a mitad del lote"));
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({ estrategia: "REEMPLAZO_ALCANCE", alcanceFechaCorteInicio: new Date("2026-09-01"), alcanceFechaCorteFin: new Date("2026-09-30"), alcanceUbicaciones: ["LIMA"] }),
    );
    const { procesarUnaImportacionCsv } = await import("../job");
    await expect(procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" })).rejects.toThrow("timeout de Neon a mitad del lote");
    expect(finalizarConRetiroAutorizadoMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).not.toHaveBeenCalled(); // nunca CONFIRMADA/procesadaEn a medias
  });

  it("procesarImportacionesCsv atrapa ese fallo y llama boss.fail() (nunca boss.complete()) -- pg-boss reintenta mas adelante", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importarObservacionesCoberturaMock.mockRejectedValueOnce(new Error("conexion caida a mitad del lote"));
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase());
    const { procesarImportacionesCsv, COLA_IMPORTACION_CSV } = await import("../job");
    const boss = {
      fetch: vi.fn().mockResolvedValue([{ id: "job-1", data: { importId: "import-1", empresaId: "empresa-1" } }]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo los metodos de arriba hacen falta.
    } as any;
    await procesarImportacionesCsv(boss);
    expect(boss.fail).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-1", { mensaje: "conexion caida a mitad del lote" });
    expect(boss.complete).not.toHaveBeenCalled();
  });

  it("reintento tras un crash a mitad de camino: la segunda corrida (procesadaEn todavia null) reprocesa desde el principio sin duplicar el resultado final", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    // Primera corrida: el proceso "muere" a mitad del lote (lanza, nunca
    // llega a escribir procesadaEn) -- simulado dejando findUnique
    // devolviendo procesadaEn:null todavia para la segunda corrida.
    importarObservacionesCoberturaMock.mockRejectedValueOnce(new Error("proceso terminado a mitad de camino"));
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ procesadaEn: null }));
    const { procesarUnaImportacionCsv } = await import("../job");
    await expect(procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" })).rejects.toThrow();
    expect(importarObservacionesCoberturaMock).toHaveBeenCalledTimes(1);

    // Segunda corrida (reintento de pg-boss): esta vez el lote completo
    // funciona -- procesa una sola vez mas y cierra en CONFIRMADA.
    importarObservacionesCoberturaMock.mockResolvedValueOnce({ insertadas: 1, corregidas: 0, sinCambios: 0, yaProcesadas: 0 });
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importarObservacionesCoberturaMock).toHaveBeenCalledTimes(2); // 1 fallida + 1 exitosa, nunca mas
    expect(importacionCsvMock.update).toHaveBeenCalledTimes(1); // solo la escritura final exitosa, ninguna a medias
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "CONFIRMADA", procesadaEn: expect.any(Date) }) }),
    );
  });

  it("caida DESPUES de publicar resultados (procesadaEn ya quedo escrito) pero ANTES de boss.complete() -- la redelivery es un no-op limpio, nunca reprocesa ni repite el retiro", async () => {
    // Simula exactamente ese momento: la escritura de procesadaEn ya se
    // vio en la base (la siguiente lectura la encuentra), pero pg-boss
    // nunca se entero de que el job termino (crash justo despues del
    // update, antes de que procesarImportacionesCsv llegara a
    // boss.complete()) y lo vuelve a entregar.
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ procesadaEn: new Date("2026-09-25T10:00:00.000Z") }));
    const { procesarImportacionesCsv, COLA_IMPORTACION_CSV } = await import("../job");
    const boss = {
      fetch: vi.fn().mockResolvedValue([{ id: "job-1", data: { importId: "import-1", empresaId: "empresa-1" } }]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo los metodos de arriba hacen falta.
    } as any;
    await procesarImportacionesCsv(boss);
    expect(importarObservacionesCoberturaMock).not.toHaveBeenCalled();
    expect(finalizarConRetiroAutorizadoMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).not.toHaveBeenCalled(); // no vuelve a escribir nada
    expect(boss.complete).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-1"); // esta vez si se completa en pg-boss
    expect(boss.fail).not.toHaveBeenCalled();
  });

  // Limite honesto de lo que una prueba con mocks puede probar (Alex
  // pregunto especificamente por "ejecucion concurrente"): esto verifica
  // que NUESTRO codigo no asume acceso exclusivo -- cada job que boss.fetch()
  // entrega se procesa de forma independiente y solo se completa/falla el
  // suyo. La garantia real de "pg-boss nunca entrega el mismo job a dos
  // workers a la vez" es un lock a nivel de fila en Postgres
  // (FOR UPDATE SKIP LOCKED dentro de pg-boss) -- eso NO se puede probar
  // con mocks, ninguna prueba unitaria en la Mac lo demuestra; solo una
  // prueba de integracion contra Postgres real (Windows) lo hace.
  it("dos jobs entregados en el mismo fetch() se procesan de forma independiente -- un fallo en uno no afecta el resultado del otro", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValueOnce(importacionBase({ id: "import-1" }));
    importacionCsvMock.findUnique.mockResolvedValueOnce(importacionBase({ id: "import-2", procesadaEn: null }));
    importarObservacionesCoberturaMock
      .mockResolvedValueOnce({ insertadas: 1, corregidas: 0, sinCambios: 0, yaProcesadas: 0 })
      .mockRejectedValueOnce(new Error("import-2 fallo, import-1 no deberia verse afectada"));
    const { procesarImportacionesCsv, COLA_IMPORTACION_CSV } = await import("../job");
    const boss = {
      fetch: vi.fn().mockResolvedValue([
        { id: "job-1", data: { importId: "import-1", empresaId: "empresa-1" } },
        { id: "job-2", data: { importId: "import-2", empresaId: "empresa-1" } },
      ]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo los metodos de arriba hacen falta.
    } as any;
    const r = await procesarImportacionesCsv(boss);
    expect(r).toEqual({ procesados: 2 });
    expect(boss.complete).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-1");
    expect(boss.fail).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-2", { mensaje: "import-2 fallo, import-1 no deberia verse afectada" });
  });
});
