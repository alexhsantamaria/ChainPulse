// Pruebas -- ruta de listado de observaciones OTIF (RF-K6). requireSession
// y tenantClient mockeados -- mismo criterio que el resto de
// api/kpis/*/route.test.ts. Paginacion/limite/select agregados 2026-10-10
// (Alex: "el GET no puede devolver todas las observaciones sin limite").
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireSession: (...args: unknown[]) => requireSessionMock(...args) }));

const findManyMock = vi.fn();
const countMock = vi.fn();
const tenantClientMock = vi.fn(() => ({
  observacionKpi: {
    findMany: (...args: unknown[]) => findManyMock(...args),
    count: (...args: unknown[]) => countMock(...args),
  },
}));
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: tenantClientMock }));

const SESION_RESPONSABLE = { usuarioId: "u1", empresaId: "empresa-1", rol: "RESPONSABLE", email: "a@b.com" };

function construirRequest(query: string): Request {
  return new Request(`http://localhost/api/kpis/otif/observaciones${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue({ sesion: SESION_RESPONSABLE });
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
});

describe("GET /observaciones -- RF-K6", () => {
  it("cualquier rol con sesion valida puede listar (no exige ADMINISTRADOR, a diferencia de previsualizar/confirmar)", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1"));
    expect(respuesta.status).toBe(200);
  });

  it("sin cadenaId -> DATOS_INVALIDOS 400, nunca consulta Prisma", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest(""));
    expect(respuesta.status).toBe(400);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("usa tenantClient(empresaId DE LA SESION) -- aislamiento de tenant (RNF1 capa 1)", async () => {
    const { GET } = await import("../route");
    await GET(construirRequest("?cadenaId=c1"));
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-1");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cadenaId: "c1", definicionKpi: { codigo: "OTIF" } }) }),
    );
  });

  it("requireSession rechaza -> devuelve esa respuesta, nunca consulta Prisma", async () => {
    const { NextResponse } = await import("next/server");
    requireSessionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 }) });
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1"));
    expect(respuesta.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("GET /observaciones -- paginacion y limite (Alex 2026-10-10)", () => {
  it("sin ?limit/?page usa los valores por defecto (limit=50, page=1 -> skip=0, take=50) y devuelve `paginacion`", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1"));
    expect(respuesta.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50 }));
    const json = await respuesta.json();
    expect(json.paginacion).toEqual({ page: 1, limit: 50, total: 0 });
  });

  it("?limit=10&page=3 -> skip=20, take=10", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1&limit=10&page=3"));
    expect(respuesta.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    const json = await respuesta.json();
    expect(json.paginacion).toEqual({ page: 3, limit: 10, total: 0 });
  });

  it("?limit por encima del maximo (200) -> DATOS_INVALIDOS 400, nunca consulta Prisma (nunca se clampea en silencio)", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1&limit=201"));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("?limit no numerico -> DATOS_INVALIDOS 400", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1&limit=abc"));
    expect(respuesta.status).toBe(400);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("?page=0 -> DATOS_INVALIDOS 400 (pagina minima es 1)", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1&page=0"));
    expect(respuesta.status).toBe(400);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("usa count() con el MISMO where que findMany() para el total", async () => {
    countMock.mockResolvedValue(137);
    const { GET } = await import("../route");
    const respuesta = await GET(construirRequest("?cadenaId=c1"));
    const json = await respuesta.json();
    expect(json.paginacion.total).toBe(137);
    expect(countMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ cadenaId: "c1", definicionKpi: { codigo: "OTIF" } }) }));
  });
});

describe("GET /observaciones -- orden deterministico (desempates, Alex 2026-10-10)", () => {
  it("ordena por periodoInicio desc, createdAt desc, id desc -- nunca solo por periodoInicio, para no repetir/saltear filas entre paginas cuando varias observaciones comparten periodo", async () => {
    const { GET } = await import("../route");
    await GET(construirRequest("?cadenaId=c1"));
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ periodoInicio: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });
});

describe("GET /observaciones -- select explicito (Alex 2026-10-10: nunca el objeto completo)", () => {
  it("findMany() se llama con un `select` que incluye solo los campos permitidos (sin empresaId/definicionKpiId)", async () => {
    const { GET } = await import("../route");
    await GET(construirRequest("?cadenaId=c1"));
    const llamada = findManyMock.mock.calls[0]?.[0] as { select?: Record<string, unknown> } | undefined;
    const select = llamada?.select;
    if (!select) throw new Error("findMany no fue llamado con un `select`");
    expect(select).toEqual({
      id: true,
      cadenaId: true,
      periodoInicio: true,
      periodoFin: true,
      valor: true,
      numerador: true,
      denominador: true,
      fuente: true,
      estado: true,
      ruleVersion: true,
      createdAt: true,
    });
    expect(select.empresaId).toBeUndefined();
    expect(select.definicionKpiId).toBeUndefined();
  });
});
