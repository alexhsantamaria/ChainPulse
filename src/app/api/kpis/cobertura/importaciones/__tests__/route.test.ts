// Pruebas -- ruta de subida de un CSV de Cobertura (Incremento 4 Bloque
// B). Mismo criterio que la ruta de confirmar (ver su
// __tests__/route.test.ts): llama directamente al handler POST
// exportado, sin servidor ni bibliotecas nuevas; Prisma/R2/cifrado
// mockeados, dominio puro (validarLimitesArchivoCsv, proponerMapeoColumnas,
// detectarColumnasSospechosasDeConsumo) real.
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const cadenaFindUniqueMock = vi.fn();
const importacionCsvCreateMock = vi.fn();
const tenantClientMock = vi.fn(() => ({
  cadena: { findUnique: cadenaFindUniqueMock },
  importacionCsv: { create: (...args: unknown[]) => importacionCsvCreateMock(...args) },
}));
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: tenantClientMock }));

const definicionKpiFindFirstMock = vi.fn();
vi.mock("@/infra/prisma/client", () => ({
  prisma: { definicionKpi: { findFirst: (...args: unknown[]) => definicionKpiFindFirstMock(...args) } },
}));

const logErrorMock = vi.fn();
vi.mock("@/infra/log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

vi.mock("@/infra/storage/almacenamiento", () => ({
  construirClaveObjetoCifrado: (empresaId: string, importId: string) => `empresas/${empresaId}/imports/${importId}/cifrado.bin`,
}));

const subirObjetoMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/infra/storage/r2", () => ({
  ClienteAlmacenamientoR2: vi.fn().mockImplementation(() => ({ subirObjeto: subirObjetoMock })),
}));

vi.mock("@/infra/storage/cifradoObjeto", () => ({
  VERSION_FORMATO_ACTUAL: 1,
  generarDek: vi.fn().mockReturnValue(Buffer.alloc(32)),
  obtenerClaveMaestraActiva: vi.fn().mockReturnValue({ id: "clave-activa", clave: Buffer.alloc(32) }),
  cifrarContenido: vi.fn().mockReturnValue(Buffer.from("cifrado")),
  envolverDek: vi.fn().mockReturnValue({ dekCifrada: "dek", iv: "iv", authTag: "authTag" }),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };
const CSV_VALIDO = "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons\nA-001,LIMA,2026-09-24,100,unidad,10,unidad\n";

function construirFormData(overrides: { cadenaId?: string | null; archivo?: File | null; contenido?: string } = {}): FormData {
  const form = new FormData();
  if (overrides.cadenaId !== null) form.set("cadenaId", overrides.cadenaId ?? "cadena-1");
  const archivo = overrides.archivo !== undefined ? overrides.archivo : new File([overrides.contenido ?? CSV_VALIDO], "cobertura.csv", { type: "text/csv" });
  if (archivo !== null) form.set("archivo", archivo);
  return form;
}

function construirRequest(form: FormData): Request {
  return new Request("http://localhost/api/kpis/cobertura/importaciones", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
  cadenaFindUniqueMock.mockResolvedValue({ id: "cadena-1", empresaId: "empresa-1" });
  definicionKpiFindFirstMock.mockResolvedValue({ id: "def-1", codigo: "COBERTURA", estado: "PUBLICADA" });
  importacionCsvCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: data.id }));
  subirObjetoMock.mockResolvedValue(undefined);
});

describe("POST /importaciones -- autenticacion, permisos y aislamiento", () => {
  it("requireAdmin rechaza -- devuelve esa respuesta, nunca toca tenantClient", async () => {
    requireAdminMock.mockResolvedValue({ respuesta: new Response(JSON.stringify({ ok: false, error: "NO_AUTORIZADO" }), { status: 403 }) });
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData()));
    expect(res.status).toBe(403);
    expect(tenantClientMock).not.toHaveBeenCalled();
  });

  it("siempre usa tenantClient con sesion.empresaId -- nunca un empresaId del form", async () => {
    const { POST } = await import("../route");
    await POST(construirRequest(construirFormData()));
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-1");
  });

  it("cadena de otro tenant (o inexistente), filtrada por tenantClient -- 404 CADENA_INEXISTENTE, nunca sube a R2", async () => {
    cadenaFindUniqueMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData()));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("CADENA_INEXISTENTE");
    expect(subirObjetoMock).not.toHaveBeenCalled();
  });
});

describe("POST /importaciones -- validacion", () => {
  it("sin cadenaId -- 400 DATOS_INVALIDOS", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData({ cadenaId: null })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("DATOS_INVALIDOS");
  });

  it("sin archivo -- 400 DATOS_INVALIDOS", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData({ archivo: null })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("DATOS_INVALIDOS");
  });

  it("DefinicionKpi COBERTURA no publicada -- 500 DEFINICION_KPI_NO_DISPONIBLE, se registra el error", async () => {
    definicionKpiFindFirstMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("DEFINICION_KPI_NO_DISPONIBLE");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("archivo sin encabezados/vacio -- 400 ARCHIVO_VACIO_O_SIN_ENCABEZADOS, nunca sube a R2", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData({ contenido: "" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ARCHIVO_VACIO_O_SIN_ENCABEZADOS");
    expect(subirObjetoMock).not.toHaveBeenCalled();
  });

  it("excede MAX_FILAS -- 400 DEMASIADAS_FILAS, nunca sube a R2", async () => {
    const encabezado = "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons";
    const filas = Array.from({ length: 10_001 }, (_, i) => `A-${i},LIMA,2026-09-24,100,unidad,10,unidad`);
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData({ contenido: [encabezado, ...filas].join("\n") })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("DEMASIADAS_FILAS");
    expect(subirObjetoMock).not.toHaveBeenCalled();
  });

  it("la subida a R2 falla -- 502 ERROR_ALMACENAMIENTO, nunca crea la fila ImportacionCsv", async () => {
    subirObjetoMock.mockRejectedValue(new Error("R2 caido"));
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("ERROR_ALMACENAMIENTO");
    expect(importacionCsvCreateMock).not.toHaveBeenCalled();
  });
});

describe("POST /importaciones -- subida exitosa", () => {
  it("cifra, sube a R2 y crea ImportacionCsv con empresaId de la sesion, mapeoColumnas.confirmado=null, y devuelve la previsualizacion", async () => {
    const { POST } = await import("../route");
    const res = await POST(construirRequest(construirFormData()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.filasDetectadas).toBe(1);
    expect(json.mapeoPropuesto).toMatchObject({ sku: "sku", ubicacion: "ubicacion" });
    expect(json.columnasSospechosasDeConsumo).toEqual([]);

    expect(subirObjetoMock).toHaveBeenCalledTimes(1);
    expect(importacionCsvCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          empresaId: "empresa-1",
          cadenaId: "cadena-1",
          estado: "PENDIENTE_REVISION",
          mapeoColumnas: expect.objectContaining({ confirmado: null }),
        }),
      }),
    );
  });
});
