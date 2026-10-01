// Prueba de integracion -- atomicidad real de "persistir confirmacion +
// encolar el job" contra Postgres real (Incremento 4 Bloque B,
// condiciones de cierre de Alex 2026-09-25, punto 1):
//
//   "Atomicidad real: probar contra Postgres que confirmar y encolar se
//   confirman o revierten juntos, usando el rol de runtime con RLS.
//   Verificar también qué sucede si pg-boss no inserta un job por
//   deduplicación, sin lanzar un error."
//
// Corre SOLO con `npm run test:integration` en Windows -- necesita
// DATABASE_URL real Y la confirmacion explicita de entorno (ver
// entornoPruebasIntegracionCobertura.ts, mas estricta que las pruebas de
// integracion ya existentes: Alex pidio explicitamente que no alcance
// con que DATABASE_URL exista). Usa el rol de runtime real
// (chainpulse_app, DATABASE_URL) -- nunca neondb_owner -- para que la
// prueba realmente ejercite RLS, igual que en produccion.
//
// Que NO prueba esta prueba: no pasa por la ruta HTTP completa (eso es
// confirmarConcurrencia.integration.test.ts) ni por R2 (real ni
// mockeado) -- prueba exactamente el patron atomico en si mismo
// (tenantTransaction + encolarImportacionCsv con fromPrisma(tx)), que es
// lo que la ruta de confirmar usa tal cual. No corre en la Mac (no hay
// red a Neon en este entorno, ver README.md) -- Windows es quien
// confirma que esto realmente pasa.
//
// INCIDENTE REAL Y CORRECCION (Alex, 2026-09-29/30) -- aislamiento de
// esta prueba respecto de la cola compartida:
//
// Version anterior de este archivo: las 3 pruebas usaban boss.fetch()
// SIN acotar (`{ batchSize: 10 }` / `{ batchSize: 50 }`) sobre la cola
// real COLA_IMPORTACION_CSV para verificar "el job propio esta en la
// cola". boss.fetch() reclama (marca 'active') los N jobs MAS VIEJOS
// ELEGIBLES DE TODA LA COLA, sin importar que importacion los encolo --
// misma semantica FIFO del bug real de job.ts. La primera prueba
// ("commit conjunto") solo completaba el job propio (`propio`) tras el
// fetch, nunca los demas jobs que el mismo fetch() pudiera haber
// reclamado de paso. Resultado real: el job de la importacion
// 52aed226-1b0f-4550-bd30-fdd497ba0ed3 (27f5f447-2b9a-4794-ac66-
// 81e3b6e3f0cc), creado el 2026-09-29 y todavia en 'created' sin
// reclamar, quedo atrapado por este fetch() -- reclamado ('active',
// started_on seteado) pero JAMAS completado ni procesado, porque no era
// el job "propio" de esa corrida. Diagnosticado en modo solo lectura el
// 2026-09-29/30 (ver README.md "Estado").
//
// Correccion: NINGUNA prueba de este archivo llama mas a boss.fetch()
// (ni ninguna otra operacion que pueda reclamar/completar/fallar/borrar
// un job por lote sobre la cola compartida). Verificar "el job quedo en
// la cola" ahora es un SELECT de solo lectura sobre pgboss.job filtrado
// por name+singleton_key=importId (API publica de pg-boss para
// consultas: boss.getDb(), mismo mecanismo ya usado por
// confirmarNoDependeDeOtraConfirmacion.integration.test.ts para leer sin
// mutar) -- nunca reclama nada, asi que no puede tocar un job ajeno. La
// limpieza de cada prueba es un DELETE puntual por name+singleton_key,
// acotado siempre al importId que esa misma prueba creo -- nunca un
// batch, nunca "todo lo que devolvio el fetch" -- y corre en un
// `finally` para quedar garantizada aunque alguna aserción anterior
// falle (si no, un fallo de aserción salta la linea de limpieza y deja
// un job de prueba huerfano en la cola compartida).
//
// Job testigo ajeno: en vez de crearlo solo para una prueba final
// aislada, un unico job ajeno (de una importacion que NUNCA existe como
// ImportacionCsv real, a proposito) se encola una vez en beforeAll y
// queda presente en la cola compartida DURANTE las tres pruebas
// originales -- exactamente como el incidente real, donde el job ajeno
// ya estaba en la cola antes y durante la corrida que lo atrapo. Las
// tres pruebas verifican, cada una al terminar, que ese job testigo
// sigue exactamente como se encolo (verificarJobAjenoIntacto()): nunca
// reclamado, completado, fallado ni borrado por nada de este archivo. Se
// limpia una sola vez, en afterAll, junto con el resto del fixture.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fromPrisma } from "pg-boss";
import { prisma } from "../../../prisma/client";
import { tenantClient } from "../../../prisma/tenantClient";
import { tenantTransaction } from "../../../prisma/tenantTransaction";
import { encolarImportacionCsv, COLA_IMPORTACION_CSV } from "../job";
import { obtenerBoss, cerrarBoss } from "../../../jobs/pgBoss";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureCobertura,
  borrarFixtureCobertura,
  TX_OPTIONS_INTEGRACION,
  type FixtureCoberturaIntegracion,
} from "./entornoPruebasIntegracionCobertura";

