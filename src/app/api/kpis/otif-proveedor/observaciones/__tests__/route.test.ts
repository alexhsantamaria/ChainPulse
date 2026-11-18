import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireSession: (...args: unknown[]) => requireSessionMock(...args) }));

const findManyMock = vi.fn();
const countMock = vi.fn();
const tenantClientMock = vi.fn((empresaId: string) => {
  // El valor de empresaId no se lee aca -- el aislamiento de tenant real
  // lo prueba la asercion `toHaveBeenCalledWith("empresa-1")` sobre este
  // mismo mock, no el cuerpo de la factory. El parametro se mantiene
  // (en vez de vi.fn(() => ...)) para que la firma de la funcion siga
  // aceptando un argumento -- vi.fn() sin tipos explicitos infiere la
  // aridad desde la implementacion.
  void empresaId;
  return {
    observacionOtifProveedor: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  };
});
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: (empresaId: string) => tenantClientMock(empresaId) }));

const SESION = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "RESPONSABLE", email: "a@b.com" };

function request(query: string): Request {
  return new Request(`http://localhost/api/kpis/otif-proveedor/observaciones${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue({ sesion: SESION });
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
});

describe("GET /otif-proveedor/observaciones -- sesion y tenant", () => {
  it("cualquier rol con sesion valida puede listar y usa empresaId de la sesion", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(request("?cadenaId=cadena-1"));
    expect(respuesta.status).toBe(200);
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-1");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cadenaId: "cadena-1", definicionKpi: { codigo: "OTIF_PROVEEDOR" } } }),
    );
  });

  it("requireSession rechaza y nunca consulta", async () => {
    const { NextResponse } = await import("next/server");
    requireSessionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 }) });
    const { GET } = await import("../route");
    const respuesta = await GET(request("?cadenaId=cadena-1"));
    expect(respuesta.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("sin cadenaId -> DATOS_INVALIDOS y nunca consulta", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(request(""));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("GET /otif-proveedor/observaciones -- paginacion y orden", () => {
  it("usa limit=50/page=1 por defecto y devuelve el total", async () => {
    countMock.mockResolvedValue(73);
    const { GET } = await import("../route");
    const respuesta = await GET(request("?cadenaId=cadena-1"));
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50 }));
    expect((await respuesta.json()).paginacion).toEqual({ page: 1, limit: 50, total: 73 });
  });

  it("limit=10/page=3 -> skip=20/take=10 y orden determinista", async () => {
    const { GET } = await import("../route");
    await GET(request("?cadenaId=cadena-1&limit=10&page=3"));
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 10,
        orderBy: [{ periodoInicio: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it.each(["?cadenaId=cadena-1&limit=201", "?cadenaId=cadena-1&limit=abc", "?cadenaId=cadena-1&page=0"])(
    "parametro invalido %s -> 400 sin consultar",
    async (query) => {
      const { GET } = await import("../route");
      const respuesta = await GET(request(query));
      expect(respuesta.status).toBe(400);
      expect(findManyMock).not.toHaveBeenCalled();
      expect(countMock).not.toHaveBeenCalled();
    },
  );

  it("count usa exactamente el mismo where que findMany", async () => {
    const { GET } = await import("../route");
    await GET(request("?cadenaId=cadena-1"));
    const whereFind = (findManyMock.mock.calls[0]?.[0] as { where: unknown }).where;
    expect(countMock).toHaveBeenCalledWith({ where: whereFind });
  });
});

describe("GET /otif-proveedor/observaciones -- select y respuesta", () => {
  it("select permite alias y datos del KPI, pero nunca empresaId ni definicionKpiId", async () => {
    const { GET } = await import("../route");
    await GET(request("?cadenaId=cadena-1"));
    const select = (findManyMock.mock.calls[0]?.[0] as { select: Record<string, unknown> }).select;
    expect(select.proveedorAlias).toBe(true);
    expect(select.proveedorAliasClave).toBe(true);
    expect(select.valor).toBe(true);
    expect(select.empresaId).toBeUndefined();
    expect(select.definicionKpiId).toBeUndefined();
  });

  it("devuelve observaciones sin agregar identificadores internos", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "obs-1",
        cadenaId: "cadena-1",
        proveedorAlias: "Proveedor A",
        proveedorAliasClave: "proveedor a",
        periodoInicio: new Date("2026-09-01T00:00:00.000Z"),
        periodoFin: new Date("2026-09-30T00:00:00.000Z"),
        valor: 0.8,
        numerador: 8,
        denominador: 10,
        fuente: "manual",
        estado: "DECLARADO",
        ruleVersion: "kpis-v1",
        createdAt: new Date("2026-11-18T00:00:00.000Z"),
        updatedAt: new Date("2026-11-18T00:00:00.000Z"),
      },
    ]);
    countMock.mockResolvedValue(1);
    const { GET } = await import("../route");
    const json = await (await GET(request("?cadenaId=cadena-1"))).json();
    expect(json.observaciones).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain("empresaId");
    expect(JSON.stringify(json)).not.toContain("definicionKpiId");
  });
});
