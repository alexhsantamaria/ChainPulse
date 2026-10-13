// Pruebas — borrado protegido de un usuario de prueba con aislamiento
// SERIALIZABLE explicito, por el rol ADMIN (Alex, 2026-10-04, punto 2 de
// la tercera correccion, corregido en la cuarta: el rol usado importa --
// ver el comentario de cabecera de eliminarUsuarioProtegido.ts, PARTE 1).
// $transaction inyectado -- ninguna prueba toca Postgres real;
// verificarSinDatosRelacionadosInesperados() es la funcion REAL (no
// mockeada), igual criterio que sus propias pruebas.
import { describe, expect, it, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

const EMPRESA_ID = "empresa-1";
const USUARIO_ID = "usuario-a3";

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

function txSinCascadas(opciones: { deleteCount?: number } = {}) {
  const conConteo = () => ({ count: vi.fn().mockResolvedValue(0) });
  const tx: Record<string, unknown> = {
    // Presente en el mock para poder probar explicitamente que la
    // funcion NUNCA lo llama (ver la prueba "nunca fija app.tenant_id"
    // mas abajo) -- no porque la funcion lo necesite.
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    usuario: { deleteMany: vi.fn().mockResolvedValue({ count: opciones.deleteCount ?? 1 }) },
  };
  for (const modelo of MODELOS_CASCADA) {
    tx[modelo] = conConteo();
  }
  return tx;
}

function clienteAdminTransaccionReal(tx: ReturnType<typeof txSinCascadas>) {
  return {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>, _opciones: unknown) => {
      await fn(tx);
    }),
  };
}

describe("eliminarUsuarioConProteccionConcurrente", () => {
  it("chequea cascadas y borra -- todo DENTRO de la misma transaccion, con isolationLevel Serializable", async () => {
    const tx = txSinCascadas();
    const clienteAdmin = clienteAdminTransaccionReal(tx);
    const { eliminarUsuarioConProteccionConcurrente, NIVEL_AISLAMIENTO_SERIALIZABLE } = await import(
      "../eliminarUsuarioProtegido"
    );
    await eliminarUsuarioConProteccionConcurrente(clienteAdmin, EMPRESA_ID, USUARIO_ID, "ctx");

    expect(clienteAdmin.$transaction).toHaveBeenCalledTimes(1);
    const [, opcionesTransaccion] = clienteAdmin.$transaction.mock.calls[0]!;
    expect(opcionesTransaccion).toEqual({ isolationLevel: NIVEL_AISLAMIENTO_SERIALIZABLE });
    expect(NIVEL_AISLAMIENTO_SERIALIZABLE).toBe("Serializable");

    expect((tx.usuario as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany).toHaveBeenCalledWith({
      where: { id: USUARIO_ID, empresaId: EMPRESA_ID },
    });
  });

  it(
    "NUNCA fija app.tenant_id -- el rol admin bypassea RLS por ser dueño de las tablas, fijarlo no haria " +
      "nada util y sugeriria (mal) que RLS todavia acota lo que esta transaccion ve (correccion de la version d)",
    async () => {
      const tx = txSinCascadas();
      const clienteAdmin = clienteAdminTransaccionReal(tx);
      const { eliminarUsuarioConProteccionConcurrente } = await import("../eliminarUsuarioProtegido");
      await eliminarUsuarioConProteccionConcurrente(clienteAdmin, EMPRESA_ID, USUARIO_ID, "ctx");
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it("hay una referencia de cascada (p. ej. ImportacionCsv.confirmadaPorId de OTRA empresa) -- aborta DENTRO de la transaccion, nunca borra", async () => {
    const tx = txSinCascadas();
    (tx.importacionCsv as { count: ReturnType<typeof vi.fn> }).count = vi.fn().mockResolvedValue(1);
    const clienteAdmin = clienteAdminTransaccionReal(tx);
    const { eliminarUsuarioConProteccionConcurrente } = await import("../eliminarUsuarioProtegido");

    await expect(
      eliminarUsuarioConProteccionConcurrente(clienteAdmin, EMPRESA_ID, USUARIO_ID, "ctx"),
    ).rejects.toThrow("ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");
    expect((tx.usuario as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");
  });

  it("el deleteMany no afecta exactamente 1 fila (el usuario ya no estaba) -- aborta con el mismo codigo colapsado", async () => {
    const tx = txSinCascadas({ deleteCount: 0 });
    const clienteAdmin = clienteAdminTransaccionReal(tx);
    const { eliminarUsuarioConProteccionConcurrente } = await import("../eliminarUsuarioProtegido");

    await expect(
      eliminarUsuarioConProteccionConcurrente(clienteAdmin, EMPRESA_ID, USUARIO_ID, "ctx"),
    ).rejects.toThrow("ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");
  });

  it("la transaccion falla CON UN SECRETO SIMULADO (p. ej. un serialization_failure real) -- codigo fijo, el secreto nunca llega al logger", async () => {
    const secreto = "could not serialize access due to read/write dependencies among transactions -- host=real-host";
    const clienteAdmin = {
      $transaction: vi.fn().mockRejectedValue(new Error(secreto)),
    };
    const { eliminarUsuarioConProteccionConcurrente } = await import("../eliminarUsuarioProtegido");

    await expect(
      eliminarUsuarioConProteccionConcurrente(clienteAdmin, EMPRESA_ID, USUARIO_ID, "ctx-secreto"),
    ).rejects.toThrow("ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls);
    expect(argumentosRegistrados).not.toContain(secreto);
    expect(argumentosRegistrados).not.toContain("real-host");
  });
});
