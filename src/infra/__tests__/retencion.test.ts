// Prueba purgarHuellasOrigen() con un cliente de Prisma falso (solo los dos
// metodos que la funcion usa) — no depende de una conexion real a Neon.
// Cubre la logica de ventanas (48h para EvaluacionExpres, 2h de margen para
// LimiteTasa) y los valores que sobrescribe, no el SQL que Prisma genera.
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

function crearPrismaFalso(overrides?: {
  updateManyCount?: number;
  updateManyCountV2?: number;
  deleteManyCount?: number;
}) {
  return {
    evaluacionExpres: {
      updateMany: vi.fn().mockResolvedValue({ count: overrides?.updateManyCount ?? 0 }),
    },
    // R5-4 (Ronda 5) -- EvaluacionExpresV2 (Incremento 2) tiene el mismo
    // par huellaOrigen/huellaOrigenPurgadaEn que EvaluacionExpres (v1) y
    // ahora se purga con el mismo criterio de edad.
    evaluacionExpresV2: {
      updateMany: vi.fn().mockResolvedValue({ count: overrides?.updateManyCountV2 ?? 0 }),
    },
    limiteTasa: {
      deleteMany: vi.fn().mockResolvedValue({ count: overrides?.deleteManyCount ?? 0 }),
    },
  } as unknown as PrismaClient;
}

describe("purgarHuellasOrigen", () => {
  it("purga EvaluacionExpres con mas de 48h y todavia sin purgar, sobreescribiendo huellaOrigen con string vacio", async () => {
    const { purgarHuellasOrigen } = await import("../retencion");
    const prismaFalso = crearPrismaFalso({ updateManyCount: 3 });
    const ahora = new Date("2026-09-16T12:00:00.000Z");

    const resultado = await purgarHuellasOrigen(ahora, prismaFalso);

    expect(prismaFalso.evaluacionExpres.updateMany).toHaveBeenCalledWith({
      where: {
        huellaOrigenPurgadaEn: null,
        createdAt: { lte: new Date("2026-09-14T12:00:00.000Z") }, // ahora - 48h
      },
      data: {
        huellaOrigen: "",
        huellaOrigenPurgadaEn: ahora,
      },
    });
    expect(resultado.huellasOrigenPurgadas).toBe(3);
  });

  it("elimina filas de LimiteTasa cuya ventana ya paso hace mas de 2h", async () => {
    const { purgarHuellasOrigen } = await import("../retencion");
    const prismaFalso = crearPrismaFalso({ deleteManyCount: 7 });
    const ahora = new Date("2026-09-16T12:00:00.000Z");

    const resultado = await purgarHuellasOrigen(ahora, prismaFalso);

    expect(prismaFalso.limiteTasa.deleteMany).toHaveBeenCalledWith({
      where: { ventanaInicio: { lte: new Date("2026-09-16T10:00:00.000Z") } }, // ahora - 2h
    });
    expect(resultado.filasLimiteTasaEliminadas).toBe(7);
  });

  it("nunca toca una EvaluacionExpres ya purgada, aunque cumpla la ventana de edad (huellaOrigenPurgadaEn: null en el where lo excluye)", async () => {
    const { purgarHuellasOrigen } = await import("../retencion");
    const prismaFalso = crearPrismaFalso();

    await purgarHuellasOrigen(new Date("2026-09-16T12:00:00.000Z"), prismaFalso);

    const llamadas = (prismaFalso.evaluacionExpres.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas).toHaveLength(1);
    const llamada = llamadas[0]![0];
    expect(llamada.where.huellaOrigenPurgadaEn).toBeNull();
  });

  // R5-4 (Ronda 5, ALTO) -- deuda del Incremento 2: EvaluacionExpresV2
  // tiene el mismo par huellaOrigen/huellaOrigenPurgadaEn que la tabla v1,
  // pero este job no la tocaba (la tabla no existia cuando se escribio
  // este archivo por primera vez).
  it("purga tambien EvaluacionExpresV2 con el mismo criterio de 48h, y suma ambos conteos", async () => {
    const { purgarHuellasOrigen } = await import("../retencion");
    const prismaFalso = crearPrismaFalso({ updateManyCount: 3, updateManyCountV2: 2 });
    const ahora = new Date("2026-09-16T12:00:00.000Z");

    const resultado = await purgarHuellasOrigen(ahora, prismaFalso);

    expect(prismaFalso.evaluacionExpresV2.updateMany).toHaveBeenCalledWith({
      where: {
        huellaOrigenPurgadaEn: null,
        createdAt: { lte: new Date("2026-09-14T12:00:00.000Z") }, // ahora - 48h
      },
      data: {
        huellaOrigen: "",
        huellaOrigenPurgadaEn: ahora,
      },
    });
    // 3 (v1) + 2 (v2) -- un solo total, RF15/RF17 no distingue de que
    // tabla vino cada huella purgada.
    expect(resultado.huellasOrigenPurgadas).toBe(5);
  });

  it("nunca toca una EvaluacionExpresV2 ya purgada (mismo criterio que v1)", async () => {
    const { purgarHuellasOrigen } = await import("../retencion");
    const prismaFalso = crearPrismaFalso();

    await purgarHuellasOrigen(new Date("2026-09-16T12:00:00.000Z"), prismaFalso);

    const llamadas = (prismaFalso.evaluacionExpresV2.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas).toHaveLength(1);
    const llamada = llamadas[0]![0];
    expect(llamada.where.huellaOrigenPurgadaEn).toBeNull();
  });
});
