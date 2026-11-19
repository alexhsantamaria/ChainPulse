import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const confirmarMock = vi.fn();
vi.mock("@/infra/kpis/otifProveedor/persistir", () => ({
  confirmarObservacionOtifProveedor: (...args: unknown[]) => confirmarMock(...args),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };
const PAYLOAD = {
  modo: "manual",
  cadenaId: "cadena-1",
  periodoInicio: "2026-09-01",
  periodoFin: "2026-09-30",
  proveedorAlias: "Proveedor A",
  numerador: 8,
  denominador: 10,
};

function construirRequest(body: unknown, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/kpis/otif-proveedor/observaciones/confirmar", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

describe("POST /otif-proveedor/observaciones/confirmar -- compuertas", () => {
  it("requireAdmin rechaza y nunca confirma", async () => {
    const { NextResponse } = await import("next/server");
    requireAdminMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 }) });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD));
    expect(respuesta.status).toBe(403);
    expect(confirmarMock).not.toHaveBeenCalled();
  });

  it("payload no JSON -> CUERPO_INVALIDO y nunca confirma", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(
      new Request("http://localhost/api/kpis/otif-proveedor/observaciones/confirmar", { method: "POST", body: "no es json" }),
    );
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CUERPO_INVALIDO");
    expect(confirmarMock).not.toHaveBeenCalled();
  });

  it("Content-Length por encima del limite -> 413 y nunca confirma", async () => {
    const { MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES } = await import("@/domain/limitesDeclaracionOtifProveedor");
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD, { "content-length": String(MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES + 1) }));
    expect(respuesta.status).toBe(413);
    expect(confirmarMock).not.toHaveBeenCalled();
    expect((await respuesta.json()).limiteBytes).toBe(MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES);
  });
});

describe("POST /otif-proveedor/observaciones/confirmar -- errores del dominio", () => {
  it.each([
    ["CADENA_INEXISTENTE", 404],
    ["DEFINICION_KPI_NO_DISPONIBLE", 500],
    ["DATOS_INVALIDOS", 400],
  ] as const)("%s -> %s", async (error, status) => {
    confirmarMock.mockResolvedValue({ ok: false, error });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD));
    expect(respuesta.status).toBe(status);
    expect((await respuesta.json()).error).toBe(error);
  });

  it("reenvia el detalle de ALIAS_PROVEEDOR_CONFLICTIVOS", async () => {
    confirmarMock.mockResolvedValue({
      ok: false,
      error: "ALIAS_PROVEEDOR_CONFLICTIVOS",
      conflictos: [{ proveedorAliasClave: "proveedor a", variantes: ["Proveedor A", "PROVEEDOR A"] }],
    });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD));
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({
      ok: false,
      error: "ALIAS_PROVEEDOR_CONFLICTIVOS",
      conflictos: [{ proveedorAliasClave: "proveedor a", variantes: ["Proveedor A", "PROVEEDOR A"] }],
    });
  });
});

describe("POST /otif-proveedor/observaciones/confirmar -- caso valido", () => {
  it("usa empresaId de la sesion y no transmite identificadores internos en la respuesta", async () => {
    confirmarMock.mockResolvedValue({
      ok: true,
      resultados: [
        {
          observacionId: "obs-1",
          proveedorAlias: "Proveedor A",
          proveedorAliasClave: "proveedor a",
          resultado: { valor: 0.8, numerador: 8, denominador: 10, filasEvaluadas: 1, filasExcluidas: 0, cobertura: 1, advertencias: [], ruleVersion: "kpis-v1" },
        },
      ],
    });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ ...PAYLOAD, empresaId: "empresa-atacante", definicionKpiId: "def-atacante" }));
    expect(respuesta.status).toBe(200);
    expect(confirmarMock).toHaveBeenCalledWith(expect.objectContaining({ cadenaId: "cadena-1", modo: "manual" }), { empresaId: "empresa-1" });
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.resultados).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain("empresaId");
    expect(JSON.stringify(json)).not.toContain("definicionKpiId");
  });
});
