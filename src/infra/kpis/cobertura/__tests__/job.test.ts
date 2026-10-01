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

const CSV_CON_COLUMNA_SOSPECHOSA =
  "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons,fuente consumo\n" +
  "A-001,LIMA,2026-09-24,100,unidad,10,unidad,ERP mayo\n";


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

  // Bug real encontrado por Alex (2026-09-25... reportado de nuevo el
  // 2026-09-29, importacion b221c930-054e-...): la ruta de confirmar YA
  // validaba `columnasSospechosasReconocidas` del body pero nunca la
  // persistia -- este job volvia a detectar la misma columna sospechosa
  // y, sin la lista persistida, la trataba SIEMPRE como no reconocida,
  // aunque la confirmacion hubiera sido perfectamente valida. Las dos
  // pruebas de abajo fijan el contrato correcto: reconocida -> procesa
  // bien; NO reconocida -> sigue fallando (nunca se saca la validacion
  // en si, solo se corrige contra que la compara -- pedido explicito de
  // Alex).
  it("columna sospechosa RECONOCIDA en sospechosasReconocidas -- procesa normalmente, no marca ERROR", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_CON_COLUMNA_SOSPECHOSA));
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({
        mapeoColumnas: {
          encabezados: [...Object.values(MAPEO_CONFIRMADO), "fuente consumo"],
          propuesto: MAPEO_CONFIRMADO,
          confirmado: MAPEO_CONFIRMADO,
          sospechosasReconocidas: ["fuente consumo"],
        },
      }),
    );
    // La resolucion de DefinicionKpi ocurre DESPUES del chequeo de
    // sospechosas (ver job.ts) -- sin este mock, procesarUnaImportacionCsv
    // se detiene ahi con marcarError() y nunca llega a
    // importarObservacionesCobertura, dando un falso negativo en este test.
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importarObservacionesCoberturaMock).toHaveBeenCalled();
    expect(importacionCsvMock.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ERROR" }) }),
    );
  });

  it("columna sospechosa NO reconocida (sospechosasReconocidas ausente o sin incluirla) -- sigue marcando ERROR, defensa en profundidad intacta", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_CON_COLUMNA_SOSPECHOSA));
    importacionCsvMock.findUnique.mockResolvedValue(
      importacionBase({
        mapeoColumnas: {
          encabezados: [...Object.values(MAPEO_CONFIRMADO), "fuente consumo"],
          propuesto: MAPEO_CONFIRMADO,
          confirmado: MAPEO_CONFIRMADO,
          // sospechosasReconocidas ausente a proposito -- mismo estado que
          // tenia CUALQUIER ImportacionCsv confirmada antes de este fix.
        },
      }),
    );
    const { procesarUnaImportacionCsv } = await import("../job");
    await procesarUnaImportacionCsv({ importId: "import-1", empresaId: "empresa-1" });
    expect(importarObservacionesCoberturaMock).not.toHaveBeenCalled();
    expect(importacionCsvMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: "ERROR",
          erroresMuestra: [{ error: expect.stringContaining("fuente consumo") }],
        }),
      }),
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

