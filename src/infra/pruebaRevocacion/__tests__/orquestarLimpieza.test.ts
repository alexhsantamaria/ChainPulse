// Pruebas — orquestacion de la limpieza de usuarios/empresa de prueba
// (Alex, 2026-10-04, punto 1 y punto 2 de la segunda correccion:
// correspondencia + cascadas DENTRO de la transaccion, borrado por id
// exacto, sin depender de cascada para la empresa). Cliente admin
// 100% inyectado -- ninguna prueba toca Postgres ni el disco real.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { destinoConfirmado } from "../destinoPrueba";
import { emailUsuario, nombreEmpresa, SUFIJOS_USUARIO, type ManifiestoPrueba } from "../manifiesto";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
});

const SEED_DATABASE_URL = "postgresql://neondb_owner:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const DESTINO = { host: "host-de-prueba.neon.tech", puerto: "5432", base: "chainpulse_prueba", esquema: "public", usuario: "neondb_owner" };
const RUN_ID = "run-1";
const RUTA_MANIFIESTO = "/tmp/chainpulse-prueba-revocacion/manifiesto-run-1.json";

function manifiesto(): ManifiestoPrueba {
  return {
    version: 1,
    runId: RUN_ID,
    creadoEn: new Date().toISOString(),
    destino: { host: DESTINO.host, base: DESTINO.base },
    empresaId: "empresa-1",
    usuarios: {
      a1: { id: "usuario-a1", email: emailUsuario(RUN_ID, "a1"), uso: "x" },
      a2: { id: "usuario-a2", email: emailUsuario(RUN_ID, "a2"), uso: "x" },
      a3: { id: "usuario-a3", email: emailUsuario(RUN_ID, "a3"), uso: "x" },
      a4: { id: "usuario-a4", email: emailUsuario(RUN_ID, "a4"), uso: "x" },
    },
  };
}

function txFalso(opciones: { usuariosEnBase?: Array<{ id: string; email: string }>; filasPorModelo?: Record<string, number>; restantesTrasDelete?: number } = {}) {
  const m = manifiesto();
  const usuariosEnBase = opciones.usuariosEnBase ?? [
    { id: m.usuarios.a1.id, email: m.usuarios.a1.email },
    { id: m.usuarios.a2.id, email: m.usuarios.a2.email },
    { id: m.usuarios.a3.id, email: m.usuarios.a3.email },
    { id: m.usuarios.a4.id, email: m.usuarios.a4.email },
  ];
  const filas = opciones.filasPorModelo ?? {};
  const conConteo = (nombre: string) => ({ count: vi.fn().mockResolvedValue(filas[nombre] ?? 0) });
  const restantesTrasDelete = opciones.restantesTrasDelete ?? 0;

  return {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ id: m.empresaId, nombre: nombreEmpresa(RUN_ID) }),
      delete: vi.fn().mockResolvedValue({}),
    },
    usuario: {
      findMany: vi.fn().mockResolvedValue(usuariosEnBase),
      deleteMany: vi.fn().mockResolvedValue({ count: usuariosEnBase.length }),
      count: vi.fn().mockResolvedValue(restantesTrasDelete),
    },
    eslabon: conConteo("eslabon"),
    conexion: conConteo("conexion"),
    cicloPulso: conConteo("cicloPulso"),
    consentimientoCuenta: conConteo("consentimientoCuenta"),
    cadena: conConteo("cadena"),
    nodo: conConteo("nodo"),
    conexionCadena: conConteo("conexionCadena"),
    hallazgoCadena: conConteo("hallazgoCadena"),
    respuestaCadena: conConteo("respuestaCadena"),
    observacionKpi: conConteo("observacionKpi"),
    observacionCobertura: conConteo("observacionCobertura"),
    importacionCsv: conConteo("importacionCsv"),
    respuestaCruda: conConteo("respuestaCruda"),
    metricaCuestionario: conConteo("metricaCuestionario"),
    recomendacionEjecutada: conConteo("recomendacionEjecutada"),
  };
}

function clienteAdminOk(tx: ReturnType<typeof txFalso>) {
  return {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ usuario_actual: "neondb_owner", base_actual: "chainpulse_prueba", esquema_actual: "public" }])
      .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  };
}

function depsBase(m: ManifiestoPrueba = manifiesto(), tx = txFalso()) {
  process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado(DESTINO);
  return {
    seedDatabaseUrl: SEED_DATABASE_URL,
    construirAdmin: vi.fn(() => clienteAdminOk(tx)),
    desconectar: vi.fn().mockResolvedValue(undefined),
    leerManifiesto: vi.fn(() => m),
    borrarManifiesto: vi.fn(() => true),
    _tx: tx,
  };
}

