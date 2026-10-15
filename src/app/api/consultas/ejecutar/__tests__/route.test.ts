// Pruebas -- POST /api/consultas/ejecutar. requireSession y
// ejecutarConsultaPermitida mockeados (construirConsultaPermitida corre
// REAL via importActual -- es pura, sin Prisma): esta prueba es de la
// RUTA (parseo de payload, mapeo de errores a status HTTP, que
// empresaId/usuarioId/rol SIEMPRE salgan de la sesion y nunca del
// payload), no del dispatcher en si (eso lo cubre
// infra/queries/__tests__/ejecutarConsultaPermitida.test.ts).
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireSession: (...args: unknown[]) => requireSessionMock(...args) }));

// construirConsultaPermitida() (pura) corre REAL via importActual, pero
// ese mismo archivo fuente tambien importa tenantClient() -> prisma/client
// -> new PrismaClient() a nivel de modulo -- y "prisma generate" sigue
// bloqueado en este entorno (ver README). Sin este mock, importActual()
// reventaria igual que cualquier otro test que toque el Prisma Client
// real (mismo motivo que job.test.ts). ejecutarConsultaPermitida() en si
// esta mockeado abajo y nunca llega a usar tenantClient real.
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: vi.fn() }));

const ejecutarConsultaPermitidaMock = vi.fn();
vi.mock("@/infra/queries/ejecutarConsultaPermitida", async () => {
  const actual = await vi.importActual<typeof import("@/infra/queries/ejecutarConsultaPermitida")>("@/infra/queries/ejecutarConsultaPermitida");
  return {
    ...actual,
    ejecutarConsultaPermitida: (...args: unknown[]) => ejecutarConsultaPermitidaMock(...args),
  };
});

const SESION_ADMIN = { usuarioId: "u1", empresaId: "e1", rol: "ADMINISTRADOR", email: "a@b.com", nombre: null, eslabonId: null };
const PAYLOAD_SIN_PERIODO = { catalogoId: "DEPENDENCIA_CRITICA", cadenaId: "cadena-1" };
const PAYLOAD_CON_PERIODO = { catalogoId: "OTIF_CAIDA", cadenaId: "cadena-1", periodoInicio: "2026-09-01", periodoFin: "2026-09-30" };

function construirRequest(body: unknown): Request {
  return new Request("http://localhost/api/consultas/ejecutar", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue({ sesion: SESION_ADMIN });
});

describe("POST /ejecutar -- autenticacion", () => {
  it("sin sesion valida -- devuelve la respuesta de requireSession tal cual, nunca llama a ejecutarConsultaPermitida", async () => {
    const { NextResponse } = await import("next/server");
    requireSessionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 }) });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(respuesta.status).toBe(401);
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });
});

describe("POST /ejecutar -- validacion de payload (antes de llamar al dispatcher)", () => {
  it("body no-JSON -> 400 CUERPO_INVALIDO, nunca llama al dispatcher", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest("esto no es json"));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CUERPO_INVALIDO");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("falta catalogoId -> 400 DATOS_INVALIDOS", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ cadenaId: "cadena-1" }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("catalogoId fuera del catalogo cerrado -> 400 CATALOGO_ID_INVALIDO (I5-08), nunca llama al dispatcher", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ catalogoId: "SELECT * FROM x", cadenaId: "cadena-1" }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CATALOGO_ID_INVALIDO");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("pregunta que requiere periodo sin periodoInicio/periodoFin -> 400 PERIODO_REQUERIDO, nunca llama al dispatcher", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ catalogoId: "OTIF_CAIDA", cadenaId: "cadena-1" }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("PERIODO_REQUERIDO");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });
});

describe("POST /ejecutar -- empresaId/usuarioId/rol SIEMPRE de la sesion, nunca del payload", () => {
  it("un intento de inyectar empresaId/usuarioId/rol en el body es ignorado -- el contexto pasado al dispatcher es el de requireSession", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "CADENA_INEXISTENTE" });
    const { POST } = await import("../route");
    await POST(
      construirRequest({
        ...PAYLOAD_SIN_PERIODO,
        empresaId: "empresa-ajena",
        usuarioId: "usuario-ajeno",
        rol: "ADMINISTRADOR_FALSO",
      }),
    );

    expect(ejecutarConsultaPermitidaMock).toHaveBeenCalledTimes(1);
    const [, contexto] = ejecutarConsultaPermitidaMock.mock.calls[0] as [unknown, { empresaId: string; usuarioId: string; rol: string }];
    expect(contexto).toEqual({ empresaId: SESION_ADMIN.empresaId, usuarioId: SESION_ADMIN.usuarioId, rol: SESION_ADMIN.rol });
  });
});

describe("POST /ejecutar -- mapeo de errores del dispatcher a status HTTP", () => {
  it("CADENA_INEXISTENTE -> 404", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "CADENA_INEXISTENTE" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    expect(respuesta.status).toBe(404);
  });

  it("PERMISO_DENEGADO -> 403", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "PERMISO_DENEGADO" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    expect(respuesta.status).toBe(403);
  });

  it("SIN_DATOS_SUFICIENTES -> 200 (es una respuesta honesta y esperada, I5-25, nunca una falla de la ruta)", async () => {
    const respuestaSinDatos = {
      ok: false,
      catalogoId: "OTIF_CAIDA",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: "No puedo responder todavía",
      camposFaltantes: ["periodo actual"],
      comoIngresarlos: "Declara el periodo",
    };
    ejecutarConsultaPermitidaMock.mockResolvedValue(respuestaSinDatos);
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_CON_PERIODO));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual(respuestaSinDatos);
  });

  it("ok:true -> 200 con la respuesta completa (hecho/interpretacion/accion incluidos)", async () => {
    const respuestaOk = {
      ok: true,
      catalogoId: "OTIF_CAIDA",
      respuestaDirecta: "El OTIF se mantuvo.",
      periodo: { inicio: "2026-09-01", fin: "2026-09-30" },
      filtros: {},
      fuente: "ObservacionKpi",
      formula: "numerador/denominador",
      numerador: 90,
      denominador: 100,
      calidad: { faltantes: [], cobertura: 1 },
      hecho: "El OTIF del periodo fue 90%.",
      interpretacion: "Se mantuvo respecto al periodo anterior.",
      accion: "Ninguna accion urgente.",
      comoComprobar: "Revisa ObservacionKpi del periodo.",
      ruleVersion: "consultas-v1",
    };
    ejecutarConsultaPermitidaMock.mockResolvedValue(respuestaOk);
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_CON_PERIODO));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual(respuestaOk);
  });
});
