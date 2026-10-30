import { beforeEach, describe, expect, it } from "vitest";
import { decodeJwt } from "jose";

beforeEach(() => {
  process.env.AUTH_PLATAFORMA_SECRET = "secreto-de-pruebas-plataforma-no-real";
});

describe("tokens de plataforma", () => {
  it("separa estrictamente preauth y sesion por audiencia", async () => {
    const config = await import("@/auth.config.plataforma");
    const ahora = Date.now();
    const preauth = await config.crearTokenPreauthPlataforma("usuario-1", ahora);
    const sesion = await config.crearTokenSesionPlataforma(
      { usuarioId: "usuario-1", rol: "CURADOR_METODOLOGICO", sessionVersion: 3 },
      ahora,
    );

    expect(await config.verificarTokenPreauthPlataforma(preauth)).toEqual({ usuarioId: "usuario-1" });
    expect(await config.verificarTokenSesionPlataforma(sesion)).toEqual({
      usuarioId: "usuario-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 3,
    });
    expect(await config.verificarTokenSesionPlataforma(preauth)).toBeNull();
    expect(await config.verificarTokenPreauthPlataforma(sesion)).toBeNull();
  });

  it("preauth no contiene rol ni sessionVersion y conserva TTL de 10 minutos", async () => {
    const config = await import("@/auth.config.plataforma");
    const token = await config.crearTokenPreauthPlataforma("usuario-2", Date.now());
    const payload = decodeJwt(token);

    expect(payload.rol).toBeUndefined();
    expect(payload.sessionVersion).toBeUndefined();
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(config.TTL_PREAUTH_PLATAFORMA_SEGUNDOS);
  });

  it("rechaza una sesion firmada con otro secreto", async () => {
    const config = await import("@/auth.config.plataforma");
    const token = await config.crearTokenSesionPlataforma({
      usuarioId: "usuario-3",
      rol: "ADMINISTRADOR_PLATAFORMA",
      sessionVersion: 1,
    });
    process.env.AUTH_PLATAFORMA_SECRET = "otro-secreto-no-real";

    expect(await config.verificarTokenSesionPlataforma(token)).toBeNull();
  });
});
