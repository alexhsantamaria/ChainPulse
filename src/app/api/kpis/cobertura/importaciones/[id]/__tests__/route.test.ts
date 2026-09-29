// Pruebas -- GET .../importaciones/[id] (consulta de estado real, ver
// route.ts). Mismo patron que .../confirmar/__tests__/route.test.ts:
// llama DIRECTAMENTE al handler exportado.
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const importacionCsvFindUniqueMock = vi.fn();
const tenantClientMock = vi.fn(() => ({
  importacionCsv: { findUnique: importacionCsvFindUniqueMock },
}));
vi.mock("@/infra/prisma/tenantClient", () => ({
  tenantClient: tenantClientMock,
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

describe("GET .../importaciones/[id]", () => {
  it("requireAdmin rechaza -- devuelve esa respuesta tal cual, nunca toca tenantClient", async () => {
    const respuestaRechazo = new Response(JSON.stringify({ ok: false, error: "NO_AUTORIZADO" }), { status: 403 });
    requireAdminMock.mockResolvedValue({ respuesta: respuestaRechazo });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("http://localhost/api/kpis/cobertura/importaciones/import-1"), contexto("import-1"));
    expect(respuesta).toBe(respuestaRechazo);
    expect(tenantClientMock).not.toHaveBeenCalled();
  });

  it("importacion inexistente (o de otra empresa -- tenantClient ya filtro por RLS) -- 404, nunca 403", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue(null);
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("http://localhost/api/kpis/cobertura/importaciones/no-existe"), contexto("no-existe"));
    expect(respuesta.status).toBe(404);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ ok: false, error: "IMPORTACION_INEXISTENTE" });
  });

  it("CONFIRMADA con procesadaEn -- ok:true, estado y procesadaEn (ISO) reales, sin errores", async () => {
    const procesadaEn = new Date("2026-09-29T13:00:00.000Z");
    importacionCsvFindUniqueMock.mockResolvedValue({
      id: "import-1",
      estado: "CONFIRMADA",
      procesadaEn,
      filasDetectadas: 3,
      filasConError: 0,
      erroresMuestra: null,
    });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("http://localhost/api/kpis/cobertura/importaciones/import-1"), contexto("import-1"));
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({
      ok: true,
      importId: "import-1",
      estado: "CONFIRMADA",
      procesadaEn: "2026-09-29T13:00:00.000Z",
      filasDetectadas: 3,
      filasConError: 0,
      erroresMuestra: null,
    });
  });

  it("ERROR (procesadaEn nunca se setea, ver comentario en prisma/schema.prisma) -- ok:true, estado ERROR, erroresMuestra con el motivo real", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue({
      id: "import-1",
      estado: "ERROR",
      procesadaEn: null,
      filasDetectadas: 7,
      filasConError: 0,
      erroresMuestra: [{ error: "El archivo trae columna(s) que parecen fuente/periodo de consumo sin resolver: fuente consumo." }],
    });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("http://localhost/api/kpis/cobertura/importaciones/import-1"), contexto("import-1"));
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.estado).toBe("ERROR");
    expect(cuerpo.procesadaEn).toBeNull();
    expect(cuerpo.erroresMuestra).toEqual([
      { error: "El archivo trae columna(s) que parecen fuente/periodo de consumo sin resolver: fuente consumo." },
    ]);
  });

  it("consulta scoped por empresa -- tenantClient() se llama con la empresaId de la sesion, nunca del path/body", async () => {
    importacionCsvFindUniqueMock.mockResolvedValue({
      id: "import-1",
      estado: "PENDIENTE_REVISION",
      procesadaEn: null,
      filasDetectadas: 0,
      filasConError: 0,
      erroresMuestra: null,
    });
    const { GET } = await import("../route");
    await GET(new Request("http://localhost/api/kpis/cobertura/importaciones/import-1"), contexto("import-1"));
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-1");
    expect(importacionCsvFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "import-1" } }),
    );
  });
});