// Bug real encontrado por Alex (2026-09-29, importacion
// 52aed226-1b0f-4550-bd30-fdd497ba0ed3): procesarImportacionesCsv(boss, 1)
// (usada antes por el disparo inmediato de la ruta de confirmar) hace
// boss.fetch() sobre TODA la cola compartida -- toma el job MAS VIEJO
// por created_on, sin importar cual importacion disparo la llamada. Si
// habia un reintento de OTRA importacion mas viejo esperando, ESE se
// procesaba y el job recien encolado se quedaba esperando indefinidamente
// (confirmado con pgboss.job real en Windows). procesarImportacionCsvPropia()
// reemplaza a esa funcion en el disparo inmediato -- reclama por
// singleton_key (el importId puntual), nunca por "el mas viejo".
describe("procesarImportacionCsvPropia", () => {
  // Fake de boss.getDb() -- solo necesita executeSql(), igual criterio que
  // el fake `boss` de procesarImportacionesCsv() mas arriba (as any, solo
  // los metodos que hacen falta).
  function crearBossFake(executeSqlImpl: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }>) {
    const executeSqlMock = vi.fn(executeSqlImpl);
    const completeMock = vi.fn().mockResolvedValue(undefined);
    const failMock = vi.fn().mockResolvedValue(undefined);
    const boss = {
      getDb: () => ({ executeSql: executeSqlMock }),
      complete: completeMock,
      fail: failMock,
      // Si procesarImportacionCsvPropia() alguna vez llamara a fetch()
      // (el mecanismo generico "el mas viejo de la cola"), esto explota
      // la prueba en vez de dejarlo pasar en silencio -- ver la prueba
      // de abajo que se apoya en esto.
      fetch: vi.fn(() => {
        throw new Error("procesarImportacionCsvPropia() NUNCA debe llamar a boss.fetch() generico -- ver el comentario de la funcion en job.ts");
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo los metodos de arriba hacen falta.
    } as any;
    return { boss, executeSqlMock, completeMock, failMock };
  }

  it("reclamo exitoso (1 fila afectada) -- nunca llama a boss.fetch(), reclama por singleton_key=importId, procesa y completa", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ id: "import-1" }));

    const { procesarImportacionCsvPropia, COLA_IMPORTACION_CSV } = await import("../job");
    const { boss, executeSqlMock, completeMock, failMock } = crearBossFake(async () => ({ rows: [{ id: "job-uuid-1" }] }));

    const resultado = await procesarImportacionCsvPropia(boss, { importId: "import-1", empresaId: "empresa-1" });

    expect(resultado).toEqual({ procesado: true });
    // El reclamo se filtra por (name, singleton_key) -- nunca por
    // ORDER BY/LIMIT como el fetch() generico (ver plans.js fetchNextJob).
    expect(executeSqlMock).toHaveBeenCalledWith(expect.stringContaining("singleton_key = $2"), [COLA_IMPORTACION_CSV, "import-1"]);
    expect(importarObservacionesCoberturaMock).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-uuid-1");
    expect(failMock).not.toHaveBeenCalled();
  });

  it("reclamo vacio (0 filas afectadas -- el job ya estaba active/completed/failed, por ejemplo tomado antes por el cron de respaldo) -- no-op silencioso, nunca procesa ni completa/falla nada", async () => {
    const { procesarImportacionCsvPropia } = await import("../job");
    const { boss, completeMock, failMock } = crearBossFake(async () => ({ rows: [] }));

    const resultado = await procesarImportacionCsvPropia(boss, { importId: "import-1", empresaId: "empresa-1" });

    expect(resultado).toEqual({ procesado: false });
    expect(importacionCsvMock.findUnique).not.toHaveBeenCalled();
    expect(importarObservacionesCoberturaMock).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
    expect(failMock).not.toHaveBeenCalled();
  });

  it("reclamo exitoso pero procesarUnaImportacionCsv lanza -- boss.fail con el mensaje real, nunca boss.complete", async () => {
    // Mismo disparador que "sin confirmadaEn -- lanza" (arriba): la mas
    // simple para hacer que procesarUnaImportacionCsv() lance de verdad
    // sin mockear su interior.
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ confirmadaEn: null }));

    const { procesarImportacionCsvPropia, COLA_IMPORTACION_CSV } = await import("../job");
    const { boss, completeMock, failMock } = crearBossFake(async () => ({ rows: [{ id: "job-uuid-1" }] }));

    const resultado = await procesarImportacionCsvPropia(boss, { importId: "import-1", empresaId: "empresa-1" });

    expect(resultado).toEqual({ procesado: true }); // se reclamo y se INTENTO procesar -- "procesado" describe el intento, no el exito (mismo criterio que procesarImportacionesCsv(), que tambien completa "procesados" contando los que fallaron via boss.fail).
    expect(completeMock).not.toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith(
      COLA_IMPORTACION_CSV,
      "job-uuid-1",
      expect.objectContaining({ mensaje: expect.stringContaining("import-1") }),
    );
  });

  it("un job MAS VIEJO de OTRA importacion, pendiente en la misma cola, no afecta el reclamo -- se reclama y procesa igual la importacion propia (regresion directa del bug real)", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ id: "import-1" }));

    const { procesarImportacionCsvPropia, COLA_IMPORTACION_CSV } = await import("../job");
    // El UPDATE real (ver job.ts) filtra por WHERE singleton_key = $2 --
    // este fake reproduce esa semantica: solo devuelve una fila si el
    // singleton_key pedido es el de ESTA importacion, nunca el de la
    // importacion vieja/ajena ("import-viejo-pendiente") que en el bug
    // real llevaba 22 minutos esperando su retryDelay en la misma cola.
    const { boss, executeSqlMock, completeMock } = crearBossFake(async (_text, values) => {
      const singletonKeyPedido = (values as unknown[])[1];
      if (singletonKeyPedido === "import-1") return { rows: [{ id: "job-uuid-1" }] };
      return { rows: [] }; // "import-viejo-pendiente" nunca se reclama desde aca.
    });

    const resultado = await procesarImportacionCsvPropia(boss, { importId: "import-1", empresaId: "empresa-1" });

    expect(resultado).toEqual({ procesado: true });
    expect(executeSqlMock).toHaveBeenCalledWith(expect.any(String), [COLA_IMPORTACION_CSV, "import-1"]);
    // Nunca se pidio el job viejo -- la prueba en si misma demuestra que
    // procesarImportacionCsvPropia() no tiene forma de tomar otro job:
    // el unico singleton_key que aparece en cualquier llamada a
    // executeSql es el de la importacion propia.
    for (const llamada of executeSqlMock.mock.calls) {
      expect((llamada[1] as unknown[])[1]).toBe("import-1");
    }
    expect(importarObservacionesCoberturaMock).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-uuid-1");
  });
});

