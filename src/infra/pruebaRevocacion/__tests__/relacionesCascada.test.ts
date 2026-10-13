// Pruebas — chequeo de relaciones con CASCADE/SET NULL antes de borrar
// la empresa/usuarios de prueba (Alex, 2026-10-04, punto 1 de la
// segunda correccion). Cliente mockeado a mano -- cada modelo
// consultado via count(), nunca Prisma real.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  MODELOS_CASCADA_USUARIO_FUERA_DE_TENANT,
  MODELOS_TENANT_SIN_USUARIO_NI_EMPRESA,
} from "../relacionesCascada";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

const EMPRESA_ID = "empresa-1";
const IDS_USUARIOS = ["usuario-a1", "usuario-a2", "usuario-a3", "usuario-a4"];

const TODOS_LOS_MODELOS = [
  ...MODELOS_TENANT_SIN_USUARIO_NI_EMPRESA,
  ...MODELOS_CASCADA_USUARIO_FUERA_DE_TENANT.map((m) => m.modelo),
];

function clienteTodoEnCero() {
  const cliente: Record<string, { count: ReturnType<typeof vi.fn> }> = {};
  for (const modelo of TODOS_LOS_MODELOS) {
    cliente[modelo] = { count: vi.fn().mockResolvedValue(0) };
  }
  return cliente;
}

describe("verificarSinDatosRelacionadosInesperados", () => {
  it("todos los modelos relacionados en cero -- no lanza", async () => {
    const { verificarSinDatosRelacionadosInesperados } = await import("../relacionesCascada");
    const cliente = clienteTodoEnCero();
    await expect(
      verificarSinDatosRelacionadosInesperados(cliente, EMPRESA_ID, IDS_USUARIOS, "ctx"),
    ).resolves.toBeUndefined();
  });

  it.each(MODELOS_TENANT_SIN_USUARIO_NI_EMPRESA)(
    "dato inesperado bajo la empresa de prueba en %s (tenant-scoped, cascadearia desde Empresa) -- aborta",
    async (modeloConDatos) => {
      const { verificarSinDatosRelacionadosInesperados } = await import("../relacionesCascada");
      const cliente = clienteTodoEnCero();
      cliente[modeloConDatos]!.count = vi.fn().mockResolvedValue(1);
      await expect(
        verificarSinDatosRelacionadosInesperados(cliente, EMPRESA_ID, IDS_USUARIOS, "ctx"),
      ).rejects.toThrow(`DATOS_RELACIONADOS_INESPERADOS_EN_${modeloConDatos.toUpperCase()}`);
      // la consulta tenant-scoped se hizo por empresaId, no por los ids de usuario
      expect(cliente[modeloConDatos]!.count).toHaveBeenCalledWith({ where: { empresaId: EMPRESA_ID } });
    },
  );

  it.each(MODELOS_CASCADA_USUARIO_FUERA_DE_TENANT)(
    "dato inesperado referenciando a un usuario de prueba via $modelo.$campo (cascade desde Usuario, fuera del tenant-scope) -- aborta",
    async ({ modelo, campo }) => {
      const { verificarSinDatosRelacionadosInesperados } = await import("../relacionesCascada");
      const cliente = clienteTodoEnCero();
      // algunos modelos de esta lista (p. ej. consentimientoCuenta)
      // tambien estan en MODELOS_TENANT_SIN_USUARIO_NI_EMPRESA, chequeado
      // ANTES por empresaId -- el mock responde 1 solo para la consulta
      // por el campo de usuario especifico de este caso, nunca para la
      // de empresaId, asi se prueba este camino en particular sin que
      // el otro chequeo aborte primero.
      cliente[modelo]!.count = vi.fn(
        async (args: { where: Record<string, unknown> }) => (campo in args.where ? 1 : 0),
      );
      await expect(
        verificarSinDatosRelacionadosInesperados(cliente, EMPRESA_ID, IDS_USUARIOS, "ctx"),
      ).rejects.toThrow(`DATOS_RELACIONADOS_INESPERADOS_EN_${modelo.toUpperCase()}`);
      expect(cliente[modelo]!.count).toHaveBeenCalledWith({ where: { [campo]: { in: IDS_USUARIOS } } });
    },
  );

  it(
    "ImportacionCsv.confirmadaPorId referencia a un usuario de prueba AUNQUE la importacion sea de OTRA empresa " +
      "-- aborta igual, nunca deja que el DELETE la deje en SET NULL silencioso (correccion 2026-10-04: la evidencia " +
      "real es importaciones_csv.confirmadaPorId -> usuarios ON DELETE SET NULL)",
    async () => {
      const { verificarSinDatosRelacionadosInesperados } = await import("../relacionesCascada");
      const cliente = clienteTodoEnCero();
      // empresaId de la importacion es OTRA empresa (nunca la de la
      // prueba) -- el chequeo de categoria 1 (por empresaId) no la
      // veria; solo el chequeo de categoria 2 (por confirmadaPorId,
      // sin filtro de empresa) la detecta.
      cliente.importacionCsv!.count = vi.fn(
        async (args: { where: Record<string, unknown> }) =>
          "confirmadaPorId" in args.where ? 1 : 0,
      );
      await expect(
        verificarSinDatosRelacionadosInesperados(cliente, EMPRESA_ID, IDS_USUARIOS, "ctx"),
      ).rejects.toThrow("DATOS_RELACIONADOS_INESPERADOS_EN_IMPORTACIONCSV");
      expect(cliente.importacionCsv!.count).toHaveBeenCalledWith({
        where: { confirmadaPorId: { in: IDS_USUARIOS } },
      });
    },
  );

  it("fallo de consulta CON UN SECRETO SIMULADO en el error -- codigo fijo, el secreto nunca llega al logger", async () => {
    const { verificarSinDatosRelacionadosInesperados } = await import("../relacionesCascada");
    const cliente = clienteTodoEnCero();
    const secreto = "DATABASE_URL=postgresql://chainpulse_app:ContraseñaSecreta123@host/db";
    cliente.eslabon!.count = vi.fn().mockRejectedValue(new Error(`conexion perdida -- ${secreto}`));

    await expect(
      verificarSinDatosRelacionadosInesperados(cliente, EMPRESA_ID, IDS_USUARIOS, "ctx-secreto"),
    ).rejects.toThrow("ERROR_CONSULTA_RELACIONES_CASCADA");
    expect(logErrorMock).toHaveBeenCalledWith("ctx-secreto", "ERROR_CONSULTA_RELACIONES_CASCADA");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls.map((c) => c.join("|")));
    expect(argumentosRegistrados).not.toContain("ContraseñaSecreta123");
    expect(argumentosRegistrados).not.toContain(secreto);
  });
});
