// Pruebas — orquestacion de la validacion de revocacion contra el
// entorno de prueba (Alex, 2026-10-04, punto 2 y punto 5 de la segunda
// correccion, punto 2 de la tercera correccion, y correccion de rol en
// la cuarta: Escenario C ahora usa eliminarUsuarioConProteccionConcurrente()
// SIEMPRE sobre la conexion ADMIN (neondb_owner, dueña de las tablas,
// exenta de RLS) -- nunca la conexion app (chainpulse_app, sujeta a
// RLS), que es justamente el bug que la revision de la version d
// encontro: ver la PARTE 1 del comentario de cabecera de
// eliminarUsuarioProtegido.ts.
// tenantClient()/verificarSesionVigente()/leerSessionVersionParaLogin()
// mockeados a nivel de modulo -- mismo criterio que
// src/infra/auth/__tests__/sessionVerification.test.ts.
// eliminarUsuarioConProteccionConcurrente() es la funcion REAL (no
// mockeada) -- por eso clienteAdminRolOk() ahora tambien provee un
// $transaction con un tx falso que cubre los modelos de cascada, igual
// que sus propias pruebas unitarias.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { destinoConfirmado } from "../destinoPrueba";
import { emailUsuario, type ManifiestoPrueba } from "../manifiesto";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

const tenantClientMock = vi.fn();
vi.mock("../../prisma/tenantClient", () => ({ tenantClient: (...args: unknown[]) => tenantClientMock(...args) }));

const verificarSesionVigenteMock = vi.fn();
const leerSessionVersionParaLoginMock = vi.fn();
vi.mock("../../auth/sessionVerification", () => ({
  verificarSesionVigente: (...args: unknown[]) => verificarSesionVigenteMock(...args),
  leerSessionVersionParaLogin: (...args: unknown[]) => leerSessionVersionParaLoginMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
});

const DATABASE_URL = "postgresql://chainpulse_app:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const SEED_DATABASE_URL = "postgresql://neondb_owner:x@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public";
const DESTINO = { host: "host-de-prueba.neon.tech", puerto: "5432", base: "chainpulse_prueba", esquema: "public", usuario: "chainpulse_app" };
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

const MODELOS_CASCADA = [
  "eslabon",
  "conexion",
  "cicloPulso",
  "consentimientoCuenta",
  "cadena",
  "nodo",
  "conexionCadena",
  "hallazgoCadena",
  "respuestaCadena",
  "observacionKpi",
  "observacionCobertura",
  "importacionCsv",
  "respuestaCruda",
  "metricaCuestionario",
  "recomendacionEjecutada",
];

// tx falso para la transaccion EXPLICITA de eliminarUsuarioConProteccion
// Concurrente() (nunca clienteTenant()) -- cubre los mismos modelos que
// relacionesCascada.ts recorre, todos en cero salvo que una prueba pida
// lo contrario via filasPorModelo.
function txEscenarioC(opciones: { filasPorModelo?: Record<string, number>; deleteCount?: number } = {}) {
  const filas = opciones.filasPorModelo ?? {};
  const conConteo = (nombre: string) => ({ count: vi.fn().mockResolvedValue(filas[nombre] ?? 0) });
  const tx: Record<string, unknown> = {
    usuario: { deleteMany: vi.fn().mockResolvedValue({ count: opciones.deleteCount ?? 1 }) },
  };
  for (const modelo of MODELOS_CASCADA) {
    tx[modelo] = conConteo(modelo);
  }
  return tx;
}

// Conexion APP -- solo se usa para el chequeo de rol (ya no queda
// abierta para ninguna transaccion, ver la correccion de cabecera de
// orquestarValidacion.ts). Nunca necesita $transaction.
function clienteAppRolOk() {
  return {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ usuario_actual: "chainpulse_app", base_actual: "chainpulse_prueba", esquema_actual: "public" }])
      .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
  };
}

