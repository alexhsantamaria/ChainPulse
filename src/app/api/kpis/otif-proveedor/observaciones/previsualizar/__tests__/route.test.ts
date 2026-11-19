import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };
const PERIODO = { periodoInicio: "2026-09-01", periodoFin: "2026-09-30" };

function construirRequest(body: unknown, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/kpis/otif-proveedor/observaciones/previsualizar", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

function fila(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proveedorAlias: "Proveedor A",
    pedido: "PED-1",
    fechaPromesa: "2026-09-10",
    fechaRecepcion: "2026-09-10",
    cantidadPedida: 10,
    cantidadRecibida: 10,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

describe("POST /otif-proveedor/observaciones/previsualizar -- autenticacion y forma", () => {
  it("requireAdmin rechaza -- devuelve la respuesta tal cual", async () => {
    const { NextResponse } = await import("next/server");
    requireAdminMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 }) });
    const { POST } = await import("../route");
    const respuesta = await POST(
      construirRequest({ modo: "manual", cadenaId: "c1", ...PERIODO, proveedorAlias: "Proveedor A", numerador: 1, denominador: 2 }),
    );
    expect(respuesta.status).toBe(403);
    expect((await respuesta.json()).error).toBe("NO_AUTORIZADO");
  });

  it("body no JSON -> CUERPO_INVALIDO 400", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(
      new Request("http://localhost/api/kpis/otif-proveedor/observaciones/previsualizar", { method: "POST", body: "no es json" }),
    );
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CUERPO_INVALIDO");
  });

  it("payload con forma incorrecta -> DATOS_INVALIDOS 400", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ modo: "manual", cadenaId: "c1", ...PERIODO, proveedorAlias: 123, numerador: 1, denominador: 2 }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
  });
});

describe("POST /otif-proveedor/observaciones/previsualizar -- limite real de bytes", () => {
  it("Content-Length por encima del limite -> 413 con limiteBytes", async () => {
    const { MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES } = await import("@/domain/limitesDeclaracionOtifProveedor");
    const { POST } = await import("../route");
    const respuesta = await POST(
      construirRequest(
        { modo: "manual", cadenaId: "c1", ...PERIODO, proveedorAlias: "Proveedor A", numerador: 1, denominador: 2 },
        { "content-length": String(MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES + 1) },
      ),
    );
    expect(respuesta.status).toBe(413);
    expect(await respuesta.json()).toEqual({ ok: false, error: "CUERPO_DEMASIADO_GRANDE", limiteBytes: MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES });
  });
});

describe("POST /otif-proveedor/observaciones/previsualizar -- validacion multi-proveedor", () => {
  it("reenvia ALIAS_PROVEEDOR_CONFLICTIVOS con su detalle", async () => {
    const { POST } = await import("../route");
    const filas = [fila({ proveedorAlias: "Proveedor A", pedido: "A-1" }), fila({ proveedorAlias: "PROVEEDOR A", pedido: "A-2" })];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", ...PERIODO, filas }));
    expect(respuesta.status).toBe(400);
    const json = await respuesta.json();
    expect(json.error).toBe("ALIAS_PROVEEDOR_CONFLICTIVOS");
    expect(json.conflictos).toEqual([
      { proveedorAliasClave: "proveedor a", variantes: ["Proveedor A", "PROVEEDOR A"] },
    ]);
  });

  it("mismo pedido duplicado dentro del mismo proveedor -> PEDIDOS_DUPLICADOS", async () => {
    const { POST } = await import("../route");
    const filas = [fila({ pedido: "PED-X" }), fila({ pedido: "PED-X" })];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", ...PERIODO, filas }));
    expect(respuesta.status).toBe(400);
    const json = await respuesta.json();
    expect(json.error).toBe("PEDIDOS_DUPLICADOS");
    expect(json.filas).toEqual([{ proveedorAlias: "Proveedor A", pedido: "PED-X" }]);
  });

  it("mismo pedido en proveedores distintos es valido y produce dos resultados", async () => {
    const { POST } = await import("../route");
    const filas = [fila({ proveedorAlias: "Proveedor A", pedido: "COMPARTIDO" }), fila({ proveedorAlias: "Proveedor B", pedido: "COMPARTIDO" })];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", ...PERIODO, filas }));
    expect(respuesta.status).toBe(200);
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.resultados).toHaveLength(2);
    expect(json.resultados.map((r: { proveedorAlias: string }) => r.proveedorAlias)).toEqual(["Proveedor A", "Proveedor B"]);
    expect(json.filasInterpretadas).toHaveLength(2);
  });

  it("manual valido calcula server-side y no expone identificadores internos", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(
      construirRequest({ modo: "manual", cadenaId: "c1", ...PERIODO, proveedorAlias: "Proveedor A", numerador: 8, denominador: 10 }),
    );
    expect(respuesta.status).toBe(200);
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.resultados[0].resultado.valor).toBeCloseTo(0.8);
    expect(JSON.stringify(json)).not.toContain("empresaId");
    expect(JSON.stringify(json)).not.toContain("definicionKpiId");
  });
});
