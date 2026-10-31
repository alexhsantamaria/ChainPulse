// Pruebas focalizadas (ronda 3 de revision, Alex) -- primera prueba de
// un script bajo scripts/ en este repo. Solo prueba
// restablecerMfaPlataformaTransaccion() (la transaccion atomica,
// extraida de main() para que sea invocable con un cliente falso) y la
// consecuencia observable en requireSesionPlataforma() -- nunca ejecuta
// main() completo, que exige variables de entorno reales, confirmacion
// de destino y una conexion Postgres real (fuera de alcance de una
// prueba unitaria, y expresamente prohibido: "No ejecutes... ni
// restablecimiento MFA... ni conexiones a Neon").
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClienteRestablecimientoMfa,
  ConteoInesperadoError,
  restablecerMfaPlataformaTransaccion,
} from "../restablecer-mfa-plataforma-mantenimiento";

// @/infra/auth/sessionPlataforma importa el singleton real de Prisma
// (@/infra/prisma/client) a nivel de modulo -- igual que
// src/infra/rf20/__tests__/consultas.test.ts, se mockea para no
// construir un PrismaClient real (no generado en este entorno de
// pruebas) solo por la importacion; las pruebas de abajo siempre pasan
// su propio cliente falso de todas formas.
vi.mock("@/infra/prisma/client", () => ({ prisma: {} }));

function clienteFalso(count: number): { cliente: ClienteRestablecimientoMfa; updateManyMock: ReturnType<typeof vi.fn> } {
  const updateManyMock = vi.fn().mockResolvedValue({ count });
  const cliente: ClienteRestablecimientoMfa = {
    async $transaction(fn) {
      // Mismo cliente se pasa como "tx" -- suficiente para esta prueba,
      // que solo necesita que updateManyMock se invoque dentro del
      // callback (igual que Prisma real invoca el callback con un
      // cliente de transaccion).
      return fn(cliente);
    },
    usuarioPlataforma: { updateMany: updateManyMock },
  };
  return { cliente, updateManyMock };
}

describe("restablecerMfaPlataformaTransaccion", () => {
  it("limpia los tres campos MFA e incrementa sessionVersion en 1, en una sola llamada atomica", async () => {
    const { cliente, updateManyMock } = clienteFalso(1);

    await restablecerMfaPlataformaTransaccion(cliente, "usuario-1", "curador@example.com");

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "usuario-1", email: "curador@example.com" },
      data: {
        mfaHabilitado: false,
        mfaSecret: null,
        mfaUltimoContadorUsado: null,
        sessionVersion: { increment: 1 },
      },
    });
  });

  it("exige exactamente 1 fila afectada -- 0 filas lanza ConteoInesperadoError y no se traga el fallo", async () => {
    const { cliente } = clienteFalso(0);

    await expect(restablecerMfaPlataformaTransaccion(cliente, "usuario-1", "curador@example.com")).rejects.toBeInstanceOf(
      ConteoInesperadoError,
    );
  });

  it("exige exactamente 1 fila afectada -- 2 filas (no deberia ser posible, pero nunca se asume) tambien lanza", async () => {
    const { cliente } = clienteFalso(2);

    const error = await restablecerMfaPlataformaTransaccion(cliente, "usuario-1", "curador@example.com").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConteoInesperadoError);
    expect((error as ConteoInesperadoError).cantidad).toBe(2);
  });
});

describe("consecuencia del restablecimiento sobre requireSesionPlataforma()", () => {
  const queryRawMock = vi.fn();
  beforeEach(() => {
    process.env.AUTH_PLATAFORMA_SECRET = "secreto-de-pruebas-plataforma-no-real";
    queryRawMock.mockReset();
  });

  it("un token de sesion emitido con la sessionVersion anterior queda rechazado despues del incremento", async () => {
    const config = await import("@/auth.config.plataforma");
    const { requireSesionPlataforma } = await import("@/infra/auth/sessionPlataforma");

    // Token emitido ANTES del restablecimiento, con sessionVersion=1 --
    // exactamente el que tendria una sesion robada junto con el
    // dispositivo MFA perdido.
    const tokenViejo = await config.crearTokenSesionPlataforma({
      usuarioId: "usuario-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 1,
    });

    // Estado en Postgres DESPUES de restablecerMfaPlataformaTransaccion():
    // sessionVersion ya quedo en 2 (incrementada en 1).
    queryRawMock.mockResolvedValue([{ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 2 }]);
    const clienteLectura = { $queryRaw: queryRawMock } as never;

    await expect(requireSesionPlataforma(tokenViejo, clienteLectura)).rejects.toThrow(
      "SESION_PLATAFORMA_INVALIDA",
    );
  });

  it("control: un token emitido DESPUES del restablecimiento (sessionVersion=2) si es aceptado", async () => {
    const config = await import("@/auth.config.plataforma");
    const { requireSesionPlataforma } = await import("@/infra/auth/sessionPlataforma");

    const tokenNuevo = await config.crearTokenSesionPlataforma({
      usuarioId: "usuario-1",
      rol: "CURADOR_METODOLOGICO",
      sessionVersion: 2,
    });
    queryRawMock.mockResolvedValue([{ activo: true, rol: "CURADOR_METODOLOGICO", sessionVersion: 2 }]);
    const clienteLectura = { $queryRaw: queryRawMock } as never;

    await expect(requireSesionPlataforma(tokenNuevo, clienteLectura)).resolves.toMatchObject({
      usuarioId: "usuario-1",
      sessionVersion: 2,
    });
  });
});
