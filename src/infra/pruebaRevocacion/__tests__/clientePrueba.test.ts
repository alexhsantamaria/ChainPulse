// Pruebas — construccion/desconexion de clientes de prueba (Alex,
// 2026-10-04, punto 2 de la segunda correccion). "@prisma/client" y
// "@prisma/adapter-pg" mockeados para poder forzar un fallo de
// construccion sin abrir ninguna conexion real.
import { describe, expect, it, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

const PrismaClientMock = vi.fn();
vi.mock("@prisma/client", () => ({ PrismaClient: PrismaClientMock }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("construirClientePrueba", () => {
  it("construye el cliente -- nunca expone la cadena de conexion en el resultado", async () => {
    const instanciaFalsa = { $disconnect: vi.fn() };
    PrismaClientMock.mockReturnValue(instanciaFalsa);
    const { construirClientePrueba } = await import("../clientePrueba");
    const cliente = construirClientePrueba("postgresql://usuario:secreto@host/db", "ctx");
    expect(cliente).toBe(instanciaFalsa);
  });

  it("la construccion falla CON UN SECRETO SIMULADO en el error -- codigo fijo, el secreto nunca llega al logger", async () => {
    const secreto = "postgresql://chainpulse_app:ContraseñaSecreta123@host/db";
    PrismaClientMock.mockImplementation(() => {
      throw new Error(`fallo construyendo el adaptador -- ${secreto}`);
    });
    const { construirClientePrueba } = await import("../clientePrueba");
    expect(() => construirClientePrueba(secreto, "ctx-secreto")).toThrow("ERROR_CONSTRUCCION_CLIENTE");
    expect(logErrorMock).toHaveBeenCalledWith("ctx-secreto", "ERROR_CONSTRUCCION_CLIENTE");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain("ContraseñaSecreta123");
  });
});

describe("desconectarClientePrueba", () => {
  it("desconecta sin problemas -- no lanza", async () => {
    const { desconectarClientePrueba } = await import("../clientePrueba");
    const cliente = { $disconnect: vi.fn().mockResolvedValue(undefined) };
    await expect(desconectarClientePrueba(cliente, "ctx")).resolves.toBeUndefined();
  });

  it("la desconexion falla CON UN SECRETO SIMULADO -- nunca lanza (best-effort), codigo fijo, secreto no llega al logger", async () => {
    const secreto = "ContraseñaSecreta123";
    const cliente = { $disconnect: vi.fn().mockRejectedValue(new Error(`fallo de red -- ${secreto}`)) };
    const { desconectarClientePrueba } = await import("../clientePrueba");
    await expect(desconectarClientePrueba(cliente, "ctx-secreto")).resolves.toBeUndefined();
    expect(logErrorMock).toHaveBeenCalledWith("ctx-secreto", "ERROR_DESCONEXION_CLIENTE");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain(secreto);
  });
});
