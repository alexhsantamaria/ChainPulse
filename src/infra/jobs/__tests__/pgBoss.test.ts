// Pruebas — obtenerBoss() registra un listener de "error" antes de start()
// (hallazgo de la revision de solo lectura del 2026-10-01: sin este
// listener, un error emitido por el queueCacheInterval interno de pg-boss
// -- que corre sin importar supervise:false, ver comentario de
// pgBoss.ts -- se propaga como excepcion no capturada). Con "pg-boss"
// mockeado (vi.mock): ninguna de estas pruebas abre una conexion real,
// mismo criterio que purgaHuellaOrigenJob.test.ts con su PgBoss falso.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

// PgBoss real extiende EventEmitter (node_modules/pg-boss/dist/index.js) --
// este falso hace lo mismo para que boss.on("error", ...)/emit()/
// listenerCount() se comporten igual que la clase real.
class PgBossFalso extends EventEmitter {
  opciones: unknown;
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn().mockResolvedValue(undefined);
  constructor(opciones: unknown) {
    super();
    this.opciones = opciones;
  }
}

const PgBossConstructorMock = vi.fn((opciones: unknown) => new PgBossFalso(opciones));

vi.mock("pg-boss", () => ({
  PgBoss: function (this: unknown, opciones: unknown) {
    return PgBossConstructorMock(opciones);
  },
}));

beforeEach(() => {
  // obtenerBoss() guarda la instancia en globalThis (mismo patron que
  // Prisma, para reusar el pool entre invocaciones calientes) -- hay que
  // resetearlo entre pruebas para que cada una vea una instancia nueva,
  // igual que pasaria en un proceso nuevo.
  (globalThis as unknown as { pgBoss?: unknown }).pgBoss = undefined;
  PgBossConstructorMock.mockClear();
  logErrorMock.mockClear();
});

describe("obtenerBoss", () => {
  it("registra el listener de error ANTES de llamar a start()", async () => {
    const ordenDeLlamadas: string[] = [];
    PgBossConstructorMock.mockImplementationOnce((opciones: unknown) => {
      const instancia = new PgBossFalso(opciones);
      const onOriginal = instancia.on.bind(instancia);
      instancia.on = ((...args: Parameters<typeof onOriginal>) => {
        if (args[0] === "error") ordenDeLlamadas.push("on:error");
        return onOriginal(...args);
      }) as typeof onOriginal;
      instancia.start = vi.fn(async () => {
        ordenDeLlamadas.push("start");
      });
      return instancia;
    });
    const { obtenerBoss } = await import("../pgBoss");

    await obtenerBoss();

    expect(ordenDeLlamadas).toEqual(["on:error", "start"]);
  });

  it("un error emitido por la instancia se registra via logError, sin lanzar una excepcion no capturada", async () => {
    const { obtenerBoss } = await import("../pgBoss");
    const boss = await obtenerBoss();

    const errorDePgBoss = new Error("Connection terminated due to connection timeout");
    // Si no hubiera ningun listener de "error", este emit() lanzaria --
    // justamente el unhandledRejection/excepcion no capturada que este
    // cambio evita. Que la linea siguiente no lance ya es parte de la
    // prueba.
    boss.emit("error", errorDePgBoss);

    expect(logErrorMock).toHaveBeenCalledWith("infra/jobs/pgBoss", errorDePgBoss);
  });

  it("no duplica el listener de error en llamadas sucesivas a obtenerBoss() (misma instancia compartida)", async () => {
    const { obtenerBoss } = await import("../pgBoss");

    const boss1 = await obtenerBoss();
    const boss2 = await obtenerBoss();

    expect(boss1).toBe(boss2); // confirma que es la misma instancia (singleton), no una nueva por llamada
    expect((boss1 as unknown as EventEmitter).listenerCount("error")).toBe(1);
  });

  it("no agrega, quita ni modifica ninguna opcion de PgBoss (timeouts, reintentos, supervise, schedule, etc.)", async () => {
    const { obtenerBoss } = await import("../pgBoss");
    process.env.DATABASE_URL = "postgres://usuario-de-prueba@host-de-prueba/db-de-prueba";

    await obtenerBoss();

    expect(PgBossConstructorMock).toHaveBeenCalledWith({
      connectionString: "postgres://usuario-de-prueba@host-de-prueba/db-de-prueba",
      schema: "pgboss",
      supervise: false,
      schedule: false,
      createSchema: false,
      migrate: false,
    });
  });

  it("un fallo real de start() sigue propagandose tal cual -- el listener de error no lo oculta", async () => {
    PgBossConstructorMock.mockImplementationOnce((opciones: unknown) => {
      const instancia = new PgBossFalso(opciones);
      instancia.start = vi.fn().mockRejectedValue(new Error("no se pudo conectar"));
      return instancia;
    });
    const { obtenerBoss } = await import("../pgBoss");

    await expect(obtenerBoss()).rejects.toThrow("no se pudo conectar");
  });
});
