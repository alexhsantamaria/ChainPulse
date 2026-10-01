// Prueba de integracion -- reclamarJobImportacionCsvPorId() contra
// Postgres real (Alex, 2026-09-29, revision del script de desbloqueo
// puntual de 52aed226-1b0f-4550-bd30-fdd497ba0ed3): "agregar pruebas
// contra Postgres que comprueben que un jobId, empresa o data.importId
// incorrectos no modifican ningun job."
//
// Las pruebas unitarias de job.test.ts (mockeadas) ya prueban jobId y
// empresa incorrectos con un fake de boss.getDb().executeSql() que
// simula la semantica del UPDATE. Lo que NINGUNA prueba mockeada puede
// demostrar es el caso "data.importId incorrecto PERO singleton_key
// coincide" -- la funcion real solo recibe un unico valor de importId
// que alimenta ambas condiciones a la vez (ver encolarImportacionCsv()),
// asi que un mock no puede desincronizarlas por su cuenta. Esta prueba
// corrompe data.importId de forma independiente, DIRECTO en Postgres,
// dejando singleton_key intacto -- la unica forma real de aislar ese
// condicional especifico (defensa en profundidad, ver el comentario de
// la funcion en job.ts) y demostrar que de verdad esta ahi.
//
// Cada escenario deja EXACTAMENTE un job real encolado (via
// encolarImportacionCsv(), el mismo camino que usa la app) y verifica,
// releyendolo de pgboss.job, que sigue intacto (state='created',
// started_on=null, retry_count=0) despues de un intento de reclamo con
// un dato incorrecto -- nunca confia solo en el valor de retorno de la
// funcion. Un ultimo caso de control ("todo coincide") prueba que el
// mismo UPDATE SI reclama cuando jobId+cola+importId+empresa+
// elegibilidad son exactamente los correctos.
//
// Corre SOLO con `npm run test:integration` en Windows -- misma guardia
// que las demas pruebas de integracion de Cobertura (ver
// entornoPruebasIntegracionCobertura.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { obtenerBoss, cerrarBoss } from "../../../jobs/pgBoss";
import { encolarImportacionCsv, reclamarJobImportacionCsvPorId, COLA_IMPORTACION_CSV } from "../job";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureCobertura,
  borrarFixtureCobertura,
  type FixtureCoberturaIntegracion,
} from "./entornoPruebasIntegracionCobertura";

let fixture: FixtureCoberturaIntegracion;
let boss: Awaited<ReturnType<typeof obtenerBoss>>;

// Jobs reales que cada prueba deja pendientes en pgboss.job -- se borran
// en afterEach, SOLO despues de que cada test ya releyo y confirmo su
// estado (intacto o reclamado). Son jobs sinteticos creados por esta
// misma corrida (singleton_key con randomUUID(), nunca choca con datos
// reales) -- un DELETE puntual por id, nunca un borrado masivo de la
// cola. borrarFixtureCobertura() NO los toca (pgboss.job vive en un
// schema separado, sin FK hacia importaciones_csv -- ver el comentario
// de drenarColaImportacionCsv.ts), asi que esta limpieza puntual es
// necesaria para no dejarlos huerfanos.
const jobIdsCreados: string[] = [];

async function encolarJobDePrueba(importId: string): Promise<string> {
  await encolarImportacionCsv(boss, { importId, empresaId: fixture.empresaId });
  const fila = await boss
    .getDb()
    .executeSql(`SELECT id FROM pgboss.job WHERE name = $1 AND singleton_key = $2`, [COLA_IMPORTACION_CSV, importId]);
  expect(fila.rows).toHaveLength(1);
  const jobId = fila.rows[0].id as string;
  jobIdsCreados.push(jobId);
  return jobId;
}

async function leerJob(jobId: string) {
  const fila = await boss
    .getDb()
    .executeSql(`SELECT state, started_on, retry_count FROM pgboss.job WHERE id = $1`, [jobId]);
  return fila.rows[0] as { state: string; started_on: string | null; retry_count: number } | undefined;
}

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  fixture = await crearFixtureCobertura("reclamo-por-id");
  boss = await obtenerBoss();
}, 30000);

afterEach(async () => {
  while (jobIdsCreados.length > 0) {
    const jobId = jobIdsCreados.pop()!;
    await boss.getDb().executeSql(`DELETE FROM pgboss.job WHERE id = $1`, [jobId]);
  }
});

