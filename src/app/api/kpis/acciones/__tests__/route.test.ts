// Pruebas -- POST/GET .../api/kpis/acciones (crear + listar por origen).
// Mismo patron que .../cobertura/importaciones/[id]/__tests__/route.test.ts:
// llama DIRECTAMENTE a los handlers exportados, con requireAdmin() y la
// capa de servicio mockeadas (nunca Prisma real, nunca Neon).
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const tenantClientMock = vi.fn(() => ({}));
vi.mock("@/infra/prisma/tenantClient", () => ({
  tenantClient: tenantClientMock,
}));

const crearAccionDecisionKpiMock = vi.fn();
const listarAccionesPorOrigenMock = vi.fn();
vi.mock("@/infra/kpis/acciones/servicio", () => ({
  crearAccionDecisionKpi: (...args: unknown[]) => crearAccionDecisionKpiMock(...args),
  listarAccionesPorOrigen: (...args: unknown[]) => listarAccionesPorOrigenMock(...args),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-1", rol: "ADMINISTRADOR", email: "a@b.com" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

function bodyRequest(body: unknown) {
  return new Request("http://localhost/api/kpis/acciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Correccion de ronda de revision (bloqueante 1): el body YA NO declara
// ruleVersionOrigen/prioridadOrigen -- el servidor los deriva el mismo
// (ver derivarOrigenActual.ts, llamado desde crearAccionDecisionKpi()).
const BODY_VALIDO = {
  origen: { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" },
  descripcionAccion: "Contactar al proveedor X",
  responsableId: "resp-1",
  fechaObjetivo: "2026-12-01T00:00:00.000Z",
};

describe("POST .../api/kpis/acciones", () => {
  it("requireAdmin rechaza -- devuelve esa respuesta tal cual, nunca llama a crearAccionDecisionKpi", async () => {
    const respuestaRechazo = new Response(JSON.stringify({ ok: false, error: "NO_AUTORIZADO" }), { status: 403 });
    requireAdminMock.mockResolvedValue({ respuesta: respuestaRechazo });
    const { POST } = await import("../route");
    const respuesta = await POST(bodyRequest(BODY_VALIDO));
    expect(respuesta).toBe(respuestaRechazo);
    expect(crearAccionDecisionKpiMock).not.toHaveBeenCalled();
  });

  it("body invalido (falta descripcionAccion) -- 400 DATOS_INVALIDOS, nunca llama al servicio", async () => {
    const { POST } = await import("../route");
    const { descripcionAccion, ...sinDescripcion } = BODY_VALIDO;
    void descripcionAccion;
    const respuesta = await POST(bodyRequest(sinDescripcion));
    expect(respuesta.status).toBe(400);
    const cuerpo = await respuesta.json();
    expect(cuerpo.ok).toBe(false);
    expect(cuerpo.error).toBe("DATOS_INVALIDOS");
    expect(crearAccionDecisionKpiMock).not.toHaveBeenCalled();
  });

  it("body invalido (origen sin tipo reconocido) -- 400 DATOS_INVALIDOS, nunca llama al servicio", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(bodyRequest({ ...BODY_VALIDO, origen: { tipo: "OTRO", observacionKpiId: "obs-1" } }));
    expect(respuesta.status).toBe(400);
    expect(crearAccionDecisionKpiMock).not.toHaveBeenCalled();
  });

  it("delega en crearAccionDecisionKpi con creadaPorId SIEMPRE derivado de la sesion, nunca del body", async () => {
    crearAccionDecisionKpiMock.mockResolvedValue({ ok: true, datos: { id: "accion-1" } });
    const { POST } = await import("../route");
    const respuesta = await POST(bodyRequest({ ...BODY_VALIDO, creadaPorId: "usuario-ATACANTE" }));
    expect(respuesta.status).toBe(201);
    expect(crearAccionDecisionKpiMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ creadaPorId: "usuario-1", empresaId: "empresa-1" }),
    );
  });

  it("servicio rechaza con *_INEXISTENTE -- 404", async () => {
    crearAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "RESPONSABLE_INEXISTENTE" });
    const { POST } = await import("../route");
    const respuesta = await POST(bodyRequest(BODY_VALIDO));
    expect(respuesta.status).toBe(404);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ ok: false, error: "RESPONSABLE_INEXISTENTE", detalle: undefined });
  });

  it("servicio rechaza con TENANT_INCONSISTENTE -- 400", async () => {
    crearAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "TENANT_INCONSISTENTE", detalle: ["x"] });
    const { POST } = await import("../route");
    const respuesta = await POST(bodyRequest(BODY_VALIDO));
    expect(respuesta.status).toBe(400);
  });

  it("servicio rechaza con ORIGEN_SIN_RECOMENDACION_ACCIONABLE -- 409 (conflicto con el estado actual del origen, no un dato malformado)", async () => {
    crearAccionDecisionKpiMock.mockResolvedValue({ ok: false, error: "ORIGEN_SIN_RECOMENDACION_ACCIONABLE" });
    const { POST } = await import("../route");
    const respuesta = await POST(bodyRequest(BODY_VALIDO));
    expect(respuesta.status).toBe(409);
  });

  it("correccion de ronda de revision (bloqueante 1) -- un body que declara ruleVersionOrigen/prioridadOrigen manipulados NUNCA llega a crearAccionDecisionKpi() con esos valores: zod los descarta en silencio (no son campos del schema) y la ruta solo reenvia origen/descripcionAccion/responsableId/fechaObjetivo/creadaPorId", async () => {
    crearAccionDecisionKpiMock.mockResolvedValue({ ok: true, datos: { id: "accion-1" } });
    const { POST } = await import("../route");
    const respuesta = await POST(
      bodyRequest({ ...BODY_VALIDO, ruleVersionOrigen: "version-FALSIFICADA", prioridadOrigen: "ALTA" }),
    );
    expect(respuesta.status).toBe(201);
    expect(crearAccionDecisionKpiMock).toHaveBeenCalledTimes(1);
    const [, datosEnviados] = crearAccionDecisionKpiMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(datosEnviados).not.toHaveProperty("ruleVersionOrigen");
    expect(datosEnviados).not.toHaveProperty("prioridadOrigen");
  });
});

