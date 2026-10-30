import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({
  default: () => ({ auth: vi.fn(() => new Response(null, { status: 204 })) }),
}));

const verificarSesionMock = vi.fn();
vi.mock("@/auth.config.plataforma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth.config.plataforma")>();
  return { ...actual, verificarTokenSesionPlataforma: (...args: unknown[]) => verificarSesionMock(...args) };
});

function request(path: string, cookie?: string) {
  return new NextRequest(`https://plataforma.example.com${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("middleware de plataforma", () => {
  it("deja publicos login y formularios MFA; las APIs conservan su guard propio", async () => {
    const { default: middleware } = await import("../middleware");
    const login = await middleware(request("/plataforma/login"), {} as never);
    const activar = await middleware(request("/plataforma/activar-mfa"), {} as never);
    const verificar = await middleware(request("/plataforma/verificar-mfa"), {} as never);
    expect((login as Response).status).toBe(200);
    expect((activar as Response).status).toBe(200);
    expect((verificar as Response).status).toBe(200);
  });

  it("sin sesion redirige el resto del arbol de plataforma", async () => {
    const { default: middleware } = await import("../middleware");
    const respuesta = await middleware(request("/plataforma"), {} as never);
    expect((respuesta as Response).status).toBe(307);
    expect((respuesta as Response).headers.get("location")).toBe("https://plataforma.example.com/plataforma/login");
  });

  it("con JWT de sesion valido deja continuar", async () => {
    verificarSesionMock.mockResolvedValue({ usuarioId: "u1", rol: "CURADOR_METODOLOGICO", sessionVersion: 1 });
    const { default: middleware } = await import("../middleware");
    const respuesta = await middleware(
      request("/plataforma", "chainpulse_plataforma_session=sesion"),
      {} as never,
    );
    expect((respuesta as Response).status).toBe(200);
  });
});
