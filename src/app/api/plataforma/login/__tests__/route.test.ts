import { beforeEach, describe, expect, it, vi } from "vitest";

const registrarIntentoMock = vi.fn();
vi.mock("@/infra/rateLimit/limiteTasa", () => ({
  hashHuellaOrigen: () => "huella-hash",
  registrarIntento: (...args: unknown[]) => registrarIntentoMock(...args),
}));
vi.mock("@/infra/prisma/client", () => ({ prisma: {} }));

const buscarMock = vi.fn();
const registrarFalloMock = vi.fn();
const restablecerMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  buscarUsuarioPlataformaPorEmail: (...args: unknown[]) => buscarMock(...args),
  registrarIntentoFallidoPlataforma: (...args: unknown[]) => registrarFalloMock(...args),
  restablecerIntentosPlataforma: (...args: unknown[]) => restablecerMock(...args),
}));

const verifyPasswordMock = vi.fn();
vi.mock("@/infra/auth/password", () => ({ verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args) }));

const tokenMock = vi.fn();
vi.mock("@/auth.config.plataforma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth.config.plataforma")>();
  return { ...actual, crearTokenPreauthPlataforma: (...args: unknown[]) => tokenMock(...args) };
});

function request(body: unknown = { email: "curador@example.com", password: "password-segura" }) {
  return new Request("https://plataforma.example.com/api/plataforma/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://plataforma.example.com",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

const FILA = {
  id: "usuario-1",
  passwordHash: "hash-real",
  mfaSecret: "SECRETO",
  mfaHabilitado: true,
  rol: "CURADOR_METODOLOGICO",
  intentosFallidos: 0,
  bloqueadoHasta: null,
  sessionVersion: 1,
  activo: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  process.env.HUELLA_ORIGEN_SALT = "salto-pruebas-no-real";
  registrarIntentoMock.mockResolvedValue({ contador: 1, permitido: true });
  buscarMock.mockResolvedValue(FILA);
  verifyPasswordMock.mockResolvedValue(true);
  restablecerMock.mockResolvedValue(true);
  tokenMock.mockResolvedValue("token-preauth");
});

describe("POST /api/plataforma/login", () => {
  it.each([
    ["cuenta inexistente", null, true],
    ["password incorrecta", FILA, false],
    ["cuenta inactiva", { ...FILA, activo: false }, true],
    ["cuenta bloqueada", { ...FILA, bloqueadoHasta: new Date(Date.now() + 60_000) }, true],
  ])("respuesta uniforme para %s", async (_caso, fila, passwordOk) => {
    buscarMock.mockResolvedValue(fila);
    verifyPasswordMock.mockResolvedValue(passwordOk);
    const { POST } = await import("../route");

    const respuesta = await POST(request());

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ ok: false, error: "CREDENCIALES_INVALIDAS" });
  });

  it("solo registra fallo cuando existe una cuenta no bloqueada con password incorrecta", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const { POST } = await import("../route");
    await POST(request());
    expect(registrarFalloMock).toHaveBeenCalledWith("usuario-1");

    vi.clearAllMocks();
    registrarIntentoMock.mockResolvedValue({ contador: 1, permitido: true });
    buscarMock.mockResolvedValue(null);
    verifyPasswordMock.mockResolvedValue(false);
    await POST(request());
    expect(registrarFalloMock).not.toHaveBeenCalled();
  });

  it("cuenta inexistente paga una verificacion Argon2id con los parametros reales", async () => {
    buscarMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    await POST(request());

    expect(verifyPasswordMock).toHaveBeenCalledWith(
      expect.stringContaining("$argon2id$v=19$m=19456,t=2,p=1$"),
      "password-segura",
    );
    expect(registrarFalloMock).not.toHaveBeenCalled();
  });

  it("login valido emite preauth y dirige a verificar MFA", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(request());

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, siguiente: "/plataforma/verificar-mfa" });
    expect(respuesta.headers.get("set-cookie")).toContain("chainpulse_plataforma_preauth=token-preauth");
    expect(restablecerMock).toHaveBeenCalledWith("usuario-1");
  });

  it("limite por huella devuelve 429 con Retry-After", async () => {
    registrarIntentoMock.mockResolvedValue({ contador: 11, permitido: false });
    const { POST } = await import("../route");
    const respuesta = await POST(request());

    expect(respuesta.status).toBe(429);
    expect(Number(respuesta.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(buscarMock).not.toHaveBeenCalled();
  });
});
