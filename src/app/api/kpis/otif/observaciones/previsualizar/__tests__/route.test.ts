// Pruebas -- ruta de previsualizacion de OTIF. Mismo criterio que
// kpis/cobertura/importaciones/__tests__/route.test.ts: llama
// directamente al handler POST exportado, sin servidor; requireAdmin
// mockeado, calculo real (previsualizarObservacionOtif es pura, se deja
// correr de verdad -- no hace falta mockearla).
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };

function construirRequest(body: unknown): Request {
  return new Request("http://localhost/api/kpis/otif/observaciones/previsualizar", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

describe("POST /previsualizar -- autenticacion y permisos", () => {
  it("requireAdmin rechaza (NO_SESION/NO_AUTORIZADO) -- devuelve esa respuesta tal cual, nunca calcula", async () => {
    const { NextResponse } = await import("next/server");
    const respuestaRechazo = NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });
    requireAdminMock.mockResolvedValue({ respuesta: respuestaRechazo });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ modo: "manual", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 2 }));

    expect(respuesta.status).toBe(403);
    const json = await respuesta.json();
    expect(json.error).toBe("NO_AUTORIZADO");
  });
});

describe("POST /previsualizar -- validacion de payload", () => {
  it("payload no-JSON -> 400 CUERPO_INVALIDO (antes DATOS_INVALIDOS -- distinguido desde la correccion del lector con limite real de bytes, Alex 2026-10-10: un body que ni siquiera es JSON parseable es un problema distinto de un JSON valido con campos faltantes)", async () => {
    const { POST } = await import("../route");
    const request = new Request("http://localhost/api/kpis/otif/observaciones/previsualizar", { method: "POST", body: "no es json" });
    const respuesta = await POST(request);
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CUERPO_INVALIDO");
  });

  it("modo desconocido -> DATOS_INVALIDOS 400", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ modo: "csv", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31" }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
  });

  it("manual con denominador<=0 -> DATOS_INVALIDOS 400 (delegado a previsualizarObservacionOtif real)", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(
      construirRequest({ modo: "manual", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 0 }),
    );
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
  });
});

describe("POST /previsualizar -- limite de tamano de body, bytes REALES (Alex 2026-10-10)", () => {
  it("Content-Length declarado por encima del limite -> 413, rechazo temprano sin leer el body", async () => {
    const { MAX_TAMANO_BODY_OTIF_BYTES } = await import("@/domain/limitesDeclaracionOtif");
    const { POST } = await import("../route");
    const request = new Request("http://localhost/api/kpis/otif/observaciones/previsualizar", {
      method: "POST",
      body: JSON.stringify({ modo: "manual", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 2 }),
      headers: { "content-length": String(MAX_TAMANO_BODY_OTIF_BYTES + 1) },
    });
    const respuesta = await POST(request);
    expect(respuesta.status).toBe(413);
    const json = await respuesta.json();
    expect(json.error).toBe("CUERPO_DEMASIADO_GRANDE");
    expect(json.limiteBytes).toBe(MAX_TAMANO_BODY_OTIF_BYTES);
  });

  it("body REAL por encima del limite, SIN Content-Length mentiroso (header ausente, Node no lo setea solo) -> 413, extremo a extremo", async () => {
    const { MAX_TAMANO_BODY_OTIF_BYTES } = await import("@/domain/limitesDeclaracionOtif");
    const { POST } = await import("../route");
    const filasGigantes = Array.from({ length: 2000 }, (_, i) => ({
      pedido: `PED-${i}`,
      fechaPrometida: "2026-10-05",
      fechaReal: "2026-10-05",
      cantidadPedida: 10,
      cantidadEntregada: 10,
      relleno: "x".repeat(2000), // campo extra solo para inflar el body real por encima de 1 MB en la prueba
    }));
    const body = JSON.stringify({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas: filasGigantes });
    expect(Buffer.byteLength(body, "utf-8")).toBeGreaterThan(MAX_TAMANO_BODY_OTIF_BYTES);
    const request = new Request("http://localhost/api/kpis/otif/observaciones/previsualizar", { method: "POST", body });
    expect(request.headers.get("content-length")).toBeNull();
    const respuesta = await POST(request);
    expect(respuesta.status).toBe(413);
    const json = await respuesta.json();
    expect(json.error).toBe("CUERPO_DEMASIADO_GRANDE");
    expect(json.limiteBytes).toBe(MAX_TAMANO_BODY_OTIF_BYTES);
  });
});

describe("POST /previsualizar -- reenvia el detalle estructurado del fallo de validacion (Alex 2026-10-10)", () => {
  it("pegado con pedidos duplicados -> 400 con el campo `pedidos` (no solo `error`), para que la UI identifique las filas", async () => {
    const { POST } = await import("../route");
    const filas = [
      { pedido: "PED-1", fechaPrometida: "2026-10-05", fechaReal: "2026-10-05", cantidadPedida: 10, cantidadEntregada: 10 },
      { pedido: "PED-1", fechaPrometida: "2026-10-06", fechaReal: "2026-10-06", cantidadPedida: 10, cantidadEntregada: 10 },
    ];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas }));
    expect(respuesta.status).toBe(400);
    const json = await respuesta.json();
    expect(json.error).toBe("PEDIDOS_DUPLICADOS");
    expect(json.pedidos).toEqual(["PED-1"]);
  });

  it("pegado con una fila fuera del periodo -> 400 con el campo `pedidos`", async () => {
    const { POST } = await import("../route");
    const filas = [{ pedido: "FUERA", fechaPrometida: "2026-11-15", fechaReal: "2026-11-15", cantidadPedida: 10, cantidadEntregada: 10 }];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas }));
    expect(respuesta.status).toBe(400);
    const json = await respuesta.json();
    expect(json.error).toBe("FILAS_FUERA_DE_PERIODO");
    expect(json.pedidos).toEqual(["FUERA"]);
  });
});

describe("POST /previsualizar -- caso valido", () => {
  it("manual valido -> 200, resultado calculado, nunca persiste (no hay mock de Prisma en este archivo)", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(
      construirRequest({ modo: "manual", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 90, denominador: 100 }),
    );
    expect(respuesta.status).toBe(200);
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.resultado.valor).toBeCloseTo(0.9);
    expect(json.resultado.ruleVersion).toBe("kpis-v1");
  });

  it("pegado valido -> 200, incluye filasInterpretadas", async () => {
    const { POST } = await import("../route");
    const filas = [{ pedido: "P1", fechaPrometida: "2026-10-05", fechaReal: "2026-10-05", cantidadPedida: 10, cantidadEntregada: 10 }];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas }));
    expect(respuesta.status).toBe(200);
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.filasInterpretadas).toHaveLength(1);
  });
});
