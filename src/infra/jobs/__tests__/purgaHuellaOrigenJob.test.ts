// Pruebas — encolarPurgaHuellaOrigen()/procesarPurgaHuellaOrigen() (R5-15,
// Ronda 5) con un PgBoss falso (solo los metodos send/fetch/complete/fail
// que usa este archivo) — no depende de una conexion real a Postgres.
//
// "../prisma/client" y "../retencion" van mockeados (vi.mock): igual que
// retencion.test.ts documenta en su propio archivo, importar el singleton
// real de prisma/client.ts construye un PrismaClient real al cargar el
// modulo, y eso falla en este entorno mientras "prisma generate" siga
// bloqueado por la politica de red. purgaHuellaOrigenJob.ts importa ese
// singleton directo (a diferencia de retencion.ts, que lo recibe como
// parametro obligatorio), asi que la prueba unitaria necesita el mock para
// poder importar el modulo en absoluto.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../prisma/client", () => ({ prisma: {} }));

const purgarHuellasOrigenMock = vi.fn();
vi.mock("../../retencion", () => ({
  purgarHuellasOrigen: (...args: unknown[]) => purgarHuellasOrigenMock(...args),
}));

function crearBossFalso(overrides?: { jobs?: Array<{ id: string }> }) {
  return {
    send: vi.fn().mockResolvedValue("job-id"),
    fetch: vi.fn().mockResolvedValue(overrides?.jobs ?? []),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo los 4 metodos de arriba hacen falta; el resto de la interfaz de PgBoss no se usa en este archivo.
  } as any;
}

beforeEach(() => {
  purgarHuellasOrigenMock.mockReset();
});

describe("encolarPurgaHuellaOrigen", () => {
  it("encola el job con deduplicacion de 30 minutos (singletonSeconds)", async () => {
    const { encolarPurgaHuellaOrigen, COLA_PURGA_HUELLA_ORIGEN } = await import("../purgaHuellaOrigenJob");
    const boss = crearBossFalso();

    await encolarPurgaHuellaOrigen(boss);

    expect(boss.send).toHaveBeenCalledWith(COLA_PURGA_HUELLA_ORIGEN, {}, { singletonSeconds: 30 * 60 });
  });
});

describe("procesarPurgaHuellaOrigen", () => {
  it("sin jobs pendientes -- no llama a purgarHuellasOrigen ni a complete/fail", async () => {
    const { procesarPurgaHuellaOrigen } = await import("../purgaHuellaOrigenJob");
    const boss = crearBossFalso({ jobs: [] });

    const resultado = await procesarPurgaHuellaOrigen(boss);

    expect(resultado).toEqual({ procesados: 0 });
    expect(purgarHuellasOrigenMock).not.toHaveBeenCalled();
    expect(boss.complete).not.toHaveBeenCalled();
    expect(boss.fail).not.toHaveBeenCalled();
  });

  it("procesa cada job retirado y llama a complete() con el resultado de la purga", async () => {
    purgarHuellasOrigenMock.mockResolvedValue({ huellasOrigenPurgadas: 2, filasLimiteTasaEliminadas: 5 });
    const { procesarPurgaHuellaOrigen, COLA_PURGA_HUELLA_ORIGEN } = await import("../purgaHuellaOrigenJob");
    const boss = crearBossFalso({ jobs: [{ id: "job-1" }, { id: "job-2" }] });

    const resultado = await procesarPurgaHuellaOrigen(boss, 5);

    expect(resultado).toEqual({ procesados: 2 });
    expect(purgarHuellasOrigenMock).toHaveBeenCalledTimes(2);
    expect(boss.complete).toHaveBeenNthCalledWith(1, COLA_PURGA_HUELLA_ORIGEN, "job-1", {
      huellasOrigenPurgadas: 2,
      filasLimiteTasaEliminadas: 5,
    });
    expect(boss.complete).toHaveBeenNthCalledWith(2, COLA_PURGA_HUELLA_ORIGEN, "job-2", {
      huellasOrigenPurgadas: 2,
      filasLimiteTasaEliminadas: 5,
    });
    expect(boss.fail).not.toHaveBeenCalled();
  });

  it("respeta el batchSize pasado a boss.fetch()", async () => {
    const { procesarPurgaHuellaOrigen, COLA_PURGA_HUELLA_ORIGEN } = await import("../purgaHuellaOrigenJob");
    const boss = crearBossFalso({ jobs: [] });

    await procesarPurgaHuellaOrigen(boss, 17);

    expect(boss.fetch).toHaveBeenCalledWith(COLA_PURGA_HUELLA_ORIGEN, { batchSize: 17 });
  });

  it("un job que falla se marca con fail(), no interrumpe el procesamiento del resto", async () => {
    purgarHuellasOrigenMock
      .mockRejectedValueOnce(new Error("conexion caida"))
      .mockResolvedValueOnce({ huellasOrigenPurgadas: 1, filasLimiteTasaEliminadas: 0 });
    const { procesarPurgaHuellaOrigen, COLA_PURGA_HUELLA_ORIGEN } = await import("../purgaHuellaOrigenJob");
    const boss = crearBossFalso({ jobs: [{ id: "job-1" }, { id: "job-2" }] });

    const resultado = await procesarPurgaHuellaOrigen(boss);

    expect(resultado).toEqual({ procesados: 2 });
    expect(boss.fail).toHaveBeenCalledWith(COLA_PURGA_HUELLA_ORIGEN, "job-1", { mensaje: "conexion caida" });
    expect(boss.complete).toHaveBeenCalledWith(COLA_PURGA_HUELLA_ORIGEN, "job-2", {
      huellasOrigenPurgadas: 1,
      filasLimiteTasaEliminadas: 0,
    });
  });

  it("un error que no es Error (string/objeto) igual se registra en fail() como texto", async () => {
    purgarHuellasOrigenMock.mockRejectedValueOnce("algo raro");
    const { procesarPurgaHuellaOrigen, COLA_PURGA_HUELLA_ORIGEN } = await import("../purgaHuellaOrigenJob");
    const boss = crearBossFalso({ jobs: [{ id: "job-1" }] });

    await procesarPurgaHuellaOrigen(boss);

    expect(boss.fail).toHaveBeenCalledWith(COLA_PURGA_HUELLA_ORIGEN, "job-1", { mensaje: "algo raro" });
  });
});
