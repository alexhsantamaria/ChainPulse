// Pruebas -- ruta de confirmar una ImportacionCsv de Cobertura
// (Incremento 4 Bloque B). Alex, 2026-09-25 (segunda ronda de revision):
// "los tests internos del job y el guard compartido no demuestran por si
// solos que las rutas esten correctamente conectadas" -- esta prueba
// llama DIRECTAMENTE al handler POST exportado (mismo objeto Request que
// usaria Next.js), sin levantar un servidor ni instalar una biblioteca
// nueva (alternativa minima que Alex pidio evaluar primero).
//
// Todo lo que toca Prisma/R2/pg-boss va mockeado -- mismo motivo que
// job.test.ts/importar.test.ts (ver su cabecera): "prisma generate" no
// corre en este entorno. Las funciones de dominio PURAS (validarMapeoColumnas,
// detectarColumnasSospechosasDeConsumo, calcularHashVistaPreviaRetiro,
// confirmacionesCoinciden, claveNegocio) se dejan reales a proposito --
// son las que le dan valor real a estas pruebas de "conexion".
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const importacionCsvFindUniqueMock = vi.fn();
const observacionCoberturaFindManyMock = vi.fn();
const tenantClientMock = vi.fn(() => ({
  importacionCsv: { findUnique: importacionCsvFindUniqueMock },
  observacionCobertura: { findMany: observacionCoberturaFindManyMock },
}));
vi.mock("@/infra/prisma/tenantClient", () => ({
  tenantClient: tenantClientMock,
}));

const txImportacionCsvUpdateMock = vi.fn().mockResolvedValue(undefined);
const tenantTransactionMock = vi.fn(async (_empresaId: string, fn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    importacionCsv: { update: txImportacionCsvUpdateMock },
    // fromPrisma(tx) (real, sin mockear) solo necesita esto -- ver
    // node_modules/pg-boss/dist/adapters/prisma.js.
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: "pgboss-job-1" }]),
  };
  return fn(tx);
});
vi.mock("@/infra/prisma/tenantTransaction", () => ({
  tenantTransaction: tenantTransactionMock,
}));

