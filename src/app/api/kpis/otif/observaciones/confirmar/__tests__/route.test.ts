// Pruebas -- ruta de confirmacion de OTIF. requireAdmin y
// confirmarObservacionOtif (persistir.ts, toca Prisma) mockeados -- misma
// razon que cobertura/importaciones/__tests__/route.test.ts mockea
// tenantClient/prisma: esta prueba es de la RUTA (parseo de payload,
// codigos de status por tipo de error), no de la persistencia real (eso
// lo cubre declararObservacionOtif.integration.test.ts contra Postgres
// real).
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const confirmarObservacionOtifMock = vi.fn();
vi.mock("@/infra/kpis/otif/persistir", () => ({
  confirmarObservacionOtif: (...args: unknown[]) => confirmarObservacionOtifMock(...args),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };
const PAYLOAD_MANUAL = { modo: "manual", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 90, denominador: 100 };

function construirRequest(body: unknown): Request {
  return new Request("http://localhost/api/kpis/otif/observaciones/confirmar", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

describe("POST /confirmar -- autenticacion y permisos", () => {
  it("rol RESPONSABLE (requireAdmin ya devuelve 403) -- nunca llega a confirmarObservacionOtif", async () => {
    const { NextResponse } = await import("next/server");
    requireAdminMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 }) });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_MANUAL));

    expect(respuesta.status).toBe(403);
    expect(confirmarObservacionOtifMock).not.toHaveBeenCalled();
  });
});

describe("POST /confirmar -- validacion de payload (antes de llamar a confirmarObservacionOtif)", () => {
  it("payload no-JSON -> 400 CUERPO_INVALIDO (desde leerCuerpoJsonLimitado, Alex 2026-10-10), nunca llama a confirmarObservacionOtif", async () => {
    const { POST } = await import("../route");
    const request = new Request("http://localhost/api/kpis/otif/observaciones/confirmar", { method: "POST", body: "no es json" });
    const respuesta = await POST(request);
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CUERPO_INVALIDO");
    expect(confirmarObservacionOtifMock).not.toHaveBeenCalled();
  });
});

describe("POST /confirmar -- mapeo de errores a status HTTP", () => {
  it("CADENA_INEXISTENTE -> 404", async () => {
    confirmarObservacionOtifMock.mockResolvedValue({ ok: false, error: "CADENA_INEXISTENTE" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_MANUAL));
    expect(respuesta.status).toBe(404);
  });

  it("DEFINICION_KPI_NO_DISPONIBLE -> 500", async () => {
    confirmarObservacionOtifMock.mockResolvedValue({ ok: false, error: "DEFINICION_KPI_NO_DISPONIBLE" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_MANUAL));
    expect(respuesta.status).toBe(500);
  });

  it("DATOS_INVALIDOS (devuelto por confirmarObservacionOtif, ej. recalculo descubre algo invalido) -> 400", async () => {
    confirmarObservacionOtifMock.mockResolvedValue({ ok: false, error: "DATOS_INVALIDOS" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_MANUAL));
    expect(respuesta.status).toBe(400);
  });
});

describe("POST /confirmar -- Content-Length (limite de tamano de body, Alex 2026-10-10)", () => {
  it("Content-Length por encima de MAX_TAMANO_BODY_OTIF_BYTES -> 413, nunca llama a confirmarObservacionOtif", async () => {
    const { MAX_TAMANO_BODY_OTIF_BYTES } = await import("@/domain/limitesDeclaracionOtif");
    const { POST } = await import("../route");
    const request = new Request("http://localhost/api/kpis/otif/observaciones/confirmar", {
      method: "POST",
      body: JSON.stringify(PAYLOAD_MANUAL),
      headers: { "content-length": String(MAX_TAMANO_BODY_OTIF_BYTES + 1) },
    });
    const respuesta = await POST(request);
    expect(respuesta.status).toBe(413);
    expect(confirmarObservacionOtifMock).not.toHaveBeenCalled();
    const json = await respuesta.json();
    expect(json.error).toBe("CUERPO_DEMASIADO_GRANDE");
    expect(json.limiteBytes).toBe(MAX_TAMANO_BODY_OTIF_BYTES);
  });

  it("sin header Content-Length no bloquea la peticion (el limite de filas sigue aplicando como respaldo)", async () => {
    confirmarObservacionOtifMock.mockResolvedValue({ ok: true, resultado: {}, observacionId: "obs-1" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_MANUAL));
    expect(respuesta.status).toBe(200);
  });
});

describe("POST /confirmar -- reenvia el detalle estructurado del fallo de validacion (Alex 2026-10-10)", () => {
  it("PEDIDOS_DUPLICADOS devuelto por confirmarObservacionOtif -> la ruta reenvia el campo `pedidos`, no solo `error`", async () => {
    confirmarObservacionOtifMock.mockResolvedValue({ ok: false, error: "PEDIDOS_DUPLICADOS", pedidos: ["PED-1"] });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_MANUAL));
    expect(respuesta.status).toBe(400);
    const json = await respuesta.json();
    expect(json.error).toBe("PEDIDOS_DUPLICADOS");
    expect(json.pedidos).toEqual(["PED-1"]);
  });
});

describe("POST /confirmar -- caso valido", () => {
  it("200, pasa el empresaId de LA SESION (nunca uno enviado por el cliente) a confirmarObservacionOtif", async () => {
    confirmarObservacionOtifMock.mockResolvedValue({
      ok: true,
      resultado: { valor: 0.9, numerador: 90, denominador: 100, filasEvaluadas: 1, filasExcluidas: 0, cobertura: 1, advertencias: [], ruleVersion: "kpis-v1" },
      observacionId: "obs-1",
    });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_MANUAL));

    expect(respuesta.status).toBe(200);
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.observacionId).toBe("obs-1");

    expect(confirmarObservacionOtifMock).toHaveBeenCalledWith(expect.objectContaining({ modo: "manual", cadenaId: "c1" }), { empresaId: "empresa-1" });
  });
});
