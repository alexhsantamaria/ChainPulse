// Infraestructura — definicion del job recurrente de purga de huellaOrigen
// (Bloque A del Incremento 2). Nombre de cola propio para que un futuro job
// (import de CSV, Incremento 4; recomputo de Market Signals, Incremento 7)
// tenga el suyo y no compita por el mismo lote de boss.fetch().
import type { PgBoss } from "pg-boss";
import { purgarHuellasOrigen } from "../retencion";
import { prisma } from "../prisma/client";

export const COLA_PURGA_HUELLA_ORIGEN = "purgar-huellas-origen";

/**
 * Encola una ejecucion del job de purga, deduplicada dentro de una ventana
 * de 30 minutos (singletonSeconds) — evita que los dos disparadores
 * independientes (Vercel Cron + GitHub Actions de respaldo, ADR-0004)
 * encolen el mismo trabajo dos veces si coinciden.
 */
export async function encolarPurgaHuellaOrigen(boss: PgBoss): Promise<void> {
  await boss.send(COLA_PURGA_HUELLA_ORIGEN, {}, { singletonSeconds: 30 * 60 });
}

export interface ResultadoProcesarPurga {
  procesados: number;
}

/**
 * Retira hasta `batchSize` jobs pendientes de la cola de purga y los
 * ejecuta uno por uno, marcando cada uno complete()/fail() segun el
 * resultado — patron boss.fetch() de ADR-0004, nunca boss.work().
 */
export async function procesarPurgaHuellaOrigen(
  boss: PgBoss,
  batchSize = 5,
): Promise<ResultadoProcesarPurga> {
  const jobs = await boss.fetch(COLA_PURGA_HUELLA_ORIGEN, { batchSize });
  if (!jobs || jobs.length === 0) {
    return { procesados: 0 };
  }

  for (const job of jobs) {
    try {
      const resultado = await purgarHuellasOrigen(new Date(), prisma);
      await boss.complete(COLA_PURGA_HUELLA_ORIGEN, job.id, resultado);
    } catch (err) {
      await boss.fail(COLA_PURGA_HUELLA_ORIGEN, job.id, {
        mensaje: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { procesados: jobs.length };
}