let fixture: FixtureCoberturaIntegracion;
let boss: Awaited<ReturnType<typeof obtenerBoss>>;
let importIdAjeno: string;

async function crearImportacionPendiente(): Promise<string> {
  const importacion = await tenantTransaction<{ id: string }>(
    fixture.empresaId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    (tx: any) =>
      tx.importacionCsv.create({
        data: {
          cadenaId: fixture.cadenaId,
          definicionKpiId: fixture.definicionKpiId,
          objetoStorageKey: `integracion/atomicidad/${randomUUID()}.bin`,
          estado: "PENDIENTE_REVISION",
        },
        select: { id: true },
      }),
    TX_OPTIONS_INTEGRACION,
  );
  return importacion.id;
}

// Lectura de solo lectura por singleton_key=importId -- NUNCA reclama
// (no es fetch()), asi que nunca puede tocar un job ajeno. Mismo
// mecanismo (boss.getDb().executeSql) que ya usa
// confirmarNoDependeDeOtraConfirmacion.integration.test.ts para leer sin
// mutar pgboss.job.
async function leerJobsPorSingletonKey(importId: string): Promise<Array<{ id: string; data: unknown }>> {
  const fila = await boss
    .getDb()
    .executeSql(`SELECT id, data FROM pgboss.job WHERE name = $1 AND singleton_key = $2`, [COLA_IMPORTACION_CSV, importId]);
  return fila.rows as Array<{ id: string; data: unknown }>;
}

// Limpieza puntual -- SIEMPRE acotada por name+singleton_key=importId
// (el importId que la propia prueba creo), nunca un batch ni "todo lo
// que devolvio un fetch()". Un DELETE directo (en vez de
// boss.complete()) porque estas pruebas nunca simulan el procesamiento
// real -- solo verifican que el job aterrizo/no aterrizo en la cola.
// Idempotente: si no hay filas que coincidan (p.ej. la prueba de
// rollback, donde no deberia haberse creado nada), no hace nada.
async function borrarJobDePrueba(importId: string): Promise<void> {
  await boss.getDb().executeSql(`DELETE FROM pgboss.job WHERE name = $1 AND singleton_key = $2`, [COLA_IMPORTACION_CSV, importId]);
}

// Verifica que el job testigo ajeno (encolado una sola vez en beforeAll)
// sigue EXACTAMENTE como se encolo -- nunca reclamado (state='created'),
// nunca completado/fallado (output=null), nunca se le toco
// started_on/retry_count. Se llama al final de cada una de las tres
// pruebas originales, ademas de que sigue en la cola durante todas ellas
// (nunca se borra hasta afterAll).
async function verificarJobAjenoIntacto(): Promise<void> {
  const fila = await boss
    .getDb()
    .executeSql(`SELECT state, started_on, retry_count, output FROM pgboss.job WHERE name = $1 AND singleton_key = $2`, [
      COLA_IMPORTACION_CSV,
      importIdAjeno,
    ]);
  expect(fila.rows).toHaveLength(1);
  expect(fila.rows[0].state).toBe("created");
  expect(fila.rows[0].started_on).toBeNull();
  expect(fila.rows[0].retry_count).toBe(0);
  expect(fila.rows[0].output).toBeNull();
}

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  // Despertar Neon con una consulta trivial antes del primer test real,
  // mismo criterio que aislamientoMultitenant.integration.test.ts.
  await prisma.$queryRaw`SELECT 1`;
  fixture = await crearFixtureCobertura("atomicidad");
  boss = await obtenerBoss();

  // Job testigo ajeno -- simula un job real de OTRA importacion/corrida,
  // ya pendiente en la cola compartida ANTES y DURANTE las pruebas de
  // este archivo (exactamente la situacion real: el job de la
  // importacion 52aed226-1b0f-4550-bd30-fdd497ba0ed3, creado el
  // 2026-09-29, seguia 'created' sin reclamar cuando esta suite corrio).
  // Nunca se crea una ImportacionCsv real para el, a proposito -- si
  // CUALQUIER prueba de este archivo llegara a tocarlo, seria
  // indistinguible de "nunca tocado" salvo por verificarJobAjenoIntacto().
  importIdAjeno = `import-ajeno-atomicidad-${randomUUID()}`;
  await encolarImportacionCsv(boss, { importId: importIdAjeno, empresaId: fixture.empresaId });
}, 30000);

afterAll(async () => {
  if (boss && importIdAjeno) await borrarJobDePrueba(importIdAjeno);
  if (fixture) await borrarFixtureCobertura(fixture);
  await cerrarBoss();
});