afterAll(async () => {
  if (fixture) await borrarFixtureCobertura(fixture);
  await cerrarBoss();
});

describe("reclamarJobImportacionCsvPorId -- el UPDATE atomico no modifica ninguna fila si algo no coincide (Postgres real)", () => {
  it("jobId incorrecto -- 0 filas afectadas, el job real queda intacto", async () => {
    const importId = `import-reclamo-jobid-${randomUUID()}`;
    const jobIdReal = await encolarJobDePrueba(importId);

    const resultado = await reclamarJobImportacionCsvPorId(boss, {
      importId,
      empresaId: fixture.empresaId,
      jobId: randomUUID(), // no existe -- cola/importId/empresa SI son correctos
    });

    expect(resultado).toEqual({ procesado: false });

    const filaDespues = await leerJob(jobIdReal);
    expect(filaDespues?.state).toBe("created");
    expect(filaDespues?.started_on).toBeNull();
    expect(filaDespues?.retry_count).toBe(0);
  }, 30000);

  it("empresaId incorrecto -- 0 filas afectadas, el job real queda intacto", async () => {
    const importId = `import-reclamo-empresa-${randomUUID()}`;
    const jobIdReal = await encolarJobDePrueba(importId);

    const resultado = await reclamarJobImportacionCsvPorId(boss, {
      importId,
      empresaId: randomUUID(), // no coincide con data.empresaId -- jobId/importId SI son correctos
      jobId: jobIdReal,
    });

    expect(resultado).toEqual({ procesado: false });

    const filaDespues = await leerJob(jobIdReal);
    expect(filaDespues?.state).toBe("created");
    expect(filaDespues?.started_on).toBeNull();
    expect(filaDespues?.retry_count).toBe(0);
  }, 30000);

  it("data.importId incorrecto -- AUNQUE el jobId y el singleton_key SI coincidan -- 0 filas afectadas, el job real queda intacto", async () => {
    const importId = `import-reclamo-dataimportid-${randomUUID()}`;
    const jobIdReal = await encolarJobDePrueba(importId);

    // Corrompe SOLO data.importId, dejando singleton_key (que sigue
    // valiendo `importId`) intacto -- asi esta prueba aisla el
    // condicional data ->> 'importId' = $3 del que ya cubre
    // singleton_key = $3 (misma posicion de parametro, pero son dos
    // columnas fisicas distintas: singleton_key y el campo data jsonb).
    await boss
      .getDb()
      .executeSql(`UPDATE pgboss.job SET data = jsonb_set(data, '{importId}', to_jsonb($1::text)) WHERE id = $2`, [
        `otra-importacion-${randomUUID()}`,
        jobIdReal,
      ]);

    const resultado = await reclamarJobImportacionCsvPorId(boss, {
      importId, // el importId real -- SI coincide con singleton_key
      empresaId: fixture.empresaId,
      jobId: jobIdReal, // SI coincide
    });

    expect(resultado).toEqual({ procesado: false });

    const filaDespues = await leerJob(jobIdReal);
    expect(filaDespues?.state).toBe("created");
    expect(filaDespues?.started_on).toBeNull();
    expect(filaDespues?.retry_count).toBe(0);
  }, 30000);

  it("control -- jobId + cola + importId + empresa + elegibilidad coinciden todos -- SI reclama exactamente ese job", async () => {
    const importId = `import-reclamo-ok-${randomUUID()}`;
    const jobIdReal = await encolarJobDePrueba(importId);

    const resultado = await reclamarJobImportacionCsvPorId(boss, {
      importId,
      empresaId: fixture.empresaId,
      jobId: jobIdReal,
    });

    // Sin ImportacionCsv real para este importId (a proposito, igual que
    // el job "viejo" de confirmarNoDependeDeOtraConfirmacion.integration.test.ts)
    // -- procesarUnaImportacionCsv() pega en su primer guard ("if
    // (!importacion) return") y no lanza, asi que el reclamo se completa
    // igual (boss.complete()), sin necesitar R2/cifrado reales.
    expect(resultado).toEqual({ procesado: true });

    const filaDespues = await leerJob(jobIdReal);
    expect(filaDespues?.state).toBe("completed");
  }, 30000);
});
