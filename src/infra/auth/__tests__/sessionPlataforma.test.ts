import { beforeEach, describe, expect, it, vi } from "vitest";

// requireSesionPlataforma recibe un cliente inyectado en la mayoria de
// estas pruebas. El singleton real no debe construirse ni leer
// DATABASE_URL durante unitarias -- prismaQueryRawMock es el que usan
// requireSesionPlataformaOrRedirect()/requireAdministradorPlataformaOrRedirect()
// (PR 8 correccion), que no reciben cliente inyectable y caen al default
// `= prisma`.
const prismaQueryRawMock = vi.fn();
vi.mock("../../prisma/client", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => prismaQueryRawMock(...args) },
}));

// requireSesionPlataformaRuta()/requireSesionPlataformaOrRedirect() leen
// el token desde la cookie httpOnly cuando no se les pasa uno explicito
// -- cookieTokenActual es lo que ese next/headers.cookies() mockeado
// devuelve en cada prueba.
let cookieTokenActual: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieTokenActual ? { value: cookieTokenActual } : undefined),
  }),
}));

// redirect() de Next.js nunca retorna -- en produccion lanza un error
// especial que el framework intercepta al renderizar (mismo mock que
// src/infra/auth/__tests__/session.test.ts usa para el actor tenant).
const redirectMock = vi.fn((ruta: string) => {
  throw new Error(`REDIRECT:${ruta}`);
});
vi.mock("next/navigation", () => ({ redirect: (ruta: string) => redirectMock(ruta) }));

