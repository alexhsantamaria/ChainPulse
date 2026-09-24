// Script de un solo uso — Bloque A del Incremento 2 (PLAN-DE-TRABAJO.md
// Seccion 18.4). Crea el schema y las tablas propias de pg-boss y la cola de
// purga de huellaOrigen, y le otorga a chainpulse_app (el rol restringido
// de la aplicacion en tiempo de ejecucion, sin permiso de DDL) los permisos
// de datos que necesita para usarlas.
//
// Mismo patron que "npm run prisma:migrate" (SHADOW_DATABASE_URL) y
// prisma/seed.ts (SEED_DATABASE_URL): correr esto UNA VEZ con el rol
// neondb_owner, nunca con chainpulse_app, y nunca en cada despliegue.
//
// Uso:
//   npm run jobs:bootstrap
//
// Requiere SEED_DATABASE_URL en .env (el mismo rol neondb_owner que ya usa
// prisma/seed.ts — ver .env.example). Hay que volver a correrlo si se borra
// el schema "pgboss" a mano, o si se agrega una cola nueva mas adelante
// (Incremento 4: import de CSV; Incremento 7: recomputo de Market Signals).
import "./_cargarEnv";
import { PgBoss } from "pg-boss";
import { Client } from "pg";
import { COLA_PURGA_HUELLA_ORIGEN } from "../src/infra/jobs/purgaHuellaOrigenJob";

const PGBOSS_SCHEMA = "pgboss";

async function main() {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado (ver .env.example) — este script necesita el rol neondb_owner, no chainpulse_app.",
    );
  }

  const boss = new PgBoss({ connectionString, schema: PGBOSS_SCHEMA });
  boss.on("error", (err) => console.error("[pg-boss]", err));

  console.log(`Creando/actualizando el schema "${PGBOSS_SCHEMA}" con neondb_owner...`);
  await boss.start();

  console.log(`Creando la cola "${COLA_PURGA_HUELLA_ORIGEN}"...`);
  await boss.createQueue(COLA_PURGA_HUELLA_ORIGEN);

  await boss.stop({ graceful: false, timeout: 5000 });

  console.log("Otorgando permisos de datos a chainpulse_app sobre el schema pgboss...");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA "${PGBOSS_SCHEMA}" TO chainpulse_app`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${PGBOSS_SCHEMA}" TO chainpulse_app`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${PGBOSS_SCHEMA}" TO chainpulse_app`);
    // Cubre tablas que pg-boss cree mas adelante en este schema (por ejemplo
    // al agregar una cola nueva) sin tener que repetir los GRANT de arriba
    // a mano cada vez — siempre que se sigan creando con neondb_owner.
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA "${PGBOSS_SCHEMA}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chainpulse_app`,
    );
  } finally {
    await client.end();
  }

  console.log(
    "Listo. chainpulse_app ya puede usar boss.send()/fetch()/complete()/fail() en tiempo de ejecucion. " +
      "boss.createQueue() para una cola nueva sigue exigiendo correr este script de nuevo con neondb_owner.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
