// Pruebas — correspondencia del manifiesto contra la base (Alex,
// 2026-10-04, punto 4, segunda mitad). Cliente mockeado a mano (no
// Prisma real) -- $queryRaw no hace falta aca, solo
// empresa.findUnique/usuario.findMany.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { nombreEmpresa, emailUsuario, type ManifiestoPrueba } from "../manifiesto";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

const RUN_ID = "run-1";
const DESTINO = { host: "host-de-prueba.neon.tech", base: "chainpulse_prueba" };

function manifiesto(): ManifiestoPrueba {
  return {
    version: 1,
    runId: RUN_ID,
    creadoEn: new Date().toISOString(),
    destino: DESTINO,
    empresaId: "empresa-1",
    usuarios: {
      a1: { id: "usuario-a1", email: emailUsuario(RUN_ID, "a1"), uso: "x" },
      a2: { id: "usuario-a2", email: emailUsuario(RUN_ID, "a2"), uso: "x" },
      a3: { id: "usuario-a3", email: emailUsuario(RUN_ID, "a3"), uso: "x" },
      a4: { id: "usuario-a4", email: emailUsuario(RUN_ID, "a4"), uso: "x" },
    },
  };
}

function clienteMock(empresa: { id: string; nombre: string } | null, usuarios: Array<{ id: string; email: string }>) {
  return {
    empresa: { findUnique: vi.fn().mockResolvedValue(empresa) },
    usuario: { findMany: vi.fn().mockResolvedValue(usuarios) },
  };
}

describe("verificarCorrespondenciaManifiesto", () => {
  it("todo corresponde (empresa + 4 usuarios, mismo destino) -- pasa", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const cliente = clienteMock(
      { id: m.empresaId, nombre: nombreEmpresa(RUN_ID) },
      [m.usuarios.a1, m.usuarios.a2, m.usuarios.a3, m.usuarios.a4],
    );

    const resultado = await verificarCorrespondenciaManifiesto(cliente, m, DESTINO, "ctx");
    expect(resultado.empresaId).toBe(m.empresaId);
  });

  it("corre con un usuario ya eliminado (A3, escenario C ya ejecutado) -- sigue pasando con los 3 restantes", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const cliente = clienteMock({ id: m.empresaId, nombre: nombreEmpresa(RUN_ID) }, [
      m.usuarios.a1,
      m.usuarios.a2,
      m.usuarios.a4,
    ]);

    await expect(verificarCorrespondenciaManifiesto(cliente, m, DESTINO, "ctx")).resolves.toBeTruthy();
  });

  it("destino actual distinto del registrado en el manifiesto -- MANIFIESTO_DESTINO_DISTINTO, nunca consulta la base", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const cliente = clienteMock({ id: m.empresaId, nombre: nombreEmpresa(RUN_ID) }, []);

    await expect(
      verificarCorrespondenciaManifiesto(cliente, m, { host: "otro-host", base: "otra-base" }, "ctx"),
    ).rejects.toThrow("MANIFIESTO_DESTINO_DISTINTO");
    expect(cliente.empresa.findUnique).not.toHaveBeenCalled();
  });

  it("la empresa no existe -- EMPRESA_NO_CORRESPONDE", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const cliente = clienteMock(null, []);

    await expect(verificarCorrespondenciaManifiesto(cliente, m, DESTINO, "ctx")).rejects.toThrow(
      "EMPRESA_NO_CORRESPONDE",
    );
  });

  it("la empresa existe pero con otro nombre (otra corrida, mismo id por coincidencia) -- EMPRESA_NO_CORRESPONDE", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const cliente = clienteMock({ id: m.empresaId, nombre: "otra empresa cualquiera" }, []);

    await expect(verificarCorrespondenciaManifiesto(cliente, m, DESTINO, "ctx")).rejects.toThrow(
      "EMPRESA_NO_CORRESPONDE",
    );
  });

  it("hay un usuario bajo esa empresa que NO esta en el manifiesto -- USUARIO_INESPERADO_EN_EMPRESA_DE_PRUEBA, aborta", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const cliente = clienteMock({ id: m.empresaId, nombre: nombreEmpresa(RUN_ID) }, [
      m.usuarios.a1,
      m.usuarios.a2,
      m.usuarios.a3,
      m.usuarios.a4,
      { id: "usuario-intruso", email: "alguien@chainpulse.invalid" },
    ]);

    await expect(verificarCorrespondenciaManifiesto(cliente, m, DESTINO, "ctx")).rejects.toThrow(
      "USUARIO_INESPERADO_EN_EMPRESA_DE_PRUEBA",
    );
  });

  it("un id del manifiesto existe pero con un email distinto (id reciclado) -- USUARIO_NO_CORRESPONDE", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const cliente = clienteMock({ id: m.empresaId, nombre: nombreEmpresa(RUN_ID) }, [
      { id: m.usuarios.a1.id, email: "no-es-el-email-esperado@chainpulse.invalid" },
    ]);

    await expect(verificarCorrespondenciaManifiesto(cliente, m, DESTINO, "ctx")).rejects.toThrow(
      "USUARIO_NO_CORRESPONDE",
    );
  });

  it("fallo de consulta CON UN SECRETO SIMULADO en el error -- codigo fijo, el secreto nunca llega al logger", async () => {
    const { verificarCorrespondenciaManifiesto } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const secreto = "apiKey=sk_live_abcXYZsecreto";
    const cliente = {
      empresa: { findUnique: vi.fn().mockRejectedValue(new Error(`fallo de conexion -- ${secreto}`)) },
      usuario: { findMany: vi.fn() },
    };

    await expect(verificarCorrespondenciaManifiesto(cliente, m, DESTINO, "ctx-secreto")).rejects.toThrow(
      "ERROR_CONSULTA_CORRESPONDENCIA",
    );
    expect(logErrorMock).toHaveBeenCalledWith("ctx-secreto", "ERROR_CONSULTA_CORRESPONDENCIA");
    expect(JSON.stringify(logErrorMock.mock.calls[0])).not.toContain("sk_live_");
  });
});

describe("verificarTodosPresentes", () => {
  it("los 4 usuarios del manifiesto estan en la base -- no lanza", async () => {
    const { verificarTodosPresentes } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const resultado = {
      empresaId: m.empresaId,
      usuariosEnBase: [m.usuarios.a1, m.usuarios.a2, m.usuarios.a3, m.usuarios.a4],
    };
    expect(() => verificarTodosPresentes(resultado, m, "ctx")).not.toThrow();
  });

  it("falta A3 (por ejemplo, limpieza corrida sobre un manifiesto de una validacion ya ejecutada) -- " +
    "USUARIOS_FALTANTES_AL_INICIAR_VALIDACION (esto es lo que el VALIDADOR debe exigir al empezar)", async () => {
    const { verificarTodosPresentes } = await import("../correspondenciaManifiesto");
    const m = manifiesto();
    const resultado = { empresaId: m.empresaId, usuariosEnBase: [m.usuarios.a1, m.usuarios.a2, m.usuarios.a4] };
    expect(() => verificarTodosPresentes(resultado, m, "ctx")).toThrow("USUARIOS_FALTANTES_AL_INICIAR_VALIDACION");
  });
});