beforeEach(() => {
  process.env.AUTH_PLATAFORMA_SECRET = "secreto-de-pruebas-plataforma-no-real";
  cookieTokenActual = undefined;
  prismaQueryRawMock.mockReset();
  redirectMock.mockClear();
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

// PR 8 correccion -- matriz de autorizacion formalizada: todo lo que
// requiere sesion de plataforma pasa por requireSesionPlataformaRuta()/
// requireSesionPlataformaOrRedirect() (cualquier rol); solo publicar y
// retirar exigen ademas requireAdministradorPlataformaRuta()/
// requireAdministradorPlataformaOrRedirect() (ADMINISTRADOR_PLATAFORMA).
// Las pruebas de cada ruta (src/app/api/plataforma/rf20/**/__tests__)
// mockean estos guards; las de aqui prueban los guards mismos.
describe("requireSesionPlataformaRuta", () => {
  it("sin cookie -- 401 generico, nunca llega a consultar Postgres", async () => {
    const queryRaw = vi.fn();
    const cliente = { $queryRaw: queryRaw } as never;
    const { requireSesionPlataformaRuta } = await import("../sessionPlataforma");

    const resultado = await requireSesionPlataformaRuta(cliente);

    expect("respuesta" in resultado).toBe(true);
    if ("respuesta" in resultado) expect(resultado.respuesta.status).toBe(401);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("CURADOR_METODOLOGICO con sesion vigente -- devuelve la sesion", async () => {
    const config = await import("@/auth.config.plataforma");
    cookieTokenActual = await config.crearTokenSesionPlataforma({
      usuarioId: "curador-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 1,
    });
    const cliente = {
      $queryRaw: vi.fn().mockResolvedValue([{ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 1 }]),
    } as never;
    const { requireSesionPlataformaRuta } = await import("../sessionPlataforma");

    const resultado = await requireSesionPlataformaRuta(cliente);

    expect("sesion" in resultado && resultado.sesion.rol).toBe("CURADOR_METODOLOGICO");
  });

  it("estado en Postgres ya no coincide (revocada) -- 401 generico", async () => {
    const config = await import("@/auth.config.plataforma");
    cookieTokenActual = await config.crearTokenSesionPlataforma({
      usuarioId: "curador-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 1,
    });
    const cliente = {
      $queryRaw: vi.fn().mockResolvedValue([{ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 2 }]),
    } as never;
    const { requireSesionPlataformaRuta } = await import("../sessionPlataforma");

    const resultado = await requireSesionPlataformaRuta(cliente);
    expect("respuesta" in resultado).toBe(true);
  });
});

describe("requireAdministradorPlataformaRuta", () => {
  it("CURADOR_METODOLOGICO -- 403, aunque la sesion sea vigente", async () => {
    const config = await import("@/auth.config.plataforma");
    cookieTokenActual = await config.crearTokenSesionPlataforma({
      usuarioId: "curador-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 1,
    });
    const cliente = {
      $queryRaw: vi.fn().mockResolvedValue([{ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 1 }]),
    } as never;
    const { requireAdministradorPlataformaRuta } = await import("../sessionPlataforma");

    const resultado = await requireAdministradorPlataformaRuta(cliente);

    expect("respuesta" in resultado).toBe(true);
    if ("respuesta" in resultado) expect(resultado.respuesta.status).toBe(403);
  });

  it("ADMINISTRADOR_PLATAFORMA -- devuelve la sesion", async () => {
    const config = await import("@/auth.config.plataforma");
    cookieTokenActual = await config.crearTokenSesionPlataforma({
      usuarioId: "admin-1",
      rol: "ADMINISTRADOR_PLATAFORMA",
      sessionVersion: 1,
    });
    const cliente = {
      $queryRaw: vi.fn().mockResolvedValue([{ activo: true, rol: "ADMINISTRADOR_PLATAFORMA", sessionVersion: 1 }]),
    } as never;
    const { requireAdministradorPlataformaRuta } = await import("../sessionPlataforma");

    const resultado = await requireAdministradorPlataformaRuta(cliente);

    expect("sesion" in resultado && resultado.sesion.rol).toBe("ADMINISTRADOR_PLATAFORMA");
  });

  it("sin sesion vigente -- 401, no 403 (no llega a evaluar el rol)", async () => {
    const cliente = { $queryRaw: vi.fn() } as never;
    const { requireAdministradorPlataformaRuta } = await import("../sessionPlataforma");

    const resultado = await requireAdministradorPlataformaRuta(cliente);

    expect("respuesta" in resultado).toBe(true);
    if ("respuesta" in resultado) expect(resultado.respuesta.status).toBe(401);
  });
});

describe("requireSesionPlataformaOrRedirect", () => {
  it("sin cookie -- redirige a /plataforma/login antes de tocar Postgres", async () => {
    const { requireSesionPlataformaOrRedirect } = await import("../sessionPlataforma");

    await expect(requireSesionPlataformaOrRedirect()).rejects.toThrow("REDIRECT:/plataforma/login");
    expect(prismaQueryRawMock).not.toHaveBeenCalled();
  });

  it("sesion vigente -- devuelve la sesion, no redirige", async () => {
    const config = await import("@/auth.config.plataforma");
    cookieTokenActual = await config.crearTokenSesionPlataforma({
      usuarioId: "curador-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 1,
    });
    prismaQueryRawMock.mockResolvedValue([{ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 1 }]);
    const { requireSesionPlataformaOrRedirect } = await import("../sessionPlataforma");

    const sesion = await requireSesionPlataformaOrRedirect();

    expect(sesion.usuarioId).toBe("curador-1");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("ruta personalizada", async () => {
    const { requireSesionPlataformaOrRedirect } = await import("../sessionPlataforma");

    await expect(requireSesionPlataformaOrRedirect("/otra-ruta")).rejects.toThrow("REDIRECT:/otra-ruta");
  });
});

describe("requireAdministradorPlataformaOrRedirect", () => {
  it("CURADOR_METODOLOGICO con sesion vigente -- redirige a /plataforma/rf20/cuestionarios por defecto", async () => {
    const config = await import("@/auth.config.plataforma");
    cookieTokenActual = await config.crearTokenSesionPlataforma({
      usuarioId: "curador-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 1,
    });
    prismaQueryRawMock.mockResolvedValue([{ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 1 }]);
    const { requireAdministradorPlataformaOrRedirect } = await import("../sessionPlataforma");

    await expect(requireAdministradorPlataformaOrRedirect()).rejects.toThrow(
      "REDIRECT:/plataforma/rf20/cuestionarios",
    );
  });

  it("ADMINISTRADOR_PLATAFORMA con sesion vigente -- devuelve la sesion, no redirige", async () => {
    const config = await import("@/auth.config.plataforma");
    cookieTokenActual = await config.crearTokenSesionPlataforma({
      usuarioId: "admin-1",
      rol: "ADMINISTRADOR_PLATAFORMA",
      sessionVersion: 1,
    });
    prismaQueryRawMock.mockResolvedValue([{ activo: true, rol: "ADMINISTRADOR_PLATAFORMA", sessionVersion: 1 }]);
    const { requireAdministradorPlataformaOrRedirect } = await import("../sessionPlataforma");

    const sesion = await requireAdministradorPlataformaOrRedirect();

    expect(sesion.rol).toBe("ADMINISTRADOR_PLATAFORMA");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sin sesion -- redirige a /plataforma/login, no al rutaNoAutorizado (no llega a evaluar el rol)", async () => {
    const { requireAdministradorPlataformaOrRedirect } = await import("../sessionPlataforma");

    await expect(requireAdministradorPlataformaOrRedirect()).rejects.toThrow("REDIRECT:/plataforma/login");
  });
});
