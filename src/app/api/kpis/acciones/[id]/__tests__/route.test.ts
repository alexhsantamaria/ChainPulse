// Pruebas -- PATCH .../api/kpis/acciones/[id] (actualizar estado,
// responsable, fecha objetivo y/o descripcion).
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const tenantClientMock = vi.fn(() => ({}));
vi.mock("@/infra/prisma/tenantClient", () => ({
  tenantClient: tenantClientMock,
}));

const actualizarAccionDecisionKpiMock = vi.fn();
vi.mock("@/infra/kpis/acciones/servicio", () => ({
  actualizarAccionDecisionKpi: (...args: unknown[]) => actualizarAccionDecisionKpiMock(...args),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/kpis/acciones/accion-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

describe("PATCH .../api/kpis/acciones/[id]", () => {
  it("requireAdmin rechaza -- devuelve esa respuesta tal cual, nunca llama al servicio", async () => {
    const respuestaRechazo = new Response(JSON.stringify({ ok: false, error: "NO_AUTORIZADO" }), { status: 403 });
    requireAdminMock.mockResolvedValue({ respuesta: respuestaRechazo });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ descripcionAccion: "x" }), contexto("accion-1"));
    expect(respuesta).toBe(respuestaRechazo);
    expect(actualizarAccionDecisionKpiMock).not.toHaveBeenCalled();
  });

  it("body vacio -- 400 DATOS_INVALIDOS (debe incluir al menos un campo)", async () => {
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({}), contexto("accion-1"));
    expect(respuesta.status).toBe(400);
    expect(actualizarAccionDecisionKpiMock).not.toHaveBeenCalled();
  });

  it("estado invalido -- 400 DATOS_INVALIDOS", async () => {
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ estado: "NO_EXISTE" }), contexto("accion-1"));
    expect(respuesta.status).toBe(400);
  });

  it("actualizacion de descripcion (sin cambio de estado) -- nunca agrega finalizadaPorId", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: true, datos: { id: "accion-1" } });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ descripcionAccion: "Texto nuevo" }), contexto("accion-1"));
    expect(respuesta.status).toBe(200);
    expect(actualizarAccionDecisionKpiMock).toHaveBeenCalledWith(
      expect.anything(),
      "accion-1",
      expect.not.objectContaining({ finalizadaPorId: expect.anything() }),
    );
  });

  it("estado -> COMPLETADA agrega finalizadaPorId SIEMPRE derivado de la sesion, nunca del body", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: true, datos: { id: "accion-1", estado: "COMPLETADA" } });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ estado: "COMPLETADA", finalizadaPorId: "usuario-ATACANTE" }), contexto("accion-1"));
    expect(respuesta.status).toBe(200);
    expect(actualizarAccionDecisionKpiMock).toHaveBeenCalledWith(
      expect.anything(),
      "accion-1",
      expect.objectContaining({ estado: "COMPLETADA", finalizadaPorId: "usuario-1" }),
    );
  });

  it("estado -> DESCARTADA agrega finalizadaPorId de la sesion", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: true, datos: { id: "accion-1", estado: "DESCARTADA" } });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ estado: "DESCARTADA" }), contexto("accion-1"));
    expect(respuesta.status).toBe(200);
    expect(actualizarAccionDecisionKpiMock).toHaveBeenCalledWith(
      expect.anything(),
      "accion-1",
      expect.objectContaining({ estado: "DESCARTADA", finalizadaPorId: "usuario-1" }),
    );
  });

  it("servicio rechaza con ACCION_INEXISTENTE -- 404", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "ACCION_INEXISTENTE" });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ descripcionAccion: "x" }), contexto("no-existe"));
    expect(respuesta.status).toBe(404);
  });

  it("servicio rechaza con TRANSICION_INVALIDA -- 409", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "TRANSICION_INVALIDA", detalle: ["x"] });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ estado: "PENDIENTE" }), contexto("accion-1"));
    expect(respuesta.status).toBe(409);
  });

  it("servicio rechaza con FALTA_FINALIZADA_POR -- 400", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "FALTA_FINALIZADA_POR", detalle: ["x"] });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ estado: "COMPLETADA" }), contexto("accion-1"));
    expect(respuesta.status).toBe(400);
  });

  it("correccion de ronda de revision (bloqueante 2) -- servicio rechaza con ACCION_FINALIZADA_INMUTABLE -- 409 (editar CUALQUIER campo de una accion ya finalizada, no solo el estado)", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "ACCION_FINALIZADA_INMUTABLE", detalle: ["x"] });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ descripcionAccion: "Intento de editar una accion cerrada" }), contexto("accion-1"));
    expect(respuesta.status).toBe(409);
  });

  it("correccion de ronda de revision (bloqueante 3) -- servicio rechaza con ACCION_MODIFICADA_CONCURRENTEMENTE -- 409 (otro cierre concurrente ya cambio el estado)", async () => {
    actualizarAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "ACCION_MODIFICADA_CONCURRENTEMENTE", detalle: ["x"] });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ estado: "DESCARTADA" }), contexto("accion-1"));
    expect(respuesta.status).toBe(409);
  });
});