// Alex, 2026-09-29 (revision del script de desbloqueo puntual de
// 52aed226-1b0f-4550-bd30-fdd497ba0ed3): "el reclamo debe incluir el
// jobId exacto en el mismo UPDATE, junto con la cola, importId, empresa
// y condiciones de elegibilidad. Si no coincide, debe afectar cero
// filas. La comprobacion posterior no sustituye esa proteccion."
//
// Estas pruebas mockeadas cubren jobId/empresa incorrectos (la funcion
// solo recibe UN valor de importId que alimenta tanto singleton_key como
// data.importId, asi que un mock no puede desincronizar esos dos por su
// cuenta) -- el caso "data.importId incorrecto pero singleton_key
// coincide" (defensa en profundidad, ver el comentario de la funcion en
// job.ts) solo se puede probar contra Postgres real, corrompiendo el
// campo data.importId de forma independiente: ver
// reclamarJobPorIdSoloConCoincidenciaExacta.integration.test.ts.
describe("reclamarJobImportacionCsvPorId", () => {
  // Mismo fake que crearBossFake() de procesarImportacionCsvPropia() mas
  // arriba -- boss.fetch() explota si algo llega a llamarlo, para que
  // cualquier regresion hacia el mecanismo generico "el mas viejo de la
  // cola" reviente la prueba en vez de pasar en silencio.
  function crearBossFake(executeSqlImpl: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }>) {
    const executeSqlMock = vi.fn(executeSqlImpl);
    const completeMock = vi.fn().mockResolvedValue(undefined);
    const failMock = vi.fn().mockResolvedValue(undefined);
    const boss = {
      getDb: () => ({ executeSql: executeSqlMock }),
      complete: completeMock,
      fail: failMock,
      fetch: vi.fn(() => {
        throw new Error("reclamarJobImportacionCsvPorId() NUNCA debe llamar a boss.fetch() generico -- ver el comentario de la funcion en job.ts");
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo los metodos de arriba hacen falta.
    } as any;
    return { boss, executeSqlMock, completeMock, failMock };
  }

  it("jobId, cola, importId y empresa coinciden -- reclama exactamente ese job, procesa y completa (y el SQL incluye el chequeo de data.importId)", async () => {
    const { descifrarContenido } = await import("../../../storage/cifradoObjeto");
    (descifrarContenido as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(CSV_VALIDO));
    (await import("../../../prisma/client")).prisma.definicionKpi.findUnique = vi
      .fn()
      .mockResolvedValue({ id: "def-1", zonaHoraria: "America/Lima" });
    importacionCsvMock.findUnique.mockResolvedValue(importacionBase({ id: "import-1" }));

    const { reclamarJobImportacionCsvPorId, COLA_IMPORTACION_CSV } = await import("../job");
    const { boss, executeSqlMock, completeMock, failMock } = crearBossFake(async (_text, values) => {
      const [jobIdPedido, namePedido, singletonKeyPedido, empresaIdPedido] = values as unknown[];
      if (jobIdPedido === "job-27f5f447" && namePedido === COLA_IMPORTACION_CSV && singletonKeyPedido === "import-1" && empresaIdPedido === "empresa-1") {
        return { rows: [{ id: "job-27f5f447" }] };
      }
      return { rows: [] };
    });

    const resultado = await reclamarJobImportacionCsvPorId(boss, { importId: "import-1", empresaId: "empresa-1", jobId: "job-27f5f447" });

    expect(resultado).toEqual({ procesado: true });
    expect(executeSqlMock).toHaveBeenCalledWith(
      expect.stringContaining("data ->> 'importId' = $3"),
      ["job-27f5f447", COLA_IMPORTACION_CSV, "import-1", "empresa-1"],
    );
    expect(executeSqlMock).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1"), expect.any(Array));
    expect(importarObservacionesCoberturaMock).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith(COLA_IMPORTACION_CSV, "job-27f5f447");
    expect(failMock).not.toHaveBeenCalled();
  });

  it("jobId incorrecto -- el UPDATE no afecta ninguna fila, no reclama ningun job (ni siquiera el de la misma importacion/empresa)", async () => {
    const { reclamarJobImportacionCsvPorId, COLA_IMPORTACION_CSV } = await import("../job");
    // Simula la semantica real del WHERE id = $1: el unico jobId que
    // matchea es "job-real", nunca "job-id-incorrecto" -- aunque cola,
    // importId y empresa sean exactamente los correctos.
    const { boss, executeSqlMock, completeMock, failMock } = crearBossFake(async (_text, values) => {
      const jobIdPedido = (values as unknown[])[0];
      if (jobIdPedido === "job-real") return { rows: [{ id: "job-real" }] };
      return { rows: [] };
    });

    const resultado = await reclamarJobImportacionCsvPorId(boss, {
      importId: "import-1",
      empresaId: "empresa-1",
      jobId: "job-id-incorrecto",
    });

    expect(resultado).toEqual({ procesado: false });
    expect(executeSqlMock).toHaveBeenCalledWith(expect.any(String), ["job-id-incorrecto", COLA_IMPORTACION_CSV, "import-1", "empresa-1"]);
    // La proteccion es el UPDATE en si -- nada de esto se llama si 0
    // filas fueron afectadas, nunca una comprobacion posterior que lo
    // sustituya.
    expect(importacionCsvMock.findUnique).not.toHaveBeenCalled();
    expect(importarObservacionesCoberturaMock).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
    expect(failMock).not.toHaveBeenCalled();
  });

  it("empresaId incorrecto -- el UPDATE tampoco afecta ninguna fila, no reclama ningun job", async () => {
    const { reclamarJobImportacionCsvPorId, COLA_IMPORTACION_CSV } = await import("../job");
    const { boss, executeSqlMock, completeMock, failMock } = crearBossFake(async (_text, values) => {
      const empresaIdPedido = (values as unknown[])[3];
      if (empresaIdPedido === "empresa-real") return { rows: [{ id: "job-27f5f447" }] };
      return { rows: [] };
    });

    const resultado = await reclamarJobImportacionCsvPorId(boss, {
      importId: "import-1",
      empresaId: "empresa-equivocada",
      jobId: "job-27f5f447",
    });

    expect(resultado).toEqual({ procesado: false });
    expect(executeSqlMock).toHaveBeenCalledWith(expect.any(String), ["job-27f5f447", COLA_IMPORTACION_CSV, "import-1", "empresa-equivocada"]);
    expect(importacionCsvMock.findUnique).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
    expect(failMock).not.toHaveBeenCalled();
  });
});

// recuperarJobActivoVencidoPorId() nunca llama a boss.complete()/fail()/
// fetch() -- es SOLO el UPDATE atomico (ver el comentario de la funcion
// en job.ts: la transicion de estado ES el UPDATE, no hay paso
// posterior). Estas pruebas con mock solo pueden verificar la FORMA del
// SQL/parametros y el manejo de "0 filas afectadas" -- el WHERE en si
// (vencimiento segun job_now(), retry_count < retry_limit, identidad)
// solo se puede probar de verdad contra Postgres real, ver
// recuperarJobActivoVencidoPorIdSoloVencidoYExacto.integration.test.ts.
describe("recuperarJobActivoVencidoPorId", () => {
  function crearExecuteSqlFake(impl: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }>) {
    const executeSqlMock = vi.fn(impl);
    const boss = {
      getDb: () => ({ executeSql: executeSqlMock }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo getDb() hace falta.
    } as any;
    return { boss, executeSqlMock };
  }

  it("jobId, cola, importId y empresa coinciden -- el UPDATE se ejecuta con las 6 precondiciones de fila y el mensaje como output", async () => {
    const { recuperarJobActivoVencidoPorId, COLA_IMPORTACION_CSV } = await import("../job");
    const { boss, executeSqlMock } = crearExecuteSqlFake(async (_text, values) => {
      const [jobIdPedido, namePedido, singletonKeyPedido, empresaIdPedido] = values as unknown[];
      if (jobIdPedido === "job-27f5f447" && namePedido === COLA_IMPORTACION_CSV && singletonKeyPedido === "import-1" && empresaIdPedido === "empresa-1") {
        return { rows: [{ id: "job-27f5f447" }] };
      }
      return { rows: [] };
    });

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId: "import-1", empresaId: "empresa-1", jobId: "job-27f5f447" },
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: true });
    const [sqlUsado, paramsUsados] = executeSqlMock.mock.calls[0] as [string, unknown[]];
    expect(sqlUsado).toContain("state = 'active'");
    expect(sqlUsado).toContain("policy = 'exclusive'");
    expect(sqlUsado).toContain("retry_count < retry_limit");
    expect(sqlUsado).toContain("started_on + expire_seconds * interval '1s'");
    expect(sqlUsado).toContain("data ->> 'importId' = $3");
    expect(sqlUsado).toContain("data ->> 'empresaId' = $4");
    expect(sqlUsado).toContain("state = 'retry'");
    expect(paramsUsados).toEqual([
      "job-27f5f447",
      COLA_IMPORTACION_CSV,
      "import-1",
      "empresa-1",
      JSON.stringify({ mensaje: "recuperacion de prueba" }),
    ]);
  });

  it("jobId incorrecto -- el UPDATE no afecta ninguna fila, recuperado=false", async () => {
    const { recuperarJobActivoVencidoPorId } = await import("../job");
    const { boss } = crearExecuteSqlFake(async (_text, values) => {
      const jobIdPedido = (values as unknown[])[0];
      if (jobIdPedido === "job-real") return { rows: [{ id: "job-real" }] };
      return { rows: [] };
    });

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId: "import-1", empresaId: "empresa-1", jobId: "job-id-incorrecto" },
      "mensaje",
    );

    expect(resultado).toEqual({ recuperado: false });
  });

  it("empresaId incorrecto -- el UPDATE no afecta ninguna fila, recuperado=false", async () => {
    const { recuperarJobActivoVencidoPorId } = await import("../job");
    const { boss } = crearExecuteSqlFake(async (_text, values) => {
      const empresaIdPedido = (values as unknown[])[3];
      if (empresaIdPedido === "empresa-real") return { rows: [{ id: "job-27f5f447" }] };
      return { rows: [] };
    });

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId: "import-1", empresaId: "empresa-equivocada", jobId: "job-27f5f447" },
      "mensaje",
    );

    expect(resultado).toEqual({ recuperado: false });
  });

  it("importId incorrecto (singleton_key y data.importId) -- el UPDATE no afecta ninguna fila, recuperado=false", async () => {
    const { recuperarJobActivoVencidoPorId } = await import("../job");
    const { boss } = crearExecuteSqlFake(async (_text, values) => {
      const importIdPedido = (values as unknown[])[2];
      if (importIdPedido === "import-real") return { rows: [{ id: "job-27f5f447" }] };
      return { rows: [] };
    });

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId: "import-equivocado", empresaId: "empresa-1", jobId: "job-27f5f447" },
      "mensaje",
    );

    expect(resultado).toEqual({ recuperado: false });
  });
});

