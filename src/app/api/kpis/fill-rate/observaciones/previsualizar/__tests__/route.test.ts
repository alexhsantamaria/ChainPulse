// Pruebas -- ruta de previsualizacion de Fill Rate. Mismo criterio que
// kpis/otif/observaciones/previsualizar/__tests__/route.test.ts: llama
// directamente al handler POST exportado, sin servidor; requireAdmin
// mockeado, calculo real (previsualizarObservacionFillRate es pura, se
// deja correr de verdad -- no hace falta mockearla).
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };

function construirRequest(body: unknown): Request {
  return new Request("http://localhost/api/kpis/fill-rate/observaciones/previsualizar", {
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
  it("payload no-JSON -> 400 CUERPO_INVALIDO", async () => {
    const { POST } = await import("../route");
    const request = new Request("http://localhost/api/kpis/fill-rate/observaciones/previsualizar", { method: "POST", body: "no es json" });
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

  it("manual con denominador<=0 -> DATOS_INVALIDOS 400 (delegado a previsualizarObservacionFillRate real)", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(
      construirRequest({ modo: "manual", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 0 }),
    );
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
  });
});

describe("POST /previsualizar -- limite de tamano de body, bytes REALES", () => {
  it("Content-Length declarado por encima del limite -> 413, rechazo temprano sin leer el body", async () => {
    const { MAX_TAMANO_BODY_FILL_RATE_BYTES } = await import("@/domain/limitesDeclaracionFillRate");
    const { POST } = await import("../route");
    const request = new Request("http://localhost/api/kpis/fill-rate/observaciones/previsualizar", {
      method: "POST",
      body: JSON.stringify({ modo: "manual", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 2 }),
      headers: { "content-length": String(MAX_TAMANO_BODY_FILL_RATE_BYTES + 1) },
    });
    const respuesta = await POST(request);
    expect(respuesta.status).toBe(413);
    const json = await respuesta.json();
    expect(json.error).toBe("CUERPO_DEMASIADO_GRANDE");
    expect(json.limiteBytes).toBe(MAX_TAMANO_BODY_FILL_RATE_BYTES);
  });

  it("body REAL por encima del limite, SIN Content-Length mentiroso -> 413, extremo a extremo", async () => {
    const { MAX_TAMANO_BODY_FILL_RATE_BYTES } = await import("@/domain/limitesDeclaracionFillRate");
    const { POST } = await import("../route");
    const filasGigantes = Array.from({ length: 2000 }, (_, i) => ({
      sku: `SKU-${i}`,
      pedido: `PED-${i}`,
      solicitado: 10,
      servido: 10,
      relleno: "x".repeat(2000), // campo extra solo para inflar el body real por encima de 1 MB en la prueba
    }));
    const body = JSON.stringify({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas: filasGigantes });
    expect(Buffer.byteLength(body, "utf-8")).toBeGreaterThan(MAX_TAMANO_BODY_FILL_RATE_BYTES);
    const request = new Request("http://localhost/api/kpis/fill-rate/observaciones/previsualizar", { method: "POST", body });
    expect(request.headers.get("content-length")).toBeNull();
    const respuesta = await POST(request);
    expect(respuesta.status).toBe(413);
    const json = await respuesta.json();
    expect(json.error).toBe("CUERPO_DEMASIADO_GRANDE");
    expect(json.limiteBytes).toBe(MAX_TAMANO_BODY_FILL_RATE_BYTES);
  });
});

describe("POST /previsualizar -- reenvia el detalle estructurado del fallo de validacion", () => {
  it("pegado con el MISMO pedido Y el MISMO sku repetidos -> 400 con el campo `pedidos` (no solo `error`), para que la UI identifique las filas", async () => {
    // Corregido 2026-10-14: la identidad de duplicado es compuesta
    // (pedido+sku, ver declarar.ts) -- esta prueba usa el MISMO sku en
    // ambas filas para seguir probando un duplicado real. El caso
    // "mismo pedido, sku distinto" (que NO es duplicado) tiene su propia
    // prueba mas abajo.
    const { POST } = await import("../route");
    const filas = [
      { sku: "SKU-1", pedido: "PED-1", solicitado: 10, servido: 10 },
      { sku: "SKU-1", pedido: "PED-1", solicitado: 5, servido: 5 },
    ];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas }));
    expect(respuesta.status).toBe(400);
    const json = await respuesta.json();
    expect(json.error).toBe("PEDIDOS_DUPLICADOS");
    expect(json.pedidos).toEqual(["PED-1"]);
  });

  it("pegado con el MISMO pedido y SKU DISTINTO -> 200, ambas filas aceptadas (un pedido puede tener varias lineas de SKU, no es un duplicado)", async () => {
    const { POST } = await import("../route");
    const filas = [
      { sku: "SKU-1", pedido: "PED-1", solicitado: 10, servido: 10 },
      { sku: "SKU-2", pedido: "PED-1", solicitado: 5, servido: 5 },
    ];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas }));
    expect(respuesta.status).toBe(200);
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.resultado.filasEvaluadas).toBe(2);
  });

  it("pegado con demasiadas filas -> 400 con los campos `limite`/`recibidas`", async () => {
    const { MAX_FILAS_PEGADO_FILL_RATE } = await import("@/domain/limitesDeclaracionFillRate");
    const { POST } = await import("../route");
    const filas = Array.from({ length: MAX_FILAS_PEGADO_FILL_RATE + 1 }, (_, i) => ({ sku: "SKU-1", pedido: `PED-${i}`, solicitado: 10, servido: 10 }));
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas }));
    expect(respuesta.status).toBe(400);
    const json = await respuesta.json();
    expect(json.error).toBe("DEMASIADAS_FILAS");
    expect(json.limite).toBe(MAX_FILAS_PEGADO_FILL_RATE);
    expect(json.recibidas).toBe(MAX_FILAS_PEGADO_FILL_RATE + 1);
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
    const filas = [{ sku: "SKU-1", pedido: "P1", solicitado: 10, servido: 10 }];
    const respuesta = await POST(construirRequest({ modo: "pegado", cadenaId: "c1", periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas }));
    expect(respuesta.status).toBe(200);
    const json = await respuesta.json();
    expect(json.ok).toBe(true);
    expect(json.filasInterpretadas).toHaveLength(1);
  });
});