// Conexion ADMIN -- la unica que Escenario C usa para eliminarUsuarioCon
// ProteccionConcurrente(), por eso lleva el tx de cascadas.
function clienteAdminRolOk(tx: ReturnType<typeof txEscenarioC> = txEscenarioC()) {
  return {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ usuario_actual: "neondb_owner", base_actual: "chainpulse_prueba", esquema_actual: "public" }])
      .mockResolvedValueOnce([{ rolbypassrls: false, rolsuper: false }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>, _opciones?: unknown) => {
      await fn(tx);
    }),
  };
}

function tenantClienteFalso(filasPorModelo: Record<string, number> = {}) {
  const usuariosEnBase = [
    { id: "usuario-a1", email: emailUsuario(RUN_ID, "a1") },
    { id: "usuario-a2", email: emailUsuario(RUN_ID, "a2") },
    { id: "usuario-a3", email: emailUsuario(RUN_ID, "a3") },
    { id: "usuario-a4", email: emailUsuario(RUN_ID, "a4") },
  ];
  const modelosConConteo = (nombre: string) => ({ count: vi.fn().mockResolvedValue(filasPorModelo[nombre] ?? 0) });
  return {
    empresa: { findUnique: vi.fn().mockResolvedValue({ id: "empresa-1", nombre: `ZZ_PRUEBA_REVOCACION_AISLADA_${RUN_ID}` }) },
    usuario: {
      findMany: vi.fn().mockResolvedValue(usuariosEnBase),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    eslabon: modelosConConteo("eslabon"),
    conexion: modelosConConteo("conexion"),
    cicloPulso: modelosConConteo("cicloPulso"),
    consentimientoCuenta: modelosConConteo("consentimientoCuenta"),
    cadena: modelosConConteo("cadena"),
    nodo: modelosConConteo("nodo"),
    conexionCadena: modelosConConteo("conexionCadena"),
    hallazgoCadena: modelosConConteo("hallazgoCadena"),
    respuestaCadena: modelosConConteo("respuestaCadena"),
    observacionKpi: modelosConConteo("observacionKpi"),
    observacionCobertura: modelosConConteo("observacionCobertura"),
    importacionCsv: modelosConConteo("importacionCsv"),
    respuestaCruda: modelosConConteo("respuestaCruda"),
    metricaCuestionario: modelosConConteo("metricaCuestionario"),
    recomendacionEjecutada: modelosConConteo("recomendacionEjecutada"),
  };
}

function depsBase(
  m: ManifiestoPrueba = manifiesto(),
  clienteApp: ReturnType<typeof clienteAppRolOk> = clienteAppRolOk(),
  clienteAdmin: ReturnType<typeof clienteAdminRolOk> = clienteAdminRolOk(),
) {
  process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado(DESTINO);
  return {
    databaseUrl: DATABASE_URL,
    seedDatabaseUrl: SEED_DATABASE_URL,
    construirApp: vi.fn(() => clienteApp),
    construirAdmin: vi.fn(() => clienteAdmin),
    desconectarApp: vi.fn().mockResolvedValue(undefined),
    desconectarAdmin: vi.fn().mockResolvedValue(undefined),
    leerManifiesto: vi.fn(() => m),
  };
}

// Respuestas por defecto: todo revoca/aisla correctamente.
function configurarSessionVerificationFeliz() {
  leerSessionVersionParaLoginMock.mockResolvedValue(1);
  verificarSesionVigenteMock.mockImplementation(async (_id: string, _empresaId: string, claim: number | undefined) => {
    if (claim === 1) return { vigente: true };
    if (claim === undefined) return { vigente: true };
    return { vigente: true };
  });
}

describe("orquestarValidacion", () => {
  it("corre los 5 escenarios (7 comprobaciones) cuando todo sale como se espera", async () => {
    tenantClientMock.mockReturnValue(tenantClienteFalso());
    configurarSessionVerificationFeliz();
    // post-mutacion: A1 revocado, A3 eliminado, A4 revocado
    verificarSesionVigenteMock
      .mockResolvedValueOnce({ vigente: true }) // A1 precondicion
      .mockResolvedValueOnce({ vigente: false, motivo: "REVOCADA" }) // A1 post-B
      .mockResolvedValueOnce({ vigente: false, motivo: "ELIMINADA" }) // A3 post-C
      .mockResolvedValueOnce({ vigente: true }) // A4 precondicion D
      .mockResolvedValueOnce({ vigente: false, motivo: "REVOCADA" }) // A4 post-D
      .mockResolvedValueOnce({ vigente: true }); // A2 aislamiento
    const { orquestarValidacion } = await import("../orquestarValidacion");
    const { NIVEL_AISLAMIENTO_SERIALIZABLE } = await import("../eliminarUsuarioProtegido");
    const clienteApp = clienteAppRolOk();
    const clienteAdmin = clienteAdminRolOk();
    const deps = depsBase(manifiesto(), clienteApp, clienteAdmin);
    const resultado = await orquestarValidacion(RUTA_MANIFIESTO, deps);
    expect(resultado.comprobaciones).toHaveLength(7);
    expect(resultado.comprobaciones.every((c) => c.paso)).toBe(true);
    // Escenario C: UNA transaccion explicita SERIALIZABLE sobre
    // prismaAdmin -- NUNCA sobre prismaApp (que ni siquiera expone
    // $transaction en esta version).
    expect(clienteAdmin.$transaction).toHaveBeenCalledTimes(1);
    const [, opcionesTransaccion] = clienteAdmin.$transaction.mock.calls[0]!;
    expect(opcionesTransaccion).toEqual({ isolationLevel: NIVEL_AISLAMIENTO_SERIALIZABLE });
    // prismaApp se desconecta apenas termina su propio chequeo de rol
    // (ya no se reutiliza para nada mas); prismaAdmin se desconecta al
    // final (finally), una sola vez cada uno.
    expect(deps.desconectarApp).toHaveBeenCalledTimes(1);
    expect(deps.desconectarApp).toHaveBeenCalledWith(clienteApp);
    expect(deps.desconectarAdmin).toHaveBeenCalledTimes(1);
    expect(deps.desconectarAdmin).toHaveBeenCalledWith(clienteAdmin);
  });

  it(
    "DATABASE_URL y SEED_DATABASE_URL apuntan a destinos distintos -- DESTINO_INESPERADO, nunca lee el " +
      "manifiesto ni construye ninguna conexion",
    async () => {
      const { orquestarValidacion } = await import("../orquestarValidacion");
      const deps = depsBase();
      deps.seedDatabaseUrl = "postgresql://neondb_owner:x@host-de-prueba.neon.tech:5432/otra_base?schema=public";
      await expect(orquestarValidacion(RUTA_MANIFIESTO, deps)).rejects.toThrow("DESTINO_INESPERADO");
      expect(deps.leerManifiesto).not.toHaveBeenCalled();
      expect(deps.construirApp).not.toHaveBeenCalled();
      expect(deps.construirAdmin).not.toHaveBeenCalled();
    },
  );

  it("falta A3 al EMPEZAR (ya eliminado por una corrida previa) -- aborta antes de cualquier escenario/mutacion", async () => {
    const m = manifiesto();
    const cliente = tenantClienteFalso();
    cliente.usuario.findMany = vi.fn().mockResolvedValue([
      { id: m.usuarios.a1.id, email: m.usuarios.a1.email },
      { id: m.usuarios.a2.id, email: m.usuarios.a2.email },
      { id: m.usuarios.a4.id, email: m.usuarios.a4.email },
    ]);
    tenantClientMock.mockReturnValue(cliente);
    configurarSessionVerificationFeliz();
    const { orquestarValidacion } = await import("../orquestarValidacion");
    const deps = depsBase(m);
    await expect(orquestarValidacion(RUTA_MANIFIESTO, deps)).rejects.toThrow("USUARIOS_FALTANTES_AL_INICIAR_VALIDACION");
    expect(cliente.usuario.update).not.toHaveBeenCalled();
    expect(cliente.usuario.delete).not.toHaveBeenCalled();
  });

  it("la precondicion del Escenario A falla (A1 no tiene sessionVersion=1 real) -- aborta ANTES de mutar A1 en el Escenario B", async () => {
    tenantClientMock.mockReturnValue(tenantClienteFalso());
    leerSessionVersionParaLoginMock.mockResolvedValue(5); // inesperado
    verificarSesionVigenteMock.mockResolvedValue({ vigente: true });
    const { orquestarValidacion } = await import("../orquestarValidacion");
    const deps = depsBase();
    const cliente = tenantClientMock();
    await expect(orquestarValidacion(RUTA_MANIFIESTO, deps)).rejects.toThrow("PRECONDICION_ESCENARIO_A_FALLO");
    expect(cliente.usuario.update).not.toHaveBeenCalled();
  });

  it("la precondicion del Escenario D falla (A4 no esta vigente con claim=undefined) -- aborta ANTES de mutar A4, " +
    "pero A1 ya mutado en B no se revierte (no hay como, cada escenario es independiente); A3 SI se elimino en C " +
    "(sobre la conexion admin)", async () => {
    const cliente = tenantClienteFalso();
    tenantClientMock.mockReturnValue(cliente);
    leerSessionVersionParaLoginMock.mockResolvedValue(1);
    verificarSesionVigenteMock
      .mockResolvedValueOnce({ vigente: true }) // A1 precondicion
      .mockResolvedValueOnce({ vigente: false, motivo: "REVOCADA" }) // A1 post-B
      .mockResolvedValueOnce({ vigente: false, motivo: "ELIMINADA" }) // A3 post-C
      .mockResolvedValueOnce({ vigente: false }); // A4 precondicion D -- FALLA
    const { orquestarValidacion } = await import("../orquestarValidacion");
    const txC = txEscenarioC();
    const clienteAdmin = clienteAdminRolOk(txC);
    const deps = depsBase(manifiesto(), clienteAppRolOk(), clienteAdmin);
    await expect(orquestarValidacion(RUTA_MANIFIESTO, deps)).rejects.toThrow("PRECONDICION_ESCENARIO_D_FALLO");
    expect(cliente.usuario.update).toHaveBeenCalledTimes(1); // solo la de A1 (Escenario B), nunca la de A4
    expect((txC.usuario as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany).toHaveBeenCalledTimes(1); // A3 SI se borro, en C
    // prismaAdmin se desconecta igual, aunque D haya abortado (finally).
    expect(deps.desconectarAdmin).toHaveBeenCalledWith(clienteAdmin);
  });

  it("hay datos relacionados inesperados referenciando a A3 -- aborta DENTRO de la transaccion explicita (sobre la " +
    "conexion admin), antes de borrarlo (punto 1 y punto 2)", async () => {
    const cliente = tenantClienteFalso();
    tenantClientMock.mockReturnValue(cliente);
    configurarSessionVerificationFeliz();
    verificarSesionVigenteMock
      .mockResolvedValueOnce({ vigente: true })
      .mockResolvedValueOnce({ vigente: false, motivo: "REVOCADA" });
    const txC = txEscenarioC({ filasPorModelo: { respuestaCruda: 1 } });
    const clienteAdmin = clienteAdminRolOk(txC);
    const { orquestarValidacion } = await import("../orquestarValidacion");
    const deps = depsBase(manifiesto(), clienteAppRolOk(), clienteAdmin);
    // Colapsado en UN codigo fijo (igual criterio que ERROR_TRANSACCION_
    // LIMPIEZA): ya no se distingue aca cual modelo tenia la referencia.
    await expect(orquestarValidacion(RUTA_MANIFIESTO, deps)).rejects.toThrow("ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");
    expect((txC.usuario as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany).not.toHaveBeenCalled();
    expect(cliente.usuario.delete).not.toHaveBeenCalled();
  });

  it("sin ENTORNO_PRUEBA_CONFIRMADO -- aborta antes de leer el manifiesto o construir cualquier cliente", async () => {
    const { orquestarValidacion } = await import("../orquestarValidacion");
    const deps = depsBase();
    delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
    await expect(orquestarValidacion(RUTA_MANIFIESTO, deps)).rejects.toThrow("ENTORNO_NO_CONFIRMADO");
    expect(deps.leerManifiesto).not.toHaveBeenCalled();
  });
});