const logErrorMock = vi.fn();
vi.mock("@/infra/log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

const encolarImportacionCsvMock = vi.fn().mockResolvedValue("pgboss-job-1");
const procesarImportacionesCsvMock = vi.fn().mockResolvedValue({ procesados: 0 });
vi.mock("@/infra/kpis/cobertura/job", () => ({
  COLA_IMPORTACION_CSV: "procesar-importacion-csv",
  encolarImportacionCsv: (...args: unknown[]) => encolarImportacionCsvMock(...args),
  procesarImportacionesCsv: (...args: unknown[]) => procesarImportacionesCsvMock(...args),
}));

const obtenerBossMock = vi.fn().mockResolvedValue({ __boss: true });
vi.mock("@/infra/jobs/pgBoss", () => ({ obtenerBoss: () => obtenerBossMock() }));

const descargarObjetoMock = vi.fn().mockResolvedValue(Buffer.from("cifrado"));
vi.mock("@/infra/storage/r2", () => ({
  ClienteAlmacenamientoR2: vi.fn().mockImplementation(() => ({ descargarObjeto: descargarObjetoMock })),
}));

const descifrarContenidoMock = vi.fn();
vi.mock("@/infra/storage/cifradoObjeto", () => ({
  obtenerClaveMaestraPorId: vi.fn().mockReturnValue(Buffer.alloc(32)),
  desenvolverDek: vi.fn().mockReturnValue(Buffer.alloc(32)),
  descifrarContenido: (...args: unknown[]) => descifrarContenidoMock(...args),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };

const MAPEO = {
  sku: "sku",
  ubicacion: "ubicacion",
  fechaCorte: "fecha",
  inventarioDisponible: "inventario",
  unidadInventario: "unidad_inv",
  consumoDiarioEsperado: "consumo",
  unidadConsumoDiario: "unidad_cons",
};
const ENCABEZADOS = Object.values(MAPEO);
const CSV_CON_UNA_FILA = "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons\nA-001,LIMA,2026-09-24,100,unidad,10,unidad\n";

function importacionBase(overrides: Record<string, unknown> = {}) {
  return {
    id: "import-1",
    empresaId: "empresa-1",
    cadenaId: "cadena-1",
    definicionKpiId: "def-1",
    objetoStorageKey: "empresas/empresa-1/imports/import-1/cifrado.bin",
    cifradoClaveId: "clave-activa",
    cifradoDek: "dek",
    cifradoDekIv: "iv",
    cifradoDekAuthTag: "authTag",
    mapeoColumnas: { encabezados: ENCABEZADOS, propuesto: MAPEO, confirmado: null },
    estado: "PENDIENTE_REVISION",
    estrategia: "CARGA_PARCIAL",
    alcanceFechaCorteInicio: null,
    alcanceFechaCorteFin: null,
    alcanceUbicaciones: null,
    fuenteConsumo: null,
    periodoReferenciaConsumoInicio: null,
    periodoReferenciaConsumoFin: null,
    confirmadaEn: null,
    confirmadaPorId: null,
    ...overrides,
  };
}

function bodyBase(overrides: Record<string, unknown> = {}) {
  return {
    mapeoColumnas: MAPEO,
    estrategia: "CARGA_PARCIAL",
    fuenteConsumo: "ERP mayo 2026",
    periodoReferenciaConsumoInicio: "2026-05-01",
    periodoReferenciaConsumoFin: "2026-05-31",
    ...overrides,
  };
}

function construirRequest(body: unknown): Request {
  return new Request("http://localhost/api/kpis/cobertura/importaciones/import-1/confirmar", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function contexto(id = "import-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
  importacionCsvFindUniqueMock.mockResolvedValue(importacionBase());
  txImportacionCsvUpdateMock.mockResolvedValue(undefined);
  encolarImportacionCsvMock.mockResolvedValue("pgboss-job-1");
  procesarImportacionesCsvMock.mockResolvedValue({ procesados: 0 });
  descargarObjetoMock.mockResolvedValue(Buffer.from("cifrado"));
  descifrarContenidoMock.mockReturnValue(Buffer.from(CSV_CON_UNA_FILA));
});

describe("POST .../confirmar -- autenticacion, permisos y aislamiento", () => {
  it("requireAdmin rechaza (no ADMINISTRADOR) -- devuelve esa respuesta tal cual, nunca toca tenantClient", async () => {
    const respuestaDenegada = new Response(JSON.stringify({ ok: false, error: "NO_AUTORIZADO" }), { status: 403 });
    requireAdminMock.mockResolvedValue({ respuesta: respuestaDenegada });
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase()), contexto());
    expect(res.status).toBe(403);
    expect(tenantClientMock).not.toHaveBeenCalled();
  });

  it("siempre usa tenantClient/tenantTransaction con sesion.empresaId -- nunca un empresaId del body o de los params", async () => {
    const { POST } = await import("../route");
    await POST(construirRequest(bodyBase()), contexto());
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-1");
    expect(tenantTransactionMock).toHaveBeenCalledWith("empresa-1", expect.any(Function));
  });

  it("importacion inexistente para esta empresa (otro tenant, filtrada por tenantClient) -- 404, nunca llega a leer el body", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase()), contexto());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: "IMPORTACION_INEXISTENTE" });
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });
});

describe("POST .../confirmar -- validacion", () => {
  it("body invalido (mapeoColumnas ausente) -- 400 DATOS_INVALIDOS, nunca toca tenantTransaction", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest({ estrategia: "CARGA_PARCIAL" }), contexto());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("DATOS_INVALIDOS");
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });

  it("mapeo que ya no coincide con los encabezados reales -- 400 MAPEO_INVALIDO", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase({ mapeoColumnas: { ...MAPEO, sku: "columna_que_no_existe" } })), contexto());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("MAPEO_INVALIDO");
  });

  it("columnas sospechosas de fuente/periodo sin reconocer -- 400, nunca toca tenantTransaction", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue(
      importacionBase({ mapeoColumnas: { encabezados: [...ENCABEZADOS, "fuente de consumo"], propuesto: MAPEO, confirmado: null } }),
    );
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase()), contexto());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("COLUMNAS_SOSPECHOSAS_SIN_RESOLVER");
    expect(json.columnas).toEqual([{ encabezado: "fuente de consumo", campo: "fuenteConsumo" }]);
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });
});

