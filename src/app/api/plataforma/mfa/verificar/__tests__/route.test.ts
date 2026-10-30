import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verificarPreauthMock = vi.fn();
const crearSesionMock = vi.fn();
vi.mock("@/auth.config.plataforma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth.config.plataforma")>();
  return {
    ...actual,
    verificarTokenPreauthPlataforma: (...args: unknown[]) => verificarPreauthMock(...args),
    crearTokenSesionPlataforma: (...args: unknown[]) => crearSesionMock(...args),
  };
});

const leerMfaMock = vi.fn();
const verificarContadorMock = vi.fn();
const activarMock = vi.fn();
const consumirMock = vi.fn();
vi.mock("@/infra/auth/mfaPlataforma", () => ({
  leerMfaPlataforma: (...args: unknown[]) => leerMfaMock(...args),
  verificarYCalcularContador: (...args: unknown[]) => verificarContadorMock(...args),
  activarMfaPlataforma: (...args: unknown[]) => activarMock(...args),
  consumirContadorTotpPlataforma: (...args: unknown[]) => consumirMock(...args),
}));

const leerEstadoMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  leerEstadoSesionPlataforma: (...args: unknown[]) => leerEstadoMock(...args),
}));

const registrarIntentoMock = vi.fn();
vi.mock("@/infra/rateLimit/limiteTasa", () => ({
  hashHuellaOrigen: () => "huella-hash",
  registrarIntento: (...args: unknown[]) => registrarIntentoMock(...args),
}));
vi.mock("@/infra/prisma/client", () => ({ prisma: {} }));

function request() {
  return new NextRequest("https://plataforma.example.com/api/plataforma/mfa/verificar", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://plataforma.example.com",
      cookie: "chainpulse_plataforma_preauth=preauth",
    },
    body: JSON.stringify({ codigo: "123456" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  process.env.HUELLA_ORIGEN_SALT = "salto-pruebas-no-real";
  verificarPreauthMock.mockResolvedValue({ usuarioId: "u1" });
  registrarIntentoMock.mockResolvedValue({ contador: 1, permitido: true });
  leerMfaMock.mockResolvedValue({ mfaSecret: "SECRETO", mfaHabilitado: true });
  verificarContadorMock.mockReturnValue({ valido: true, contadorAceptado: 100 });
  consumirMock.mockResolvedValue(true);
  activarMock.mockResolvedValue(true);
  leerEstadoMock.mockResolvedValue({ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 2 });
  crearSesionMock.mockResolvedValue("token-sesion");
});

describe("POST /api/plataforma/mfa/verificar", () => {
  it("consume contador, emite sesion y elimina preauth", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(request());

    expect(respuesta.status).toBe(200);
    expect(consumirMock).toHaveBeenCalledWith("u1", 100);
    const cookies = respuesta.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("chainpulse_plataforma_session=token-sesion");
    expect(cookies).toContain("chainpulse_plataforma_preauth=");
  });

  it("un contador ya consumido se rechaza y nunca emite sesion", async () => {
    consumirMock.mockResolvedValue(false);
    const { POST } = await import("../route");
    const respuesta = await POST(request());

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ ok: false, error: "CODIGO_INVALIDO" });
    expect(crearSesionMock).not.toHaveBeenCalled();
  });

  it("primer MFA activa atomicamente en lugar de consumir", async () => {
    leerMfaMock.mockResolvedValue({ mfaSecret: "SECRETO", mfaHabilitado: false });
    const { POST } = await import("../route");
    const respuesta = await POST(request());

    expect(respuesta.status).toBe(200);
    expect(activarMock).toHaveBeenCalledWith("u1", 100);
    expect(consumirMock).not.toHaveBeenCalled();
  });
});
