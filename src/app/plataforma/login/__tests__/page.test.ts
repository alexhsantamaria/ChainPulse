import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataforma: (...args: unknown[]) => requireSesionMock(...args),
}));

const redirectMock = vi.fn((ruta: string) => {
  throw new Error(`REDIRECT:${ruta}`);
});
vi.mock("next/navigation", () => ({ redirect: (ruta: string) => redirectMock(ruta) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginPlataformaPage", () => {
  it("sin sesion -- renderiza el formulario, no redirige", async () => {
    requireSesionMock.mockRejectedValue(new Error("SESION_PLATAFORMA_INVALIDA"));
    const { default: LoginPlataformaPage } = await import("../page");

    const elemento = await LoginPlataformaPage();

    expect(elemento).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("con sesion vigente -- redirige al modulo RF20 en vez de mostrar el formulario", async () => {
    requireSesionMock.mockResolvedValue({ usuarioId: "u1", rol: "CURADOR_METODOLOGICO", sessionVersion: 1 });
    const { default: LoginPlataformaPage } = await import("../page");

    await expect(LoginPlataformaPage()).rejects.toThrow("REDIRECT:/plataforma/rf20/cuestionarios");
  });
});
