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

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  // Despertar Neon con una consulta trivial antes del primer test real,
  // mismo criterio que aislamientoMultitenant.integration.test.ts.
  await prisma.$queryRaw`SELECT 1`;
  fixture = await crearFixtureCobertura("atomicidad");
  boss = await obtenerBoss();
}, 30000);

afterAll(async () => {
  if (fixture) await borrarFixtureCobertura(fixture);
  await cerrarBoss();
});

describe("confirmar + encolar -- atomicidad real contra Postgres (RLS, rol de runtime)", () => {
  it("commit conjunto: tras confirmar dentro de la transaccion atomica, estado=CONFIRMADA Y el job aparecen juntos", async () => {
    const importId = await crearImportacionPendiente();

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

    // El job realmente quedo en la cola de pg-boss (schema "pgboss",
    // fuera de RLS) -- boss.fetch() con el mismo nombre de cola que usa
    // la aplicacion real, nunca un SELECT directo a la tabla interna de
    // pg-boss (API publica, mismo criterio que job.ts).
    const jobs = await boss.fetch<{ importId: string; empresaId: string }>(COLA_IMPORTACION_CSV, { batchSize: 10 });
    const propio = jobs?.find((j) => j.data.importId === importId);
    expect(propio).toBeDefined();
    expect(propio?.data.empresaId).toBe(fixture.empresaId);
    if (propio) await boss.complete(COLA_IMPORTACION_CSV, propio.id); // limpieza -- no dejar el job colgado en la cola compartida
  }, 20000);

  it("rollback conjunto: si algo lanza DESPUES de las dos escrituras (todavia dentro de la transaccion), Postgres revierte TODO -- ni estado ni el job quedan", async () => {
    const importId = await crearImportacionPendiente();

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

    const jobs = await boss.fetch<{ importId: string }>(COLA_IMPORTACION_CSV, { batchSize: 50 });
    const propio = jobs?.find((j) => j.data.importId === importId);
    expect(propio).toBeUndefined(); // el INSERT del job tambien se revirtio -- nunca quedo "huerfano" en pgboss.job
    // Limpieza defensiva: si por algun motivo SI aparecieran jobs de otras
    // corridas en este fetch, completarlos para no dejar la cola sucia
    // entre pruebas de este archivo (fileParallelism:false, pero varias
    // pruebas comparten la misma cola).
    for (const j of jobs ?? []) await boss.complete(COLA_IMPORTACION_CSV, j.id);
  }, 20000);

  it("deduplicacion de pg-boss (mismo singletonKey=importId): el segundo encolado devuelve null, NUNCA lanza", async () => {
    const importId = await crearImportacionPendiente();

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

    const jobs = await boss.fetch<{ importId: string }>(COLA_IMPORTACION_CSV, { batchSize: 50 });
    const propios = (jobs ?? []).filter((j) => j.data.importId === importId);
    expect(propios).toHaveLength(1); // UN solo job real en la cola, nunca dos
    for (const j of jobs ?? []) await boss.complete(COLA_IMPORTACION_CSV, j.id);
  }, 20000);
});
