// Script de mantenimiento -- drena manualmente COLA_IMPORTACION_CSV
// ("procesar-importacion-csv") de pg-boss (Incremento 4 Bloque B,
// Cobertura). Pensado para UN USO PUNTUAL: limpiar los jobs que
// confirmarAtomicidad.integration.test.ts (prueba de deduplicacion) dejo
// colgados en corridas de Windows ANTERIORES al fix de policy
// (scripts/bootstrapPgBoss.ts, 2026-09-25) -- antes de ese fix, la cola
// no deduplicaba, asi que una asercion fallida a mitad de test (que corta
// la ejecucion ANTES de la limpieza propia del test, ver el comentario de
// esa prueba) podia dejar uno o mas jobs "created" sin boss.complete().
//
// Alex, 2026-09-25: "Cualquier limpieza debe limitarse a los IDs creados
// por estas pruebas, nunca vaciar la cola compartida." -- por eso este
// script NUNCA hace un DELETE crudo ni vacia la cola: llama exactamente
// a procesarImportacionesCsv() (src/infra/kpis/cobertura/job.ts), el
// mismo codigo de produccion que ya usan tanto el disparo inmediato de
// la ruta de confirmar como el cron de respaldo
// (src/app/api/internal/jobs/run/route.ts). Esa funcion es segura de
// llamar sobre CUALQUIER job real de esta cola, no solo los de prueba:
//   - Un job de una importacion real (que todavia exista en
//     "importaciones_csv") se procesa exactamente como lo haria el cron
//     -- nunca se "pierde" ni se descarta, es lo que la cola existe para
//     hacer.
//   - Un job huerfano de prueba (su ImportacionCsv ya no existe porque
//     borrarFixtureCobertura() borro en cascada la Empresa sintetica al
//     final de la corrida -- pgboss.job vive en un schema separado, sin
//     FK hacia esa tabla, asi que el borrado en cascada NUNCA lo toca)
//     cae en el primer guard de procesarUnaImportacionCsv() ("if
//     (!importacion) return"), un no-op silencioso y sin error -- boss lo
//     marca complete() y desaparece de la cola. Ningun DELETE manual,
//     ningun riesgo de borrar el job equivocado.
//
// Uso:
//   npm run jobs:drenar-importaciones-csv
//
// Usa DATABASE_URL (rol de runtime chainpulse_app) -- el mismo rol que ya
// usa procesarImportacionesCsv() en produccion, nunca neondb_owner (esto
// no es DDL, es exactamente el trabajo normal de la cola).
import "./_cargarEnv";
import { Client } from "pg";
import { obtenerBoss, cerrarBoss } from "../src/infra/jobs/pgBoss";
import { procesarImportacionesCsv, COLA_IMPORTACION_CSV } from "../src/infra/kpis/cobertura/job";

const PGBOSS_SCHEMA = "pgboss";
const TAMANO_LOTE = 20;
const MAX_ITERACIONES = 50; // salvaguarda -- nunca un loop infinito si algo queda re-encolandose

async function contarPorEstado(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Solo lectura -- SELECT/COUNT, nunca DELETE. GROUP BY state para ver
    // exactamente que hay antes/despues de drenar (created/active/retry/
    // completed/failed).
    const { rows } = await client.query(
      `SELECT state, count(*)::int AS cantidad FROM "${PGBOSS_SCHEMA}".job WHERE name = $1 GROUP BY state ORDER BY state`,
      [COLA_IMPORTACION_CSV],
    );
    if (rows.length === 0) {
      console.log(`  (sin filas en pgboss.job para "${COLA_IMPORTACION_CSV}")`);
      return;
    }
    for (const fila of rows as Array<{ state: string; cantidad: number }>) {
      console.log(`  ${fila.state}: ${fila.cantidad}`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no esta configurado (ver .env.example).");
  }

  console.log(`Estado de "${COLA_IMPORTACION_CSV}" ANTES de drenar:`);
  await contarPorEstado(connectionString);

  const boss = await obtenerBoss();
  let totalProcesados = 0;
  for (let i = 0; i < MAX_ITERACIONES; i += 1) {
    const resultado = await procesarImportacionesCsv(boss, TAMANO_LOTE);
    totalProcesados += resultado.procesados;
    if (resultado.procesados === 0) break;
    console.log(`Lote ${i + 1}: ${resultado.procesados} job(s) procesado(s) (completados o fallados segun corresponda).`);
  }
  await cerrarBoss();

  console.log(`Total procesado en esta corrida: ${totalProcesados}.`);
  console.log(`Estado de "${COLA_IMPORTACION_CSV}" DESPUES de drenar:`);
  await contarPorEstado(connectionString);
  console.log(
    "Listo. Los jobs huerfanos de pruebas (ImportacionCsv ya borrada) quedaron completed sin efecto. " +
      "Los jobs reales, si los habia, se procesaron normalmente -- igual que el cron.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
