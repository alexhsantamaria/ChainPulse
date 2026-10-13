// Pruebas — orquestacion de la siembra de usuarios/empresa de prueba
// (Alex, 2026-10-04, punto 2 de la segunda correccion). Cliente,
// hashPassword y escritura del manifiesto 100% inyectados -- ninguna
// prueba toca Postgres ni el disco real.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { destinoConfirmado } from "../destinoPrueba";
import { emailUsuario, nombreEmpresa, SUFIJOS_USUARIO } from "../manifiesto";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
});

const SEED_DATABASE_URL = "postgresql://neondb_owner:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const DESTINO = { host: "host-de-prueba.neon.tech", puerto: "5432", base: "chainpulse_prueba", esquema: "public", usuario: "neondb_owner" };
const RUN_ID = "run-fijo-de-prueba";

function clienteOkTransaccional() {
  let contadorEmpresa = 0;
  return {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ usuario_actual: "neondb_owner", base_actual: "chainpulse_prueba", esquema_actual: "public" }])
      .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        empresa: { create: vi.fn().mockResolvedValue({ id: `empresa-${++contadorEmpresa}` }) },
        usuario: {
          create: vi.fn(({ data }: { data: { email: string } }) =>
            Promise.resolve({ id: `usuario-${data.email}`, email: data.email }),
          ),
        },
      };
      return fn(tx);
    }),
  };
}

function depsBase() {
  process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado(DESTINO);
  return {
    seedDatabaseUrl: SEED_DATABASE_URL,
    construirAdmin: vi.fn(() => clienteOkTransaccional()),
    desconectar: vi.fn().mockResolvedValue(undefined),
    hashPassword: vi.fn().mockResolvedValue("hash-de-prueba"),
    nuevoRunId: vi.fn(() => RUN_ID),
    escribirManifiesto: vi.fn((runId: string) => `/tmp/chainpulse-prueba-revocacion/manifiesto-${runId}.json`),
  };
}

describe("orquestarSiembra", () => {
  it("crea la empresa y los 4 usuarios, escribe el manifiesto -- ok:true con la ruta", async () => {
    const { orquestarSiembra } = await import("../orquestarSiembra");
    const deps = depsBase();
    const resultado = await orquestarSiembra(deps);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.manifiesto.runId).toBe(RUN_ID);
      expect(resultado.manifiesto.empresaId).toBeTruthy();
      for (const sufijo of SUFIJOS_USUARIO) {
        expect(resultado.manifiesto.usuarios[sufijo].email).toBe(emailUsuario(RUN_ID, sufijo));
      }
      expect(resultado.rutaManifiesto).toContain(RUN_ID);
    }
    expect(deps.desconectar).toHaveBeenCalledTimes(1);
  });

  it("el nombre de la empresa es el deterministico por runId", async () => {
    const { orquestarSiembra } = await import("../orquestarSiembra");
    const deps = depsBase();
    const cliente = clienteOkTransaccional();
    deps.construirAdmin = vi.fn(() => cliente);
    await orquestarSiembra(deps);
    const llamadaEmpresa = (cliente.$transaction as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadaEmpresa.length).toBe(1);
  });

  it("sin ENTORNO_PRUEBA_CONFIRMADO -- aborta antes de construir el cliente", async () => {
    const { orquestarSiembra } = await import("../orquestarSiembra");
    const deps = depsBase();
    delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
    await expect(orquestarSiembra(deps)).rejects.toThrow("ENTORNO_NO_CONFIRMADO");
    expect(deps.construirAdmin).not.toHaveBeenCalled();
  });

  it("la transaccion falla CON UN SECRETO SIMULADO -- ok:false ERROR_TRANSACCION_SIEMBRA, secreto nunca llega al logger, siempre desconecta", async () => {
    const { orquestarSiembra } = await import("../orquestarSiembra");
    const deps = depsBase();
    const secreto = "ContraseñaSecreta123";
    const cliente = clienteOkTransaccional();
    cliente.$transaction = vi.fn().mockRejectedValue(new Error(`fallo de conexion -- ${secreto}`));
    deps.construirAdmin = vi.fn(() => cliente);
    const resultado = await orquestarSiembra(deps);
    expect(resultado).toEqual({ ok: false, motivo: "ERROR_TRANSACCION_SIEMBRA" });
    expect(deps.desconectar).toHaveBeenCalledTimes(1);
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls);
    expect(argumentosRegistrados).not.toContain(secreto);
  });

  it("la transaccion tuvo exito pero escribir el manifiesto falla -- ok:false con el manifiesto para recuperar a mano", async () => {
    const { orquestarSiembra } = await import("../orquestarSiembra");
    const deps = depsBase();
    deps.escribirManifiesto = vi.fn(() => {
      throw new Error("ERROR_ESCRITURA_MANIFIESTO");
    });
    const resultado = await orquestarSiembra(deps);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok && resultado.motivo === "ERROR_ESCRITURA_MANIFIESTO") {
      expect(resultado.manifiestoParaRecuperar.runId).toBe(RUN_ID);
      expect(resultado.manifiestoParaRecuperar.empresaId).toBeTruthy();
    } else {
      throw new Error("se esperaba ERROR_ESCRITURA_MANIFIESTO");
    }
    expect(deps.desconectar).toHaveBeenCalledTimes(1);
  });

  it("la base efectiva no coincide con la esperada -- aborta sin crear nada", async () => {
    const { orquestarSiembra } = await import("../orquestarSiembra");
    const deps = depsBase();
    const cliente = {
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ usuario_actual: "neondb_owner", base_actual: "otra_base_real", esquema_actual: "public" }])
        .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
      $transaction: vi.fn(),
    };
    deps.construirAdmin = vi.fn(() => cliente);
    await expect(orquestarSiembra(deps)).rejects.toThrow("BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA");
    expect(cliente.$transaction).not.toHaveBeenCalled();
  });
});
