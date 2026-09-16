// Infraestructura — instancia de PgBoss para el runtime de jobs en segundo
// plano (ADR-0004, Bloque A del Incremento 2: Vercel Cron/GitHub Actions
// invocan /api/internal/jobs/run, que hace boss.fetch() + complete()/fail()
// — nunca boss.work(), nunca un proceso persistente, coherente con Vercel
// serverless). No confundir con src/infra/prisma/client.ts: PgBoss
// administra su propio pool de conexiones "pg", no reutiliza el adapter de
// Prisma.
import { PgBoss } from "pg-boss";

const globalForBoss = globalThis as unknown as { pgBoss?: PgBoss };

/**
 * Devuelve una instancia de PgBoss ya iniciada. createSchema/migrate en
 * false a proposito: chainpulse_app (el rol restringido de la aplicacion en
 * tiempo de ejecucion) no tiene permiso de DDL, mismo criterio que el resto
 * del proyecto (ver .env.example, prisma/rls.sql). El schema "pgboss" y la
 * cola de purga se crean UNA SOLA VEZ con el rol neondb_owner via
 * `npm run jobs:bootstrap` (scripts/bootstrapPgBoss.ts) — nunca en cada
 * invocacion de esta funcion.
 */
export async function obtenerBoss(): Promise<PgBoss> {
  if (!globalForBoss.pgBoss) {
    globalForBoss.pgBoss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: "pgboss",
      supervise: false, // sin temporizadores de mantenimiento en un proceso serverless de vida corta
      schedule: false, // el disparo es externo (Vercel Cron/GitHub Actions), no el scheduler interno de pg-boss
      createSchema: false,
      migrate: false,
    });
  }
  const boss = globalForBoss.pgBoss;
  await boss.start(); // idempotente: si ya esta iniciada, no repite trabajo contra la base.
  return boss;
}

/**
 * Cierra la instancia compartida. Solo para scripts de un solo uso
 * (bootstrap, tests) — nunca dentro del Route Handler serverless, donde
 * cerrar la conexion en cada invocacion anularia el propósito de reusar el
 * pool entre invocaciones calientes.
 */
export async function cerrarBoss(): Promise<void> {
  if (globalForBoss.pgBoss) {
    await globalForBoss.pgBoss.stop({ graceful: false, timeout: 5000 });
    globalForBoss.pgBoss = undefined;
  }
}