describe("POST .../confirmar -- soloVistaPrevia nunca persiste ni encola", () => {
  it("CARGA_PARCIAL: candidatasRetiro vacio, retiroHash null, nunca toca tenantTransaction/encolarImportacionCsv", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase({ soloVistaPrevia: true })), contexto());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, vistaPrevia: true, candidatasRetiro: [], retiroHash: null });
    expect(tenantTransactionMock).not.toHaveBeenCalled();
    expect(encolarImportacionCsvMock).not.toHaveBeenCalled();
  });

  it("REEMPLAZO_ALCANCE: calcula candidatasRetiro+retiroHash reales contra la base y el archivo, nunca persiste", async () => {
    observacionCoberturaFindManyMock.mockResolvedValue([
      { id: "obs-fuera", sku: "B-999", ubicacion: "LIMA", fechaCorte: new Date("2026-09-20T12:00:00.000Z") }, // no esta en el CSV -> candidata
      { id: "obs-en-archivo", sku: "A-001", ubicacion: "LIMA", fechaCorte: new Date("2026-09-24T12:00:00.000Z") }, // si esta en el CSV -> no es candidata
    ]);
    const body = bodyBase({
      soloVistaPrevia: true,
      estrategia: "REEMPLAZO_ALCANCE",
      alcanceFechaCorteInicio: "2026-09-01",
      alcanceFechaCorteFin: "2026-09-30",
      alcanceUbicaciones: ["LIMA"],
    });
    const { POST } = await import("../route");
    const res = await POST(construirRequest(body), contexto());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.candidatasRetiro).toHaveLength(1);
    expect(json.candidatasRetiro[0].id).toBe("obs-fuera");
    expect(typeof json.retiroHash).toBe("string");
    expect(json.retiroHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tenantTransactionMock).not.toHaveBeenCalled();
    expect(encolarImportacionCsvMock).not.toHaveBeenCalled();
  });
});

