// Pruebas — POST /api/mfa/activar (correccion acotada, Alex 2026-10-04,
// autorizada sobre diagnostico-eliminacion-cuenta-prueba.md Seccion 10 /
// revocacion-sesion-despliegue.md). A diferencia de otras rutas (ver
// .../importaciones/__tests__/route.test.ts, que mockea requireAdmin()
// directo), aca requireSession() y verificarSesionVigente() se dejan
// SIN mockear a proposito: la ruta ahora depende de esa cadena real para
// rechazar usuarios eliminados/con sesion revocada, y un mock de
// requireSession() no probaria nada de esa cadena -- solo mockeamos su
// unica dependencia externa real, tenantClient() (ninguna consulta ni red
// real; "prisma generate" sigue bloqueado en este entorno). Las pruebas
// de integracion contra una base real quedan pendientes de autorizacion
// aparte.
import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const tenantClientMock = vi.fn(() => ({
  usuario: {
    findUnique: findUniqueMock,
    findFirst: findFirstMock,
    update: updateMock,
  },
}));
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: tenantClientMock }));

const verificarCodigoMfaMock = vi.fn();
vi.mock("@/infra/auth/mfa", () => ({ verificarCodigoMfa: (...args: unknown[]) => verificarCodigoMfaMock(...args) }));

const estaBloqueadoMock = vi.fn();
const registrarIntentoFallidoMock = vi.fn();
vi.mock("@/infra/auth/rateLimit", () => ({
  estaBloqueado: (...args: unknown[]) => estaBloqueadoMock(...args),
  registrarIntentoFallido: (...args: unknown[]) => registrarIntentoFallidoMock(...args),
}));

