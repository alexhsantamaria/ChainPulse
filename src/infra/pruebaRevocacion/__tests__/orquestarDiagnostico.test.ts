// Pruebas — orquestacion del diagnostico de solo lectura (Alex,
// 2026-10-04, punto 2 de la segunda correccion: probar los caminos del
// SCRIPT, no solo de los modulos auxiliares). Clientes y lectura de
// migraciones 100% inyectados -- ninguna prueba toca Postgres ni el
// disco real.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { destinoConfirmado } from "../destinoPrueba";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
});

const DATABASE_URL = "postgresql://chainpulse_app:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const SEED_DATABASE_URL = "postgresql://neondb_owner:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const DESTINO = { host: "host-de-prueba.neon.tech", puerto: "5432", base: "chainpulse_prueba", esquema: "public", usuario: "chainpulse_app" };

function clienteOk(rol: string) {
  return {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ usuario_actual: rol, base_actual: "chainpulse_prueba", esquema_actual: "public" }])
      .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }])
      .mockResolvedValueOnce([{ migration_name: "20260101000000_otra", finished_at: new Date(), rolled_back_at: null }]),
  };
}

function depsBase() {
  process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado({ ...DESTINO, usuario: "chainpulse_app" });
  return {
    databaseUrl: DATABASE_URL,
    seedDatabaseUrl: SEED_DATABASE_URL,
    construirApp: vi.fn(() => clienteOk("chainpulse_app")),
    construirAdmin: vi.fn(() => clienteOk("neondb_owner")),
    desconectar: vi.fn().mockResolvedValue(undefined),
    migracionesEnRepo: vi.fn(() => ["20260101000000_otra", "20261003080000_incremento_revocacion_sesion"]),
  };
}

describe("orquestarDiagnostico", () => {
  it("destino confirmado, roles OK, unica pendiente esperada -- resuelve con el estado", async () => {
    const { orquestarDiagnostico } = await import("../orquestarDiagnostico");
    const deps = depsBase();
    const resultado = await orquestarDiagnostico(deps);
    expect(resultado.estado.pendientes).toEqual(["20261003080000_incremento_revocacion_sesion"]);
    expect(deps.desconectar).toHaveBeenCalledTimes(2);
  });

  it("DATABASE_URL y SEED_DATABASE_URL apuntan a bases distintas -- DESTINO_INESPERADO, nunca construye clientes", async () => {
    const { orquestarDiagnostico } = await import("../orquestarDiagnostico");
    const deps = depsBase();
    deps.seedDatabaseUrl = "postgresql://neondb_owner:x@host-de-prueba.neon.tech:5432/otra_base?schema=public";
    await expect(orquestarDiagnostico(deps)).rejects.toThrow("DESTINO_INESPERADO");
    expect(deps.construirApp).not.toHaveBeenCalled();
  });

  it("sin ENTORNO_PRUEBA_CONFIRMADO -- ENTORNO_NO_CONFIRMADO, nunca construye clientes", async () => {
    const { orquestarDiagnostico } = await import("../orquestarDiagnostico");
    const deps = depsBase();
    delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
    await expect(orquestarDiagnostico(deps)).rejects.toThrow("ENTORNO_NO_CONFIRMADO");
    expect(deps.construirApp).not.toHaveBeenCalled();
  });

  it("confirmado para un destino distinto del que resuelven las variables -- aborta (deteccion de cambio posterior)", async () => {
    const { orquestarDiagnostico } = await import("../orquestarDiagnostico");
    const deps = depsBase();
    process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado({ ...DESTINO, host: "otro-host-confirmado-antes.neon.tech" });
    await expect(orquestarDiagnostico(deps)).rejects.toThrow("ENTORNO_NO_CONFIRMADO");
  });

  it("la base efectiva que devuelve Postgres no es la esperada -- aborta aunque la URL diga otra cosa, siempre desconecta", async () => {
    const { orquestarDiagnostico } = await import("../orquestarDiagnostico");
    const deps = depsBase();
    deps.construirApp = vi.fn(() => ({
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ usuario_actual: "chainpulse_app", base_actual: "otra_base_real", esquema_actual: "public" }])
        .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
    }));
    await expect(orquestarDiagnostico(deps)).rejects.toThrow("BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA");
    expect(deps.desconectar).toHaveBeenCalledTimes(2);
  });

  it("hay una migracion fallida/inconclusa -- MIGRACIONES_FALLIDAS_O_INCONCLUSAS, nunca solo advierte", async () => {
    const { orquestarDiagnostico } = await import("../orquestarDiagnostico");
    const deps = depsBase();
    deps.construirAdmin = vi.fn(() => ({
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ usuario_actual: "neondb_owner", base_actual: "chainpulse_prueba", esquema_actual: "public" }])
        .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }])
        .mockResolvedValueOnce([{ migration_name: "20260101000000_rota", finished_at: null, rolled_back_at: null }]),
    }));
    await expect(orquestarDiagnostico(deps)).rejects.toThrow("MIGRACIONES_FALLIDAS_O_INCONCLUSAS");
  });

  it("la consulta a _prisma_migrations falla CON UN SECRETO SIMULADO -- codigo fijo, el secreto nunca llega al logger", async () => {
    const { orquestarDiagnostico } = await import("../orquestarDiagnostico");
    const deps = depsBase();
    const secreto = "ContraseñaSecreta123";
    deps.construirAdmin = vi.fn(() => ({
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ usuario_actual: "neondb_owner", base_actual: "chainpulse_prueba", esquema_actual: "public" }])
        .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }])
        .mockRejectedValueOnce(new Error(`fallo -- ${secreto}`)),
    }));
    await expect(orquestarDiagnostico(deps)).rejects.toThrow("ERROR_CONSULTA_MIGRACIONES");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls);
    expect(argumentosRegistrados).not.toContain(secreto);
  });
});
