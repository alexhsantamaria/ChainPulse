// Pruebas — orquestacion de la verificacion de la columna
// "sessionVersion" (Alex, 2026-10-04, punto 4 de la segunda correccion:
// filtrar por esquema y comparar el default por igualdad exacta, no
// "includes").
import { describe, expect, it, vi, beforeEach } from "vitest";
import { destinoConfirmado } from "../destinoPrueba";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
});

const DATABASE_URL = "postgresql://chainpulse_app:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const DESTINO = { host: "host-de-prueba.neon.tech", puerto: "5432", base: "chainpulse_prueba", esquema: "public", usuario: "chainpulse_app" };

function clienteConColumna(fila: unknown) {
  return {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ usuario_actual: "chainpulse_app", base_actual: "chainpulse_prueba", esquema_actual: "public" }])
      .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }])
      .mockResolvedValueOnce(fila ? [fila] : []),
  };
}

function depsBase(fila: unknown) {
  process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado(DESTINO);
  return {
    databaseUrl: DATABASE_URL,
    construirApp: vi.fn(() => clienteConColumna(fila)),
    desconectar: vi.fn().mockResolvedValue(undefined),
  };
}

describe("orquestarVerificarColumna", () => {
  it('columna integer NOT NULL DEFAULT "1" -- resuelve sin lanzar', async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase({ data_type: "integer", column_default: "1", is_nullable: "NO" });
    await expect(orquestarVerificarColumna(deps)).resolves.toMatchObject({ column_default: "1" });
  });

  it("filtra la consulta por table_schema (el esquema resuelto de DATABASE_URL), no solo table_name", async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase({ data_type: "integer", column_default: "1", is_nullable: "NO" });
    await orquestarVerificarColumna(deps);
    const cliente = deps.construirApp.mock.results[0]!.value;
    const llamadaConsulta = cliente.$queryRaw.mock.calls[2]!;
    // tagged-template: el primer argumento son los strings literales, el
    // resto son los valores interpolados -- el esquema esperado debe
    // estar entre ellos.
    expect(llamadaConsulta.slice(1)).toContain(DESTINO.esquema);
  });

  it('default "10" -- NO pasa con ".includes": DEFAULT_INESPERADO (la correccion exige igualdad exacta)', async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase({ data_type: "integer", column_default: "10", is_nullable: "NO" });
    await expect(orquestarVerificarColumna(deps)).rejects.toThrow("DEFAULT_INESPERADO");
  });

  it('default "21" -- tambien contiene "1" como substring, pero igual se rechaza', async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase({ data_type: "integer", column_default: "21", is_nullable: "NO" });
    await expect(orquestarVerificarColumna(deps)).rejects.toThrow("DEFAULT_INESPERADO");
  });

  it("la columna no existe -- COLUMNA_INEXISTENTE", async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase(null);
    await expect(orquestarVerificarColumna(deps)).rejects.toThrow("COLUMNA_INEXISTENTE");
  });

  it("tipo distinto de integer -- TIPO_DE_COLUMNA_INESPERADO", async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase({ data_type: "bigint", column_default: "1", is_nullable: "NO" });
    await expect(orquestarVerificarColumna(deps)).rejects.toThrow("TIPO_DE_COLUMNA_INESPERADO");
  });

  it("nullable -- COLUMNA_NULEABLE_INESPERADA", async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase({ data_type: "integer", column_default: "1", is_nullable: "YES" });
    await expect(orquestarVerificarColumna(deps)).rejects.toThrow("COLUMNA_NULEABLE_INESPERADA");
  });

  it("siempre desconecta, incluso cuando una verificacion aborta", async () => {
    const { orquestarVerificarColumna } = await import("../orquestarVerificarColumna");
    const deps = depsBase(null);
    await expect(orquestarVerificarColumna(deps)).rejects.toThrow();
    expect(deps.desconectar).toHaveBeenCalledTimes(1);
  });
});
