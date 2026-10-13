// Pruebas — orquestacion de aplicar la migracion contra el entorno de
// prueba (Alex, 2026-10-04, punto 2 de la segunda correccion). Clientes,
// lectura de migraciones y el subproceso 100% inyectados.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { destinoConfirmado } from "../destinoPrueba";
import { MIGRACION_ESPERADA } from "../orquestarDiagnostico";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
});

const DATABASE_URL = "postgresql://chainpulse_app:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const SEED_DATABASE_URL = "postgresql://neondb_owner:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const DESTINO = { host: "host-de-prueba.neon.tech", puerto: "5432", base: "chainpulse_prueba", esquema: "public", usuario: "x" };

function clienteOk(rol: string, migraciones: Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>) {
  return {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ usuario_actual: rol, base_actual: "chainpulse_prueba", esquema_actual: "public" }])
      .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }])
      .mockResolvedValueOnce(migraciones),
}
}

function depsBase() {
  process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado(DESTINO);
  return {
    databaseUrl: DATABASE_URL,
    seedDatabaseUrl: SEED_DATABASE_URL,
    autorizoAplicarMigracion: "si" as string | undefined,
    construirApp: vi.fn(() => clienteOk("chainpulse_app", [])),
    construirAdmin: vi.fn(() => clienteOk("neondb_owner", [])),
    desconectar: vi.fn().mockResolvedValue(undefined),
    migracionesEnRepo: vi.fn(() => [MIGRACION_ESPERADA]),
    ejecutarMigrateDeploy: vi.fn(),
  };
}

describe("orquestarAplicarMigracion", () => {
  it("todo en orden -- ejecuta el subproceso de migracion", async () => {
    const { orquestarAplicarMigracion } = await import("../orquestarAplicarMigracion");
    const deps = depsBase();
    await orquestarAplicarMigracion(deps);
    expect(deps.ejecutarMigrateDeploy).toHaveBeenCalledTimes(1);
    expect(deps.desconectar).toHaveBeenCalledTimes(2);
  });

  it('falta AUTORIZO_APLICAR_MIGRACION_PRUEBA="si" -- aborta ANTES de ejecutar el subproceso, aunque todo lo demas este OK', async () => {
    const { orquestarAplicarMigracion } = await import("../orquestarAplicarMigracion");
    const deps = depsBase();
    deps.autorizoAplicarMigracion = undefined;
    await expect(orquestarAplicarMigracion(deps)).rejects.toThrow("AUTORIZACION_DE_MIGRACION_FALTANTE");
    expect(deps.ejecutarMigrateDeploy).not.toHaveBeenCalled();
  });

  it('ENTORNO_PRUEBA_CONFIRMADO="si" suelto (formato viejo) ya no alcanza -- aborta, nunca ejecuta el subproceso', async () => {
    const { orquestarAplicarMigracion } = await import("../orquestarAplicarMigracion");
    const deps = depsBase();
    process.env.ENTORNO_PRUEBA_CONFIRMADO = "si";
    await expect(orquestarAplicarMigracion(deps)).rejects.toThrow("ENTORNO_NO_CONFIRMADO");
    expect(deps.ejecutarMigrateDeploy).not.toHaveBeenCalled();
  });

  it("hay mas de una migracion pendiente -- MIGRACIONES_PENDIENTES_INESPERADAS, nunca ejecuta el subproceso", async () => {
    const { orquestarAplicarMigracion } = await import("../orquestarAplicarMigracion");
    const deps = depsBase();
    deps.migracionesEnRepo = vi.fn(() => [MIGRACION_ESPERADA, "20261005000000_otra_sin_autorizar"]);
    await expect(orquestarAplicarMigracion(deps)).rejects.toThrow("MIGRACIONES_PENDIENTES_INESPERADAS");
    expect(deps.ejecutarMigrateDeploy).not.toHaveBeenCalled();
  });

  it("hay una migracion fallida/inconclusa -- aborta, nunca ejecuta el subproceso", async () => {
    const { orquestarAplicarMigracion } = await import("../orquestarAplicarMigracion");
    const deps = depsBase();
    deps.construirAdmin = vi.fn(() => clienteOk("neondb_owner", [{ migration_name: "m_rota", finished_at: null, rolled_back_at: null }]));
    await expect(orquestarAplicarMigracion(deps)).rejects.toThrow("MIGRACIONES_FALLIDAS_O_INCONCLUSAS");
    expect(deps.ejecutarMigrateDeploy).not.toHaveBeenCalled();
  });

  it("la base efectiva no coincide con la esperada -- aborta antes de ejecutar el subproceso", async () => {
    const { orquestarAplicarMigracion } = await import("../orquestarAplicarMigracion");
    const deps = depsBase();
    deps.construirApp = vi.fn(() => ({
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ usuario_actual: "chainpulse_app", base_actual: "otra_base_real", esquema_actual: "public" }])
        .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
    }));
    await expect(orquestarAplicarMigracion(deps)).rejects.toThrow("BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA");
    expect(deps.ejecutarMigrateDeploy).not.toHaveBeenCalled();
  });
});