// verificarIndiceExclusividadDelJob() es de solo lectura (tableoid,
// pg_index, pg_class -- todos catalogos del sistema, ninguno propio de
// la app). CORREGIDO (Alex, 2026-09-30, tras verificar en Neon): la
// version anterior asumia un nombre de indice fijo ("pgboss.job_i6"),
// que solo es correcto sin particionado -- pg-boss particiona
// pgboss.job por LIST (name), y una cola con partition:false (como
// COLA_IMPORTACION_CSV) cae en la particion DEFAULT compartida
// (pgboss.job_common en la base real de Alex), con el indice generado
// por sustitucion textual, nunca con el nombre literal de la plantilla
// -- confirmado en Neon: pgboss.job_common_i6 sobre pgboss.job_common,
// con indisunique/indisvalid/indisready en true. Por eso esta funcion ya
// no busca por nombre: lee tableoid de la fila real, y despues busca en
// ESA tabla (buscarIndiceExclusividadEnTabla(), extraida por separado)
// un indice cuya ESTRUCTURA matchee -- CORREGIDO OTRA VEZ (Alex,
// 2026-09-30: "Falta comprobar las claves y el predicado del indice de
// exclusividad, no solo dos coincidencias con ILIKE"): ya no basta con
// que pg_get_indexdef() completo contenga las palabras "singleton_key" y
// "exclusive" en cualquier parte -- eso tambien hace match con un
// indice que NO protege nada (cubre solo state='created', o tiene una
// columna clave extra). CORREGIDO UNA TERCERA VEZ (Alex, 2026-10-01:
// "las regex aceptan condiciones adicionales que excluyan nuestro
// job"): tampoco basta con que el predicado CONTENGA ambas condiciones
// -- dos regex `~*` de presencia dejaban pasar un indice con una
// condicion EXTRA (p.ej. `AND singleton_key = 'solo-otro-job'`), que
// sigue mencionando "policy='exclusive'" y "state<='active'" pero en
// realidad solo protege una fila puntual, no la cola completa. La
// consulta ahora exige, columna por columna y contra el predicado
// reconstruido (pg_get_expr()), IGUALDAD EXACTA (normalizada:
// minusculas, espacios colapsados) con el texto que la version
// instalada de pg-boss produce de verdad para esta cola -- no una
// coincidencia de presencia. indnkeyatts=2, columna 1 = 'name', columna
// 2 = exactamente la expresion COALESCE(singleton_key, ''::text), y el
// predicado es exactamente `((state <= 'active'::pgboss.job_state) and
// (policy = 'exclusive'::text))` (normalizado), ni una condicion de mas
// ni de menos. Estas pruebas con mock solo verifican que interpreta
// bien las distintas combinaciones de filas que devuelven esas dos
// consultas (tabla no encontrada, indice ausente, no-unico, invalido,
// no-listo, caso feliz) y que la segunda consulta tiene la forma
// estructural esperada (indnkeyatts, pg_get_indexdef por columna,
// regexp_replace + igualdad exacta sobre pg_get_expr -- nunca un ILIKE
// ni una regex de presencia suelta, nunca un nombre de indice fijo).
// Que el indice realmente exista, tenga esa estructura exacta y este
// valido/listo en la base de verdad (Neon) -- y que un indice
// estructuralmente distinto (solo 'created', con una columna clave de
// mas, o con una condicion adicional que lo angoste a un solo job) sea
// correctamente RECHAZADO -- es algo que solo se confirma contra
// Postgres real: ver los tres escenarios negativos agregados en
// recuperarJobActivoVencidoPorIdSoloVencidoYExacto.integration.test.ts
// (tablas descartables en el schema pgboss), imposibles de probar con
// sentido usando un mock.
describe("verificarIndiceExclusividadDelJob", () => {
  function crearExecuteSqlFake(
    filaTabla: { tabla: string } | undefined,
    filaIndice?: { nombre: string; definicion: string; unico: boolean; valido: boolean; listo: boolean },
  ) {
    let llamada = 0;
    const executeSqlMock = vi.fn(async (_text: string, _values?: unknown[]) => {
      llamada += 1;
      if (llamada === 1) return { rows: filaTabla ? [filaTabla] : [] };
      return { rows: filaIndice ? [filaIndice] : [] };
    });
    const boss = {
      getDb: () => ({ executeSql: executeSqlMock }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo getDb() hace falta.
    } as any;
    return { boss, executeSqlMock };
  }

  it("el jobId no existe (sin fila en pgboss.job) -- tablaFisica null, resto en false/null, y NUNCA llega a buscar el indice", async () => {
    const { verificarIndiceExclusividadDelJob } = await import("../job");
    const { boss, executeSqlMock } = crearExecuteSqlFake(undefined);

    const resultado = await verificarIndiceExclusividadDelJob(boss, "job-inexistente");

    expect(resultado).toEqual({
      tablaFisica: null,
      indiceNombre: null,
      indiceDefinicion: null,
      existe: false,
      unico: false,
      valido: false,
      listo: false,
    });
    expect(executeSqlMock).toHaveBeenCalledTimes(1);
    const [sqlTabla, paramsTabla] = executeSqlMock.mock.calls[0] as [string, unknown[]];
    expect(sqlTabla).toContain("tableoid");
    expect(sqlTabla).toContain("regclass");
    expect(paramsTabla).toEqual(["job-inexistente"]);
  });

  it("la tabla fisica se encuentra (tableoid) pero ningun indice en ella matchea singleton_key+exclusive -- existe=false", async () => {
    const { verificarIndiceExclusividadDelJob } = await import("../job");
    const { boss, executeSqlMock } = crearExecuteSqlFake({ tabla: "pgboss.job_common" }, undefined);

    const resultado = await verificarIndiceExclusividadDelJob(boss, "job-27f5f447");

    expect(resultado).toEqual({
      tablaFisica: "pgboss.job_common",
      indiceNombre: null,
      indiceDefinicion: null,
      existe: false,
      unico: false,
      valido: false,
      listo: false,
    });
    const [sqlIndice, paramsIndice] = executeSqlMock.mock.calls[1] as [string, unknown[]];
    expect(sqlIndice).toContain("pg_index");
    expect(sqlIndice).toContain("pg_class");
    expect(sqlIndice).toContain("indrelid");
    expect(sqlIndice).toContain("indisunique");
    expect(sqlIndice).toContain("indisvalid");
    expect(sqlIndice).toContain("indisready");
    expect(sqlIndice).not.toContain("job_i6"); // nunca por nombre fijo
    // Estructural, no una coincidencia de texto suelta (Alex,
    // 2026-09-30: "no solo dos coincidencias con ILIKE"): exactamente
    // dos columnas clave, columna 1 y columna 2 verificadas por
    // separado, y el predicado reconstruido via pg_get_expr() -- nunca
    // un ILIKE sobre pg_get_indexdef() completo.
    expect(sqlIndice).toContain("indnkeyatts");
    expect(sqlIndice).toContain("pg_get_indexdef(i.indexrelid, 1, true)");
    expect(sqlIndice).toContain("pg_get_indexdef(i.indexrelid, 2, true)");
    expect(sqlIndice).toContain("pg_get_expr(i.indpred, i.indrelid)");
    expect(sqlIndice).not.toContain("pg_get_indexdef(i.indexrelid) ILIKE");
    // Igualdad EXACTA normalizada, no una regex de presencia suelta
    // (Alex, 2026-10-01: "las regex aceptan condiciones adicionales que
    // excluyan nuestro job") -- `~*` de presencia se reemplazo por
    // `regexp_replace(...) = '<texto exacto normalizado>'`, que rechaza
    // cualquier condicion de mas (ver la prueba "condicion adicional"
    // contra Postgres real).
    expect(sqlIndice).toContain("regexp_replace");
    expect(sqlIndice).not.toContain("~*");
    expect(sqlIndice).toContain("((state <= ''active''::pgboss.job_state) and (policy = ''exclusive''::text))");
    expect(paramsIndice).toEqual(["pgboss.job_common"]);
  });

  it("el indice encontrado no es unico (indisunique=false) -- unico=false", async () => {
    const { verificarIndiceExclusividadDelJob } = await import("../job");
    const { boss } = crearExecuteSqlFake(
      { tabla: "pgboss.job_common" },
      { nombre: "job_common_i6", definicion: "CREATE INDEX ...", unico: false, valido: true, listo: true },
    );

    const resultado = await verificarIndiceExclusividadDelJob(boss, "job-27f5f447");

    expect(resultado).toEqual({
      tablaFisica: "pgboss.job_common",
      indiceNombre: "job_common_i6",
      indiceDefinicion: "CREATE INDEX ...",
      existe: true,
      unico: false,
      valido: true,
      listo: true,
    });
  });

  it("el indice existe y es unico pero esta marcado invalido (CREATE INDEX CONCURRENTLY fallido) -- valido=false", async () => {
    const { verificarIndiceExclusividadDelJob } = await import("../job");
    const { boss } = crearExecuteSqlFake(
      { tabla: "pgboss.job_common" },
      { nombre: "job_common_i6", definicion: "CREATE UNIQUE INDEX ...", unico: true, valido: false, listo: true },
    );

    const resultado = await verificarIndiceExclusividadDelJob(boss, "job-27f5f447");

    expect(resultado.existe).toBe(true);
    expect(resultado.unico).toBe(true);
    expect(resultado.valido).toBe(false);
  });

  it("el indice existe, es unico y valido pero todavia no esta listo (CREATE INDEX CONCURRENTLY en construccion) -- listo=false", async () => {
    const { verificarIndiceExclusividadDelJob } = await import("../job");
    const { boss } = crearExecuteSqlFake(
      { tabla: "pgboss.job_common" },
      { nombre: "job_common_i6", definicion: "CREATE UNIQUE INDEX ...", unico: true, valido: true, listo: false },
    );

    const resultado = await verificarIndiceExclusividadDelJob(boss, "job-27f5f447");

    expect(resultado.listo).toBe(false);
  });

  it("caso feliz -- tabla, indice, definicion, unico/valido/listo todos correctos, misma forma que la base real de Alex (pgboss.job_common / pgboss.job_common_i6)", async () => {
    const { verificarIndiceExclusividadDelJob } = await import("../job");
    const { boss } = crearExecuteSqlFake(
      { tabla: "pgboss.job_common" },
      {
        nombre: "job_common_i6",
        definicion:
          "CREATE UNIQUE INDEX job_common_i6 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'exclusive'::text))",
        unico: true,
        valido: true,
        listo: true,
      },
    );

    const resultado = await verificarIndiceExclusividadDelJob(boss, "job-27f5f447");

    expect(resultado).toEqual({
      tablaFisica: "pgboss.job_common",
      indiceNombre: "job_common_i6",
      indiceDefinicion:
        "CREATE UNIQUE INDEX job_common_i6 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'exclusive'::text))",
      existe: true,
      unico: true,
      valido: true,
      listo: true,
    });
  });
});