describe("confirmar + encolar -- atomicidad real contra Postgres (RLS, rol de runtime)", () => {
  it("commit conjunto: tras confirmar dentro de la transaccion atomica, estado=CONFIRMADA Y el job aparecen juntos", async () => {
    const importId = await crearImportacionPendiente();

    try {
      await tenantTransaction(fixture.empresaId, async (tx) => {
        await tx.importacionCsv.update({
          where: { id: importId },
          data: {
            estado: "CONFIRMADA",
            confirmadaPorId: fixture.adminId,
            confirmadaEn: new Date(),
            fuenteConsumo: "prueba de integracion",
            periodoReferenciaConsumoInicio: new Date("2026-09-01T00:00:00.000Z"),
            periodoReferenciaConsumoFin: new Date("2026-09-30T00:00:00.000Z"),
          },
        });
        await encolarImportacionCsv(boss, { importId, empresaId: fixture.empresaId }, { db: fromPrisma(tx) });
      });

      const importacion = await tenantClient(fixture.empresaId).importacionCsv.findUnique({ where: { id: importId } });
      expect(importacion?.estado).toBe("CONFIRMADA");
      expect(importacion?.confirmadaEn).not.toBeNull();

      // El job realmente quedo en la cola de pg-boss -- SELECT de solo
      // lectura acotado por singleton_key=importId (nunca boss.fetch(),
      // ver el comentario de cabecera de este archivo: un fetch() sin
      // acotar puede reclamar jobs ajenos de la cola compartida).
      const jobs = await leerJobsPorSingletonKey(importId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.data).toMatchObject({ importId, empresaId: fixture.empresaId });
    } finally {
      // Limpieza garantizada -- acotada a este importId, corre aunque
      // una aserción de arriba haya fallado.
      await borrarJobDePrueba(importId);
    }

    await verificarJobAjenoIntacto();
  }, 20000);

  it("rollback conjunto: si algo lanza DESPUES de las dos escrituras (todavia dentro de la transaccion), Postgres revierte TODO -- ni estado ni el job quedan", async () => {
    const importId = await crearImportacionPendiente();

    try {
      await expect(
        tenantTransaction(fixture.empresaId, async (tx) => {
          await tx.importacionCsv.update({
            where: { id: importId },
            data: {
              estado: "CONFIRMADA",
              confirmadaPorId: fixture.adminId,
              confirmadaEn: new Date(),
              fuenteConsumo: "prueba de integracion (rollback)",
              periodoReferenciaConsumoInicio: new Date("2026-09-01T00:00:00.000Z"),
              periodoReferenciaConsumoFin: new Date("2026-09-30T00:00:00.000Z"),
            },
          });
          await encolarImportacionCsv(boss, { importId, empresaId: fixture.empresaId }, { db: fromPrisma(tx) });
          // Fallo forzado -- simula un crash del proceso a mitad de camino,
          // DESPUES de que ambas escrituras ya corrieron como sentencias
          // dentro de la transaccion todavia abierta.
          throw new Error("fallo forzado de prueba -- nunca deberia dejar rastro");
        }),
      ).rejects.toThrow("fallo forzado de prueba");

      const importacion = await tenantClient(fixture.empresaId).importacionCsv.findUnique({ where: { id: importId } });
      expect(importacion?.estado).toBe("PENDIENTE_REVISION"); // exactamente como estaba, nunca CONFIRMADA a medias
      expect(importacion?.confirmadaEn).toBeNull();

      // El INSERT del job tambien se revirtio -- nunca quedo "huerfano" en
      // pgboss.job. SELECT de solo lectura, nunca fetch() (no hay nada que
      // reclamar ni limpiar si el rollback funciono).
      const jobs = await leerJobsPorSingletonKey(importId);
      expect(jobs).toHaveLength(0);
    } finally {
      // Limpieza garantizada -- no-op si el rollback funciono (nada que
      // borrar); si la aserción de arriba fallo porque SI quedo un job,
      // igual queda limpio para la proxima corrida.
      await borrarJobDePrueba(importId);
    }

    await verificarJobAjenoIntacto();
  }, 20000);

  it("deduplicacion de pg-boss (mismo singletonKey=importId): el segundo encolado devuelve null, NUNCA lanza", async () => {
    const importId = await crearImportacionPendiente();

    try {
      // Primer encolado -- real, fuera de una transaccion (pool propio de
      // PgBoss), directo, sin pasar por confirmar -- alcanza para el
      // proposito de esta prueba (el comportamiento de dedup de pg-boss no
      // depende de como se llego al primer send()).
      const primerJobId = await encolarImportacionCsv(boss, { importId, empresaId: fixture.empresaId });
      expect(primerJobId).not.toBeNull();

      // Segundo encolado, MISMO importId (mismo singletonKey), mientras el
      // primer job sigue "created" (nunca se hizo fetch/complete/fail
      // sobre el) -- pg-boss debe deduplicar devolviendo null, sin lanzar.
      await expect(
        encolarImportacionCsv(boss, { importId, empresaId: fixture.empresaId }),
      ).resolves.toBeNull();

      const jobs = await leerJobsPorSingletonKey(importId);
      expect(jobs).toHaveLength(1); // UN solo job real en la cola, nunca dos
    } finally {
      // Limpieza garantizada -- acotada a este importId, corre aunque
      // una aserción de arriba haya fallado.
      await borrarJobDePrueba(importId);
    }

    await verificarJobAjenoIntacto();
  }, 20000);
});
