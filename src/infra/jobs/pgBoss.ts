// Infraestructura — instancia de PgBoss para el runtime de jobs en segundo
// plano (ADR-0004, Bloque A del Incremento 2: Vercel Cron/GitHub Actions
// invocan /api/internal/jobs/run, que hace boss.fetch() + complete()/fail()
// — nunca boss.work(), nunca un proceso persistente, coherente con Vercel
// serverless). No confundir con src/infra/prisma/client.ts: PgBoss
// administra su propio pool de conexiones "pg", no reutiliza el adapter de
// Prisma.
import { PgBoss } from "pg-boss";
import { logError } from "../log";

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
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: "pgboss",
      supervise: false, // sin temporizadores de mantenimiento en un proceso serverless de vida corta
      schedule: false, // el disparo es externo (Vercel Cron/GitHub Actions), no el scheduler interno de pg-boss
      createSchema: false,
      migrate: false,
    });

    // Listener de "error" ANTES de start() -- hallazgo de la revision de
    // solo lectura del 2026-10-01: PgBoss extiende EventEmitter, y
    // Manager#start() arma un queueCacheInterval que corre de forma
    // INCONDICIONAL (no depende de la opcion "supervise" de arriba -- ver
    // node_modules/pg-boss/dist/manager.js, metodo start()). Si esa
    // comprobacion periodica falla (p.ej. un timeout de conexion contra
    // Neon), onCacheQueues() emite "error" en la instancia -- y sin ningun
    // oyente, Node trata ese "error" como una excepcion no capturada. Esto
    // es exactamente el unhandledRejection intermitente que se veia en
    // Manager.onCacheQueues durante las corridas de integracion.
    //
    // IMPORTANTE -- esto NO corrige la causa raiz de ese error (por que el
    // timeout de conexion ocurre), ni cambia ningun timeout, politica de
    // reintento, la opcion "supervise" ni ningun estado de job: solo evita
    // que un error ya emitido se propague como excepcion no capturada,
    // registrandolo con el mismo logger sanitizado que usa el resto del
    // proyecto (src/infra/log.ts -- nunca expone DATABASE_URL ni ningun
    // otro secreto, solo contexto + mensaje + stack). Mismo patron que ya
    // usa scripts/bootstrapPgBoss.ts para su propia instancia de un solo
    // uso (boss.on("error", ...)), aplicado aca a la instancia compartida.
    //
    // Guard de listenerCount -- defensivo, no solo por este bloque (que ya
    // corre una sola vez por el "if" de arriba): evita que una futura
    // modificacion de este archivo, o una reconstruccion del modulo en
    // pruebas, termine agregando el mismo listener mas de una vez sobre la
    // misma instancia.
    if (boss.listenerCount("error") === 0) {
      boss.on("error", (err) => {
        logError("infra/jobs/pgBoss", err);
      });
    }

    globalForBoss.pgBoss = boss;
  }
  const boss = globalForBoss.pgBoss;
  // Un fallo real de start() (p.ej. no puede conectar en absoluto) sigue
  // propagandose tal cual -- este cambio no agrega ningun try/catch aca,
  // nunca oculta un fallo de inicializacion.
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
