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

describe("EntradaPlataformaPage", () => {
  it("sin sesion -- redirige a /plataforma/login", async () => {
    requireSesionMock.mockRejectedValue(new Error("SESION_PLATAFORMA_INVALIDA"));
    const { default: EntradaPlataformaPage } = await import("../page");

    await expect(EntradaPlataformaPage()).rejects.toThrow("REDIRECT:/plataforma/login");
  });

  it("con sesion vigente (cualquier rol) -- redirige al modulo RF20", async () => {
    requireSesionMock.mockResolvedValue({ usuarioId: "u1", rol: "ADMINISTRADOR_PLATAFORMA", sessionVersion: 1 });
    const { default: EntradaPlataformaPage } = await import("../page");

    await expect(EntradaPlataformaPage()).rejects.toThrow("REDIRECT:/plataforma/rf20/cuestionarios");
  });
});
