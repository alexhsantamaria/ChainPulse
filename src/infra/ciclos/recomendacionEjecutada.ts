// Infraestructura — marca una recomendacion priorizada (RF8) como
// ejecutada (RNF9). La recomendacion en si no se persiste (ver
// src/engine/recomendacion.ts) -- esto se ancla al par (ciclo, conexion)
// que la genero, no al texto/prioridad puntual.
//
// RecomendacionEjecutada no esta en TENANT_SCOPED_MODELS (no tiene su
// propia columna empresaId), mismo patron de set_config manual que el
// resto de infra/ciclos/.
import { prisma } from "../prisma/client";

export async function marcarRecomendacionEjecutada(input: {
  empresaId: string;
  cicloPulsoId: string;
  conexionId: string;
  usuarioId: string;
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.empresaId}, true)`;
    // Idempotente a proposito (upsert con update vacio): marcarla dos
    // veces no es un error, solo no cambia quien la marco primero.
    await tx.recomendacionEjecutada.upsert({
      where: {
        cicloPulsoId_conexionId: { cicloPulsoId: input.cicloPulsoId, conexionId: input.conexionId },
      },
      update: {},
      create: {
        cicloPulsoId: input.cicloPulsoId,
        conexionId: input.conexionId,
        marcadaPorId: input.usuarioId,
      },
    });
  });
}
