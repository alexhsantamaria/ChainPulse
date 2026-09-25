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
// Incremento 4 Bloque B (import de CSV, Cobertura) -- exactamente la cola
// que el comentario de cabecera de este script ya avisaba que faltaria
// agregar aca. Confirmado real contra Postgres en Windows (2026-09-25):
// boss.send(COLA_IMPORTACION_CSV, ...) fallaba con "Queue
// procesar-importacion-csv does not exist" -- este script nunca la habia
// creado, la Mac no tiene red a Neon para haberlo notado antes.
import { COLA_IMPORTACION_CSV } from "../src/infra/kpis/cobertura/job";

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

  // policy: "exclusive" (Alex + Windows, 2026-09-25 -- primera corrida
  // real de confirmarAtomicidad.integration.test.ts): sin `policy`,
  // pg-boss usa el default "standard", que NO tiene ningun indice unico
  // parcial de deduplicacion (ver node_modules/pg-boss/dist/types.d.ts,
  // JSDoc de QueuePolicy) -- el segundo encolarImportacionCsv() con el
  // mismo singletonKey=importId devolvia un id real en vez de null, la
  // garantia que documenta encolarImportacionCsv() ("evita que dos
  // confirmaciones... encolen dos jobs en paralelo") nunca se cumplia.
  // "exclusive" es la unica policy que dedupe cruzando AMBOS estados no
  // terminales a la vez (created Y active, via el indice parcial unico
  // job_i6 sobre (name, singleton_key) WHERE state <= 'active') -- exactamente
  // lo que hace falta aca, porque el disparo inmediato de la ruta de
  // confirmar puede llevar el job de created a active DENTRO del mismo
  // ciclo en el que una segunda confirmacion (doble click, reintento de
  // red) podria intentar encolar de nuevo. "short" (dedup solo en
  // created) o "stately" (dedup por estado, permite 1 created + 1 active
  // a la vez) dejan pasar exactamente esa ventana -- no alcanzan.
  console.log(`Creando la cola "${COLA_IMPORTACION_CSV}" (policy=exclusive)...`);
  await boss.createQueue(COLA_IMPORTACION_CSV, { policy: "exclusive" });

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

    // Correccion retroactiva de policy -- boss.createQueue() de arriba es
    // "INSERT ... ON CONFLICT DO NOTHING" (ver create_queue() en
    // node_modules/pg-boss/dist/plans.js): si la cola YA existe (como
    // paso en Windows, creada dos veces antes de este fix con la policy
    // default), createQueue() NO actualiza su policy -- es un no-op
    // silencioso. boss.updateQueue() tampoco sirve: lanza explicitamente
    // "queue policy cannot be changed after creation" si se le pasa
    // `policy` (ver manager.js). Un UPDATE crudo sobre la fila de
    // pgboss.queue es la unica forma de aplicar el cambio a una cola
    // preexistente -- no toca ninguna fila de pgboss.job (ningun job
    // encolado se pierde ni se reprocesa), y los indices parciales de
    // cada policy (job_i1/i2/i3/i6) ya existen en el schema desde el
    // primer boss.start() (createTableJobIndexes() los crea todos, sin
    // particionamiento por cola) -- solo faltaba que ESTA fila de
    // "queue" declarara la policy correcta para que las inserciones
    // NUEVAS la usen. Idempotente: no-op si ya quedo en "exclusive".
    console.log(`Corrigiendo la policy de "${COLA_IMPORTACION_CSV}" a "exclusive" (por si la cola ya existia)...`);
    await client.query(
      `UPDATE "${PGBOSS_SCHEMA}".queue SET policy = 'exclusive', updated_on = now() WHERE name = $1 AND policy IS DISTINCT FROM 'exclusive'`,
      [COLA_IMPORTACION_CSV],
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
