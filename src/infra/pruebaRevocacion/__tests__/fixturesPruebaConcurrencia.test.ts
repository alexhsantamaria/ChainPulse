// Pruebas — creacion/borrado transaccional de las fixtures descartables
// de proteccionConcurrente.integration.test.ts (Alex, 2026-10-04,
// revision de la version d, punto 1). $transaction inyectado -- ninguna
// prueba toca Postgres real. Cubre especificamente los caminos de
// fallo parcial que motivaron esta correccion: "Agregá pruebas de
// fallo parcial, incluido fallo antes de crear la empresa."
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  FixturesPruebaConcurrencia,
  ResultadoBorradoFixturesConcurrencia,
  FixturaCruzadaPruebaConcurrencia,
} from "../fixturesPruebaConcurrencia";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

const PREFIJO = "ZZ_PRUEBA_CONCURRENCIA";
const SUFIJO = "abc123";

function txFeliz() {
  let contadorUsuario = 0;
  let contadorCadena = 0;
  let contadorDefinicion = 0;
  let contadorImportacion = 0;
  return {
    empresa: { create: vi.fn().mockResolvedValue({ id: "empresa-1" }) },
    usuario: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: `usuario-${++contadorUsuario}` })),
    },
    cadena: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: `cadena-${++contadorCadena}` })),
    },
    definicionKpi: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: `definicion-${++contadorDefinicion}` })),
    },
    importacionCsv: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: `importacion-${++contadorImportacion}` })),
    },
  };
}

function clienteCrearTransaccionReal(tx: ReturnType<typeof txFeliz>) {
  return {
    $transaction: vi.fn(
      async (fn: (tx: ReturnType<typeof txFeliz>) => Promise<FixturesPruebaConcurrencia>) => fn(tx),
    ),
  };
}

