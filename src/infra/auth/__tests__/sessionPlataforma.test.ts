import { beforeEach, describe, expect, it, vi } from "vitest";

// requireSesionPlataforma recibe un cliente inyectado en estas pruebas. El
// singleton real no debe construirse ni leer DATABASE_URL durante unitarias.
vi.mock("../../prisma/client", () => ({ prisma: { $queryRaw: vi.fn() } }));

beforeEach(() => {
  process.env.AUTH_PLATAFORMA_SECRET = "secreto-de-pruebas-plataforma-no-real";
});

describe("requireSesionPlataforma", () => {
  it("acepta token, rol y sessionVersion coincidentes con la base", async () => {
    const config = await import("@/auth.config.plataforma");
    const sesion = await import("../sessionPlataforma");
    const token = await config.crearTokenSesionPlataforma({
      usuarioId: "usuario-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 2,
    });
    const cliente = {
      $queryRaw: vi.fn().mockResolvedValue([
        { activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 2 },
      ]),
    } as never;

    await expect(sesion.requireSesionPlataforma(token, cliente)).resolves.toEqual({
      usuarioId: "usuario-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 2,
      activo: true,
    });
  });

  it.each([
    ["usuario inactivo", { activo: false, rol: "CURADOR_METODOLOGICO", sessionVersion: 2 }],
    ["version revocada", { activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 3 }],
    ["rol cambiado", { activo: true, rol: "ADMINISTRADOR_PLATAFORMA", sessionVersion: 2 }],
  ])("rechaza %s", async (_caso, estado) => {
    const config = await import("@/auth.config.plataforma");
    const sesion = await import("../sessionPlataforma");
    const token = await config.crearTokenSesionPlataforma({
      usuarioId: "usuario-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 2,
    });
    const cliente = { $queryRaw: vi.fn().mockResolvedValue([estado]) } as never;

    await expect(sesion.requireSesionPlataforma(token, cliente)).rejects.toThrow(
      "SESION_PLATAFORMA_INVALIDA",
    );
  });

  it("falla cerrado si Postgres no responde", async () => {
    const config = await import("@/auth.config.plataforma");
    const sesion = await import("../sessionPlataforma");
    const token = await config.crearTokenSesionPlataforma({
      usuarioId: "usuario-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 1,
    });
    const cliente = { $queryRaw: vi.fn().mockRejectedValue(new Error("DSN-SECRETO")) } as never;

    await expect(sesion.requireSesionPlataforma(token, cliente)).rejects.toThrow(
      "SESION_PLATAFORMA_INVALIDA",
    );
  });
});

describe("wrappers SQL de plataforma", () => {
  it("normaliza ausencia de filas y booleanos sin acceso directo a la tabla", async () => {
    const modulo = await import("../sessionPlataforma");
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ intentosFallidos: 5, bloqueadoHasta: new Date(1_800_000_000_000) }])
      .mockResolvedValueOnce([{ restablecido: true }])
      .mockResolvedValueOnce([{ sessionVersion: 4 }])
      .mockResolvedValueOnce([{ desactivado: true }])
      .mockResolvedValueOnce([{ reactivado: false }]);
    const cliente = { $queryRaw: queryRaw } as never;

    await expect(modulo.buscarUsuarioPlataformaPorEmail("A@EXAMPLE.COM", cliente)).resolves.toBeNull();
    await expect(modulo.registrarIntentoFallidoPlataforma("u1", cliente)).resolves.toMatchObject({
      intentosFallidos: 5,
    });
    await expect(modulo.restablecerIntentosPlataforma("u1", cliente)).resolves.toBe(true);
    await expect(modulo.incrementarVersionSesionPlataforma("u1", cliente)).resolves.toBe(4);
    await expect(modulo.desactivarUsuarioPlataforma("u1", "actor", cliente)).resolves.toBe(true);
    await expect(modulo.reactivarUsuarioPlataforma("u1", "actor", cliente)).resolves.toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(6);
  });
});