const logErrorMock = vi.fn();
vi.mock("@/infra/log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

// Nota deliberada: "@/infra/auth/session" (requireSession) y
// "@/infra/auth/sessionVerification" (verificarSesionVigente) NO se
// mockean -- son el codigo bajo prueba en esta ronda.

const SESION_RAW = {
  id: "usuario-1",
  empresaId: "empresa-1",
  email: "admin@chainpulse.test",
  name: "Admin",
  rol: "ADMINISTRADOR",
  eslabonId: null,
  sessionVersion: 1,
};

const USUARIO_DB = { id: "usuario-1", mfaSecret: "SECRETO_TOTP", mfaHabilitado: false, bloqueadoHasta: null };

function construirRequest(codigo: unknown = "123456"): Request {
  return new Request("http://localhost/api/mfa/activar", {
    method: "POST",
    body: JSON.stringify({ codigo }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // DB del usuario en sesion, vista por verificarSesionVigente()
  // (findUnique) -- sessionVersion=1, igual al claim del JWT de
  // SESION_RAW: vigente por defecto en cada prueba, salvo que un test
  // puntual lo cambie.
  findUniqueMock.mockResolvedValue({ sessionVersion: 1 });
  findFirstMock.mockResolvedValue(USUARIO_DB);
  updateMock.mockResolvedValue({ ...USUARIO_DB, mfaHabilitado: true });
  estaBloqueadoMock.mockReturnValue(false);
  verificarCodigoMfaMock.mockReturnValue(true);
});

describe("POST /api/mfa/activar -- requireSession()/verificarSesionVigente() (cadena real, sin mockear)", () => {
  it("sin sesion -- 401 NO_SESION, nunca llega a la logica de MFA", async () => {
    authMock.mockResolvedValue(null);

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ ok: false, error: "NO_SESION" });
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("sesion revocada (sessionVersion de la base ya no coincide con el claim) -- mismo 401 generico, nunca llega a la logica de MFA", async () => {
    authMock.mockResolvedValue({ user: SESION_RAW });
    findUniqueMock.mockResolvedValue({ sessionVersion: 2 }); // claim del JWT sigue en 1

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ ok: false, error: "NO_SESION" });
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("usuario eliminado (cero filas en la verificacion de vigencia) -- mismo 401 generico, sin distinguir el motivo", async () => {
    authMock.mockResolvedValue({ user: SESION_RAW });
    findUniqueMock.mockResolvedValue(null);

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ ok: false, error: "NO_SESION" });
  });

  it("fallo de la consulta de vigencia (timeout/conexion) -- fail-closed, 401 generico, nunca ok:true", async () => {
    authMock.mockResolvedValue({ user: SESION_RAW });
    findUniqueMock.mockRejectedValue(new Error("conexion perdida"));

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(401);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("JWT viejo SIN claim sessionVersion, usuario nunca revocado (sessionVersion=1 en base) -- se acepta, llega a la logica de MFA", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- sessionVersion se extrae a proposito solo para excluirlo de sinClaim (simula un JWT viejo sin ese claim); la variable en si no se usa.
    const { sessionVersion, ...sinClaim } = SESION_RAW;
    authMock.mockResolvedValue({ user: sinClaim });
    findUniqueMock.mockResolvedValue({ sessionVersion: 1 }); // valor por defecto, nunca revocado

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
    expect(findFirstMock).toHaveBeenCalled();
  });

  it("JWT viejo SIN claim sessionVersion, pero el usuario SI fue revocado despues (sessionVersion=2 en base) -- se rechaza; un login nuevo no sustituye esta prueba", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- sessionVersion se extrae a proposito solo para excluirlo de sinClaim (simula un JWT viejo sin ese claim); la variable en si no se usa.
    const { sessionVersion, ...sinClaim } = SESION_RAW;
    authMock.mockResolvedValue({ user: sinClaim });
    findUniqueMock.mockResolvedValue({ sessionVersion: 2 });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ ok: false, error: "NO_SESION" });
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/mfa/activar -- logica de negocio (sesion vigente)", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: SESION_RAW });
  });

  it("sin secreto TOTP generado -- SIN_SECRETO, nunca llama a verificarCodigoMfa", async () => {
    findFirstMock.mockResolvedValue({ ...USUARIO_DB, mfaSecret: null });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ ok: false, error: "SIN_SECRETO" });
    expect(verificarCodigoMfaMock).not.toHaveBeenCalled();
  });

  it("usuario bloqueado por intentos previos -- CODIGO_INVALIDO, sin registrar un intento fallido nuevo", async () => {
    estaBloqueadoMock.mockReturnValue(true);

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ ok: false, error: "CODIGO_INVALIDO" });
    expect(registrarIntentoFallidoMock).not.toHaveBeenCalled();
  });

  it("codigo TOTP invalido -- CODIGO_INVALIDO y cuenta como intento fallido (mismo contador que la contraseña, R5-1)", async () => {
    verificarCodigoMfaMock.mockReturnValue(false);

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest("000000"));

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ ok: false, error: "CODIGO_INVALIDO" });
    expect(registrarIntentoFallidoMock).toHaveBeenCalledWith("empresa-1", "usuario-1");
  });

  it("codigo valido con mfaHabilitado=false -- activa MFA sin exigir que ya estuviera activado", async () => {
    findFirstMock.mockResolvedValue({ ...USUARIO_DB, mfaHabilitado: false });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "usuario-1" }, data: { mfaHabilitado: true } });
  });

  it("aislamiento -- las consultas de negocio usan el empresaId de la propia sesion", async () => {
    const { POST } = await import("../route");
    await POST(construirRequest());

    expect(tenantClientMock).toHaveBeenCalledWith("empresa-1");
    expect(findFirstMock).toHaveBeenCalledWith({ where: { email: "admin@chainpulse.test" } });
  });

  it("fallo inesperado (ej. tenantClient lanza) -- ERROR_INTERNO 500, se registra con logError", async () => {
    findFirstMock.mockRejectedValue(new Error("fallo de base"));

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest());

    expect(respuesta.status).toBe(500);
    expect(await respuesta.json()).toEqual({ ok: false, error: "ERROR_INTERNO" });
    expect(logErrorMock).toHaveBeenCalledWith("api/mfa/activar", expect.any(Error));
  });
});