describe("POST .../confirmar -- REEMPLAZO_ALCANCE atado a la vista previa mostrada", () => {
  function bodyReemplazo(overrides: Record<string, unknown> = {}) {
    return bodyBase({
      estrategia: "REEMPLAZO_ALCANCE",
      alcanceFechaCorteInicio: "2026-09-01",
      alcanceFechaCorteFin: "2026-09-30",
      alcanceUbicaciones: ["LIMA"],
      ...overrides,
    });
  }

  beforeEach(() => {
    observacionCoberturaFindManyMock.mockResolvedValue([
      { id: "obs-fuera", sku: "B-999", ubicacion: "LIMA", fechaCorte: new Date("2026-09-20T12:00:00.000Z") },
    ]);
  });

  it("sin retiroHash en el body -- 400 DATOS_INVALIDOS (zod lo exige salvo en vista previa)", async () => {
    const { POST } = await import("../route");
    const body = bodyReemplazo({ confirmarRetiro: true });
    delete (body as Record<string, unknown>).retiroHash;
    const res = await POST(construirRequest(body), contexto());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("DATOS_INVALIDOS");
  });

  it("sin confirmarRetiro=true -- 400 DEBE_CONFIRMAR_RETIRO, con candidatasRetiro+retiroHash recalculados, nunca toca tenantTransaction", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyReemplazo({ retiroHash: "cualquiera-por-ahora" })), contexto());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("DEBE_CONFIRMAR_RETIRO");
    expect(json.candidatasRetiro).toHaveLength(1);
    expect(typeof json.retiroHash).toBe("string");
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });

  it("retiroHash desactualizado (no coincide con lo que se recalcula ahora) -- 409 RETIRO_DESACTUALIZADO, nunca toca tenantTransaction", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyReemplazo({ confirmarRetiro: true, retiroHash: "hash-viejo-de-otra-vista-previa" })), contexto());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("RETIRO_DESACTUALIZADO");
    expect(json.candidatasRetiro).toHaveLength(1);
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });

  it("retiroHash correcto (el mismo que devolveria la vista previa ahora mismo) -- confirma y encola", async () => {
    const { POST: previewPost } = await import("../route");
    const vistaPrevia = await previewPost(construirRequest(bodyReemplazo({ soloVistaPrevia: true })), contexto());
    const { retiroHash } = await vistaPrevia.json();

    const res = await previewPost(construirRequest(bodyReemplazo({ confirmarRetiro: true, retiroHash })), contexto());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, importId: "import-1" });
    expect(tenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(encolarImportacionCsvMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST .../confirmar -- confirmacion real, atomicidad y disparo inmediato", () => {
  it("CARGA_PARCIAL exitosa: persiste+confirma+encola en UNA sola tenantTransaction, dispara procesamiento inmediato, 200", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase()), contexto());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, importId: "import-1" });

    expect(tenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(txImportacionCsvUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "import-1" },
        data: expect.objectContaining({
          estado: "CONFIRMADA",
          confirmadaPorId: "usuario-1",
          confirmadaEn: expect.any(Date),
          fuenteConsumo: "ERP mayo 2026",
        }),
      }),
    );
    // encolarImportacionCsv se llama DENTRO de la transaccion, con un
    // adaptador IDatabase (fromPrisma(tx) real) -- nunca sin `db` (eso
    // encolaria fuera de la transaccion atomica).
    expect(encolarImportacionCsvMock).toHaveBeenCalledWith(
      { __boss: true },
      { importId: "import-1", empresaId: "empresa-1" },
      { db: expect.objectContaining({ executeSql: expect.any(Function) }) },
    );
    expect(procesarImportacionesCsvMock).toHaveBeenCalledWith({ __boss: true }, 1);
  });

  it("si el encolado (dentro de la transaccion) falla -- 502 NO_SE_PUDO_CONFIRMAR, se registra el error, nunca dispara el procesamiento inmediato", async () => {
    encolarImportacionCsvMock.mockRejectedValue(new Error("pgboss no disponible"));
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase()), contexto());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("NO_SE_PUDO_CONFIRMAR");
    expect(logErrorMock).toHaveBeenCalled();
    expect(procesarImportacionesCsvMock).not.toHaveBeenCalled();
  });

  it("estado ERROR -- 409 ESTADO_NO_CONFIRMABLE, no es un flujo de reintento valido por esta ruta", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue(importacionBase({ estado: "ERROR" }));
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase()), contexto());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("ESTADO_NO_CONFIRMABLE");
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });
});

describe("POST .../confirmar -- reintento idempotente sobre una importacion ya CONFIRMADA", () => {
  function importacionConfirmada(overrides: Record<string, unknown> = {}) {
    return importacionBase({
      estado: "CONFIRMADA",
      mapeoColumnas: { encabezados: ENCABEZADOS, propuesto: MAPEO, confirmado: MAPEO },
      fuenteConsumo: "ERP mayo 2026",
      periodoReferenciaConsumoInicio: new Date("2026-05-01T12:00:00.000Z"),
      periodoReferenciaConsumoFin: new Date("2026-05-31T12:00:00.000Z"),
      confirmadaEn: new Date("2026-09-20T10:00:00.000Z"),
      confirmadaPorId: "usuario-1",
      ...overrides,
    });
  }

  it("mismos valores exactos -- 200 yaConfirmada:true, nunca vuelve a persistir ni a encolar", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue(importacionConfirmada());
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase()), contexto());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, importId: "import-1", yaConfirmada: true });
    expect(tenantTransactionMock).not.toHaveBeenCalled();
    expect(encolarImportacionCsvMock).not.toHaveBeenCalled();
  });

  it("valores distintos (otra fuenteConsumo) -- 409 YA_CONFIRMADA_CON_OTROS_VALORES, nunca reescribe lo ya confirmado", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue(importacionConfirmada());
    const { POST } = await import("../route");
    const res = await POST(construirRequest(bodyBase({ fuenteConsumo: "ERP junio 2026" })), contexto());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("YA_CONFIRMADA_CON_OTROS_VALORES");
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });
});