describe("crearFixturesPruebaConcurrencia", () => {
  it("crea las 5 filas DENTRO de la misma transaccion y devuelve sus ids exactos", async () => {
    const tx = txFeliz();
    const admin = clienteCrearTransaccionReal(tx);
    const { crearFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    const fixtures = await crearFixturesPruebaConcurrencia(admin, PREFIJO, SUFIJO, "ctx");

    expect(admin.$transaction).toHaveBeenCalledTimes(1);
    expect(fixtures).toEqual({
      empresaId: "empresa-1",
      usuarioId: "usuario-1",
      cadenaId: "cadena-1",
      definicionKpiId: "definicion-1",
      importacionBaseId: "importacion-1",
    });
    expect(tx.importacionCsv.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ empresaId: "empresa-1", cadenaId: "cadena-1", definicionKpiId: "definicion-1" }),
      }),
    );
  });

  it("falla ANTES de crear la empresa (la propia llamada a $transaction rechaza, ningun create() corre) -- lanza, nunca devuelve un objeto parcial", async () => {
    const tx = txFeliz();
    const admin = {
      $transaction: vi.fn().mockRejectedValue(new Error("conexion perdida antes de abrir la transaccion")),
    };
    const { crearFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(crearFixturesPruebaConcurrencia(admin, PREFIJO, SUFIJO, "ctx")).rejects.toThrow(
      "ERROR_CREACION_FIXTURES_CONCURRENCIA",
    );
    expect(tx.empresa.create).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_CREACION_FIXTURES_CONCURRENCIA");
  });

  it("la empresa SI se crea pero el usuario falla -- lanza el mismo codigo colapsado, nunca devuelve ids parciales", async () => {
    const tx = txFeliz();
    tx.usuario.create = vi.fn().mockRejectedValue(new Error("violacion de unicidad simulada"));
    const admin = clienteCrearTransaccionReal(tx);
    const { crearFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(crearFixturesPruebaConcurrencia(admin, PREFIJO, SUFIJO, "ctx")).rejects.toThrow(
      "ERROR_CREACION_FIXTURES_CONCURRENCIA",
    );
    expect(tx.empresa.create).toHaveBeenCalledTimes(1);
    expect(tx.cadena.create).not.toHaveBeenCalled();
  });

  it("falla en el ULTIMO create (importacionCsv) -- lanza igual; la transaccion real revertiria las 4 filas anteriores " +
    "(esta prueba unitaria no puede demostrar el rollback de Postgres en si, solo que la funcion nunca devuelve algo parcial)", async () => {
    const tx = txFeliz();
    tx.importacionCsv.create = vi.fn().mockRejectedValue(new Error("fallo simulado en el ultimo paso"));
    const admin = clienteCrearTransaccionReal(tx);
    const { crearFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(crearFixturesPruebaConcurrencia(admin, PREFIJO, SUFIJO, "ctx")).rejects.toThrow(
      "ERROR_CREACION_FIXTURES_CONCURRENCIA",
    );
  });
});

function txBorradoFeliz(opciones: { countUsuario?: number } = {}) {
  return {
    importacionCsv: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    usuario: { deleteMany: vi.fn().mockResolvedValue({ count: opciones.countUsuario ?? 1 }) },
    cadena: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    definicionKpi: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    empresa: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

function clienteBorrarTransaccionReal(tx: ReturnType<typeof txBorradoFeliz>) {
  return {
    $transaction: vi.fn(
      async (fn: (tx: ReturnType<typeof txBorradoFeliz>) => Promise<ResultadoBorradoFixturesConcurrencia>) => fn(tx),
    ),
  };
}

const FIXTURES = {
  empresaId: "empresa-1",
  usuarioId: "usuario-1",
  cadenaId: "cadena-1",
  definicionKpiId: "definicion-1",
  importacionBaseId: "importacion-1",
};

describe("borrarFixturesPruebaConcurrencia", () => {
  it("borra las 5 filas por ID EXACTO -- nunca un where por empresaId solo", async () => {
    const tx = txBorradoFeliz();
    const admin = clienteBorrarTransaccionReal(tx);
    const { borrarFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    const resultado = await borrarFixturesPruebaConcurrencia(admin, FIXTURES, "ctx");

    expect(resultado).toEqual({ usuarioYaNoEstaba: false });
    expect(tx.importacionCsv.deleteMany).toHaveBeenCalledWith({ where: { id: "importacion-1" } });
    expect(tx.usuario.deleteMany).toHaveBeenCalledWith({ where: { id: "usuario-1" } });
    expect(tx.cadena.deleteMany).toHaveBeenCalledWith({ where: { id: "cadena-1" } });
    expect(tx.definicionKpi.deleteMany).toHaveBeenCalledWith({ where: { id: "definicion-1" } });
    expect(tx.empresa.deleteMany).toHaveBeenCalledWith({ where: { id: "empresa-1" } });
  });

  it("el usuario ya no estaba (el cuerpo de la prueba ya lo habia borrado) -- count:0 es EXITO, no fallo", async () => {
    const tx = txBorradoFeliz({ countUsuario: 0 });
    const admin = clienteBorrarTransaccionReal(tx);
    const { borrarFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    const resultado = await borrarFixturesPruebaConcurrencia(admin, FIXTURES, "ctx");
    expect(resultado).toEqual({ usuarioYaNoEstaba: true });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("falta la importacionCsv (nadie deberia haberla borrado) -- fallo REAL, lanza y NUNCA se reporta como limpieza exitosa", async () => {
    const tx = txBorradoFeliz();
    tx.importacionCsv.deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const admin = clienteBorrarTransaccionReal(tx);
    const { borrarFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(borrarFixturesPruebaConcurrencia(admin, FIXTURES, "ctx")).rejects.toThrow(
      "ERROR_BORRADO_FIXTURES_CONCURRENCIA",
    );
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_BORRADO_FIXTURES_CONCURRENCIA");
    // Nunca llega a borrar lo que viene despues en la transaccion --
    // Postgres la revertiria entera igual, pero esto confirma que la
    // funcion no sigue adelante optimisticamente.
    expect(tx.usuario.deleteMany).not.toHaveBeenCalled();
  });

  it("falta la empresa al final (otra cosa la borro) -- fallo REAL, lanza", async () => {
    const tx = txBorradoFeliz();
    tx.empresa.deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const admin = clienteBorrarTransaccionReal(tx);
    const { borrarFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(borrarFixturesPruebaConcurrencia(admin, FIXTURES, "ctx")).rejects.toThrow(
      "ERROR_BORRADO_FIXTURES_CONCURRENCIA",
    );
  });

  it("la transaccion de borrado falla por completo (p. ej. conexion perdida) -- lanza, nunca se traga el error", async () => {
    const admin = { $transaction: vi.fn().mockRejectedValue(new Error("conexion perdida")) };
    const { borrarFixturesPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(borrarFixturesPruebaConcurrencia(admin, FIXTURES, "ctx")).rejects.toThrow(
      "ERROR_BORRADO_FIXTURES_CONCURRENCIA",
    );
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_BORRADO_FIXTURES_CONCURRENCIA");
  });
});

function txCruzadaFeliz() {
  return {
    empresa: { create: vi.fn().mockResolvedValue({ id: "otra-empresa-1" }) },
    cadena: { create: vi.fn().mockResolvedValue({ id: "otra-cadena-1" }) },
    importacionCsv: { create: vi.fn().mockResolvedValue({ id: "importacion-cruzada-1" }) },
  };
}

function clienteCrearCruzadaTransaccionReal(tx: ReturnType<typeof txCruzadaFeliz>) {
  return {
    $transaction: vi.fn(
      async (fn: (tx: ReturnType<typeof txCruzadaFeliz>) => Promise<FixturaCruzadaPruebaConcurrencia>) => fn(tx),
    ),
  };
}

describe("crearFixturaCruzadaPruebaConcurrencia", () => {
  it("crea empresa/cadena/importacion de la OTRA empresa DENTRO de una transaccion, confirmadaPorId nunca se fija aca", async () => {
    const tx = txCruzadaFeliz();
    const admin = clienteCrearCruzadaTransaccionReal(tx);
    const { crearFixturaCruzadaPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    const fixtura = await crearFixturaCruzadaPruebaConcurrencia(admin, PREFIJO, SUFIJO, "definicion-1", "ctx");

    expect(fixtura).toEqual({
      otraEmpresaId: "otra-empresa-1",
      otraCadenaId: "otra-cadena-1",
      importacionCruzadaId: "importacion-cruzada-1",
    });
    expect(tx.importacionCsv.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          empresaId: "otra-empresa-1",
          cadenaId: "otra-cadena-1",
          definicionKpiId: "definicion-1",
        }),
      }),
    );
    const datosImportacion = (tx.importacionCsv.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(datosImportacion).not.toHaveProperty("confirmadaPorId");
  });

  it("falla antes de crear la otra empresa -- lanza, nunca devuelve un objeto parcial", async () => {
    const admin = { $transaction: vi.fn().mockRejectedValue(new Error("conexion perdida")) };
    const { crearFixturaCruzadaPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(crearFixturaCruzadaPruebaConcurrencia(admin, PREFIJO, SUFIJO, "definicion-1", "ctx")).rejects.toThrow(
      "ERROR_CREACION_FIXTURA_CRUZADA_CONCURRENCIA",
    );
  });
});

function txBorrarCruzadaFeliz() {
  return {
    importacionCsv: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cadena: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    empresa: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

function clienteBorrarCruzadaTransaccionReal(tx: ReturnType<typeof txBorrarCruzadaFeliz>) {
  return {
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof txBorrarCruzadaFeliz>) => Promise<void>) => fn(tx)),
  };
}

const FIXTURA_CRUZADA: FixturaCruzadaPruebaConcurrencia = {
  otraEmpresaId: "otra-empresa-1",
  otraCadenaId: "otra-cadena-1",
  importacionCruzadaId: "importacion-cruzada-1",
};

describe("borrarFixturaCruzadaPruebaConcurrencia", () => {
  it("borra las 3 filas cruzadas por ID EXACTO", async () => {
    const tx = txBorrarCruzadaFeliz();
    const admin = clienteBorrarCruzadaTransaccionReal(tx);
    const { borrarFixturaCruzadaPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await borrarFixturaCruzadaPruebaConcurrencia(admin, FIXTURA_CRUZADA, "ctx");

    expect(tx.importacionCsv.deleteMany).toHaveBeenCalledWith({ where: { id: "importacion-cruzada-1" } });
    expect(tx.cadena.deleteMany).toHaveBeenCalledWith({ where: { id: "otra-cadena-1" } });
    expect(tx.empresa.deleteMany).toHaveBeenCalledWith({ where: { id: "otra-empresa-1" } });
  });

  it("falta la importacion cruzada (nadie deberia haberla borrado -- a diferencia del usuario principal, aca NO hay count:0 tolerado) -- lanza", async () => {
    const tx = txBorrarCruzadaFeliz();
    tx.importacionCsv.deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const admin = clienteBorrarCruzadaTransaccionReal(tx);
    const { borrarFixturaCruzadaPruebaConcurrencia } = await import("../fixturesPruebaConcurrencia");

    await expect(borrarFixturaCruzadaPruebaConcurrencia(admin, FIXTURA_CRUZADA, "ctx")).rejects.toThrow(
      "ERROR_BORRADO_FIXTURA_CRUZADA_CONCURRENCIA",
    );
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_BORRADO_FIXTURA_CRUZADA_CONCURRENCIA");
  });
});