describe("GET .../api/kpis/acciones", () => {
  function getRequest(query: string) {
    return new Request(`http://localhost/api/kpis/acciones${query}`);
  }

  it("requireAdmin rechaza -- devuelve esa respuesta tal cual", async () => {
    const respuestaRechazo = new Response(JSON.stringify({ ok: false, error: "NO_AUTORIZADO" }), { status: 403 });
    requireAdminMock.mockResolvedValue({ respuesta: respuestaRechazo });
    const { GET } = await import("../route");
    const respuesta = await GET(getRequest("?observacionKpiId=obs-1"));
    expect(respuesta).toBe(respuestaRechazo);
    expect(listarAccionesPorOrigenMock).not.toHaveBeenCalled();
  });

  it("sin ningun origen en la query -- 400 ORIGEN_INVALIDO", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(getRequest(""));
    expect(respuesta.status).toBe(400);
    const cuerpo = await respuesta.json();
    expect(cuerpo.error).toBe("ORIGEN_INVALIDO");
  });

  it("con AMBOS origenes en la query -- 400 ORIGEN_INVALIDO, nunca llama al servicio", async () => {
    const { GET } = await import("../route");
    const respuesta = await GET(getRequest("?observacionKpiId=obs-1&importacionCsvId=imp-1"));
    expect(respuesta.status).toBe(400);
    expect(listarAccionesPorOrigenMock).not.toHaveBeenCalled();
  });

  it("con observacionKpiId -- delega en listarAccionesPorOrigen con ese origen", async () => {
    listarAccionesPorOrigenMock.mockResolvedValue([{ id: "accion-1" }]);
    const { GET } = await import("../route");
    const respuesta = await GET(getRequest("?observacionKpiId=obs-1"));
    expect(respuesta.status).toBe(200);
    expect(listarAccionesPorOrigenMock).toHaveBeenCalledWith(expect.anything(), { observacionKpiId: "obs-1" });
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ ok: true, acciones: [{ id: "accion-1" }] });
  });

  it("con importacionCsvId -- delega en listarAccionesPorOrigen con ese origen", async () => {
    listarAccionesPorOrigenMock.mockResolvedValue([]);
    const { GET } = await import("../route");
    const respuesta = await GET(getRequest("?importacionCsvId=imp-1"));
    expect(respuesta.status).toBe(200);
    expect(listarAccionesPorOrigenMock).toHaveBeenCalledWith(expect.anything(), { importacionCsvId: "imp-1" });
  });
});