describe("orquestarLimpieza", () => {
  it("borra los 4 usuarios por id exacto y la empresa, y borra el manifiesto -- ok:true", async () => {
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase();
    const resultado = await orquestarLimpieza(RUTA_MANIFIESTO, deps);
    expect(resultado).toMatchObject({ ok: true, cantidadBorrada: 4, manifiestoBorrado: true });
    const idsEsperados = SUFIJOS_USUARIO.map((s) => manifiesto().usuarios[s].id);
    expect(deps._tx.usuario.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: idsEsperados }, empresaId: manifiesto().empresaId },
    });
    expect(deps._tx.empresa.delete).toHaveBeenCalledWith({ where: { id: manifiesto().empresaId } });
  });

  it(
    "pide EXPLICITAMENTE aislamiento Serializable a la transaccion -- no alcanza con 'estar dentro de una " +
      "transaccion' (punto 2 de la tercera correccion)",
    async () => {
      const { orquestarLimpieza } = await import("../orquestarLimpieza");
      const { NIVEL_AISLAMIENTO_SERIALIZABLE } = await import("../eliminarUsuarioProtegido");
      const tx = txFalso();
      const cliente = clienteAdminOk(tx);
      const deps = depsBase(manifiesto(), tx);
      deps.construirAdmin = vi.fn(() => cliente);
      await orquestarLimpieza(RUTA_MANIFIESTO, deps);
      expect(cliente.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: NIVEL_AISLAMIENTO_SERIALIZABLE,
      });
      expect(NIVEL_AISLAMIENTO_SERIALIZABLE).toBe("Serializable");
    },
  );

  it("corre con solo 3 usuarios presentes (A3 ya eliminado por una validacion previa) -- igual limpia, sin exigir los 4", async () => {
    const m = manifiesto();
    const tx = txFalso({ usuariosEnBase: [
      { id: m.usuarios.a1.id, email: m.usuarios.a1.email },
      { id: m.usuarios.a2.id, email: m.usuarios.a2.email },
      { id: m.usuarios.a4.id, email: m.usuarios.a4.email },
    ] });
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase(m, tx);
    const resultado = await orquestarLimpieza(RUTA_MANIFIESTO, deps);
    expect(resultado.ok).toBe(true);
  });

  it("hay un usuario inesperado bajo la empresa -- aborta DENTRO de la transaccion, nunca borra nada, conserva el manifiesto", async () => {
    const m = manifiesto();
    const tx = txFalso({ usuariosEnBase: [
      { id: m.usuarios.a1.id, email: m.usuarios.a1.email },
      { id: "usuario-intruso", email: "alguien@chainpulse.invalid" },
    ] });
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase(m, tx);
    const resultado = await orquestarLimpieza(RUTA_MANIFIESTO, deps);
    expect(resultado).toEqual({ ok: false, motivo: "ERROR_TRANSACCION_LIMPIEZA" });
    expect(tx.usuario.deleteMany).not.toHaveBeenCalled();
    expect(tx.empresa.delete).not.toHaveBeenCalled();
    expect(deps.borrarManifiesto).not.toHaveBeenCalled();
  });

  it("hay datos relacionados inesperados (cascada) bajo la empresa -- aborta DENTRO de la transaccion, antes de borrar nada", async () => {
    const tx = txFalso({ filasPorModelo: { cicloPulso: 1 } });
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase(manifiesto(), tx);
    const resultado = await orquestarLimpieza(RUTA_MANIFIESTO, deps);
    expect(resultado).toEqual({ ok: false, motivo: "ERROR_TRANSACCION_LIMPIEZA" });
    expect(tx.usuario.deleteMany).not.toHaveBeenCalled();
  });

  it("quedan usuarios tras el deleteMany (algo los recreo a mitad de camino) -- NUNCA borra la empresa", async () => {
    const tx = txFalso({ restantesTrasDelete: 1 });
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase(manifiesto(), tx);
    const resultado = await orquestarLimpieza(RUTA_MANIFIESTO, deps);
    expect(resultado).toEqual({ ok: false, motivo: "ERROR_TRANSACCION_LIMPIEZA" });
    expect(tx.empresa.delete).not.toHaveBeenCalled();
  });

  it("la transaccion falla CON UN SECRETO SIMULADO -- codigo fijo, el secreto nunca llega al logger, conserva el manifiesto", async () => {
    const secreto = "ContraseñaSecreta123";
    const tx = txFalso();
    tx.usuario.deleteMany = vi.fn().mockRejectedValue(new Error(`fallo de conexion -- ${secreto}`));
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase(manifiesto(), tx);
    const resultado = await orquestarLimpieza(RUTA_MANIFIESTO, deps);
    expect(resultado).toEqual({ ok: false, motivo: "ERROR_TRANSACCION_LIMPIEZA" });
    expect(deps.borrarManifiesto).not.toHaveBeenCalled();
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls);
    expect(argumentosRegistrados).not.toContain(secreto);
  });

  it("la base efectiva no coincide con la esperada -- aborta sin abrir ninguna transaccion", async () => {
    const tx = txFalso();
    const clienteBaseDistinta = {
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ usuario_actual: "neondb_owner", base_actual: "otra_base_real", esquema_actual: "public" }])
        .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
      $transaction: vi.fn(),
    };
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase(manifiesto(), tx);
    deps.construirAdmin = vi.fn(() => clienteBaseDistinta);
    await expect(orquestarLimpieza(RUTA_MANIFIESTO, deps)).rejects.toThrow("BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA");
    expect(clienteBaseDistinta.$transaction).not.toHaveBeenCalled();
  });

  it("la limpieza de la base funciona pero borrar el archivo del manifiesto falla -- ok:true con manifiestoBorrado:false (nunca se reporta como fallo de la limpieza)", async () => {
    const { orquestarLimpieza } = await import("../orquestarLimpieza");
    const deps = depsBase();
    deps.borrarManifiesto = vi.fn(() => false);
    const resultado = await orquestarLimpieza(RUTA_MANIFIESTO, deps);
    expect(resultado).toMatchObject({ ok: true, manifiestoBorrado: false });
  });
});
