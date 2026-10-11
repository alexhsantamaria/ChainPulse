// Prueba de integracion -- regresion directa del bug real encontrado por
// Alex (2026-09-29, importacion 52aed226-1b0f-4550-bd30-fdd497ba0ed3):
// "el disparo inmediato de una confirmacion podia procesar el job de
// OTRA importacion en vez del propio, si habia un job mas viejo
// pendiente en la misma cola compartida."
//
// Reproducido con pgboss.job real (Windows, consulta de Alex):
//   - Job de 52aed226 (singleton_key=52aed226-...): created_on 19:56:41,
//     state='created', NUNCA fetcheado.
//   - Job de OTRA importacion (creado 22 minutos antes, ya en 'retry'):
//     started_on 19:56:42 -- 0.6s DESPUES de que Alex confirmara
//     52aed226. Ese fue el job que proceso el disparo inmediato de
//     52aed226, porque procesarImportacionesCsv(boss, 1) hacia
//     boss.fetch() sobre TODA la cola ("el mas viejo primero"), sin
//     importar que importacion disparo la llamada.
//
// Fix: la ruta de confirmar ahora usa procesarImportacionCsvPropia()
// (job.ts) -- reclama por singleton_key=importId, nunca por "el mas
// viejo de la cola". Esta prueba reproduce el escenario exacto contra
// Postgres real: un job MAS VIEJO de otra importacion, ya pendiente en
// la cola, ANTES de confirmar la importacion de esta prueba -- y
// verifica dos cosas que ninguna prueba unitaria (mockeada) puede
// demostrar por si sola:
//   (a) la importacion de esta prueba se procesa igual (CONFIRMADA +
//       procesadaEn), sin depender de ninguna otra confirmacion.
//   (b) el job viejo/ajeno queda EXACTAMENTE como estaba -- nunca
//       reclamado, nunca tocado -- confirmando que
//       procesarImportacionCsvPropia() no tiene forma de robarle el
//       turno a otra importacion.
//
// Corre SOLO con `npm run test:integration` en Windows -- misma guardia
// que las demas pruebas de integracion de Cobertura, ver
// entornoPruebasIntegracionCobertura.ts.
//
// RONDA 14 (2026-10-07, seguridad del arnes de pruebas -- hallazgo de la
// revision de solo lectura de Ronda 13): esta prueba encolaba el job
// "importIdViejo" (linea de abajo) y nunca lo borraba ni cerraba la
// instancia de pg-boss -- cada corrida dejaba una fila huerfana en
// pgboss.job (estado 'created') y una conexion sin cerrar. Corregido:
// limpieza puntual del job (mismo mecanismo exacto que
// confirmarAtomicidad.integration.test.ts, DELETE acotado por
// name+singleton_key, nunca un batch) en un `finally` propio del test, y
// cierre de pg-boss encadenado en `finally` dentro de afterAll -- ambos
// corren aunque la aserción o el fixture fallen, y cerrarBoss() es
// idempotente (no-op si nunca se obtuvo boss), asi que es seguro
// llamarla siempre.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { obtenerBoss, cerrarBoss } from "../../../jobs/pgBoss";
import { encolarImportacionCsv, COLA_IMPORTACION_CSV } from "../job";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureCobertura,
  borrarFixtureCobertura,
  TX_OPTIONS_INTEGRACION,
  type FixtureCoberturaIntegracion,
} from "./entornoPruebasIntegracionCobertura";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

// R2/cifrado mockeados para devolver un CSV real en claro -- mismo
// criterio que confirmarColumnasSospechosasReconocidas.integration.test.ts
// (el archivo nunca se sube ni se cifra de verdad en esta prueba, eso ya
// esta cubierto en otro lado).
const descargarObjetoMock = vi.fn().mockResolvedValue(Buffer.from("contenido-cifrado-dummy"));
vi.mock("@/infra/storage/r2", () => ({
  ClienteAlmacenamientoR2: vi.fn().mockImplementation(() => ({ descargarObjeto: descargarObjetoMock })),
}));

const MAPEO = {
  sku: "sku",
  ubicacion: "ubicacion",
  fechaCorte: "fecha",
  inventarioDisponible: "inventario",
  unidadInventario: "unidad_inv",
  consumoDiarioEsperado: "consumo",
  unidadConsumoDiario: "unidad_cons",
};
const ENCABEZADOS_REALES = Object.values(MAPEO);
const CSV_VALIDO =
  "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons\n" +
  "SKU-NODEP,LIMA (integracion no-depende),2026-09-24,100,unidad,10,unidad\n";

vi.mock("@/infra/storage/cifradoObjeto", () => ({
  obtenerClaveMaestraPorId: vi.fn().mockReturnValue(Buffer.alloc(32)),
  desenvolverDek: vi.fn().mockReturnValue(Buffer.alloc(32)),
  descifrarContenido: vi.fn().mockImplementation(() => Buffer.from(CSV_VALIDO)),
}));

let fixture: FixtureCoberturaIntegracion;
let boss: Awaited<ReturnType<typeof obtenerBoss>> | undefined;

// RONDA 14 -- limpieza puntual del job que esta prueba encola: mismo
// mecanismo y mismo nombre de funcion que
// confirmarAtomicidad.integration.test.ts, DELETE acotado por
// name+singleton_key=importId, nunca un batch ni "todo lo que devolvio
// un fetch()". No-op si boss todavia no se obtuvo (nada que borrar).
async function borrarJobDePrueba(importId: string): Promise<void> {
  if (!boss) return;
  await boss.getDb().executeSql(`DELETE FROM pgboss.job WHERE name = $1 AND singleton_key = $2`, [COLA_IMPORTACION_CSV, importId]);
}

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  fixture = await crearFixtureCobertura("no-depende-de-otra-confirmacion");
}, 30000);

// RONDA 14 -- cierre garantizado: el cierre de pg-boss corre en su propio
// `finally`, encadenado antes del borrado del fixture, para que un fallo
// en uno de los dos pasos nunca salte al otro. cerrarBoss() es
// idempotente (no-op si nunca se obtuvo boss), asi que es seguro
// llamarla siempre, incluso si beforeAll fallo antes de crear el
// fixture.
afterAll(async () => {
  try {
    await cerrarBoss();
  } finally {
    if (fixture) await borrarFixtureCobertura(fixture);
  }
});

describe("el disparo inmediato de una confirmacion procesa SU PROPIO job, sin depender de otra confirmacion", () => {
  it("con un job MAS VIEJO de otra importacion ya pendiente en la misma cola, la importacion de esta prueba se procesa igual -- y el job viejo queda intacto, nunca reclamado", async () => {
    const { tenantTransaction } = await import("../../../prisma/tenantTransaction");
    const { tenantClient } = await import("../../../prisma/tenantClient");

    boss = await obtenerBoss();

    // 1. Job VIEJO de otra importacion (nunca creada como ImportacionCsv
    //    real a proposito -- si por algun bug ESTE test lo tocara, el
    //    guard "if (!importacion) return" de procesarUnaImportacionCsv
    //    lo dejaria en un estado indistinguible de "nunca tocado" por las
    //    aserciones de mas abajo, asi que la unica forma de que la
    //    asercion (b) pase es que de verdad nunca se reclame). singleton_key
    //    propio, en la MISMA cola -- encolado ANTES de la importacion de
    //    esta prueba, asi que su created_on queda mas viejo (mismo
    //    ordenamiento que uso boss.fetch() en el bug real).
    const importIdViejo = `import-viejo-pendiente-${randomUUID()}`;
    try {
    await encolarImportacionCsv(boss, { importId: importIdViejo, empresaId: fixture.empresaId });

    // 2. La importacion REAL de esta prueba -- PENDIENTE_REVISION, con
    //    metadata de subida/cifrado (mismo criterio que
    //    confirmarConcurrencia.integration.test.ts).
    const importId = await tenantTransaction<{ id: string }>(
      fixture.empresaId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (tx: any) =>
        tx.importacionCsv.create({
          data: {
            cadenaId: fixture.cadenaId,
            definicionKpiId: fixture.definicionKpiId,
            objetoStorageKey: `integracion/no-depende/${randomUUID()}.bin`,
            estado: "PENDIENTE_REVISION",
            mapeoColumnas: { encabezados: ENCABEZADOS_REALES, propuesto: MAPEO, confirmado: null },
            cifradoVersion: 1,
            cifradoClaveId: "integracion-no-depende-dummy",
            cifradoDek: "ZHVtbXk=",
            cifradoDekIv: "ZHVtbXk=",
            cifradoDekAuthTag: "ZHVtbXk=",
          },
          select: { id: true },
        }),
      TX_OPTIONS_INTEGRACION,
    ).then((r) => r.id);

    requireAdminMock.mockResolvedValue({
      sesion: { usuarioId: fixture.adminId, empresaId: fixture.empresaId, rol: "ADMINISTRADOR", email: "x@x.test" },
    });

    const { POST } = await import("../../../../app/api/kpis/cobertura/importaciones/[id]/confirmar/route");
    const request = new Request(`https://x.test/api/kpis/cobertura/importaciones/${importId}/confirmar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mapeoColumnas: MAPEO,
        columnasSospechosasReconocidas: [],
        estrategia: "CARGA_PARCIAL",
        fuenteConsumo: "prueba de integracion (no depende de otra confirmacion)",
        periodoReferenciaConsumoInicio: "2026-09-01",
        periodoReferenciaConsumoFin: "2026-09-30",
        soloVistaPrevia: false,
      }),
    });
    const contexto = { params: Promise.resolve({ id: importId }) };

    // El disparo inmediato (procesarImportacionCsvPropia, real, dentro
    // de la propia ruta) corre DENTRO de este await.
    const respuesta = await POST(request, contexto);
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ ok: true, importId });

    // (a) La importacion de esta prueba se proceso -- nunca dependio de
    //     que otra confirmacion "le pasara el turno".
    const importacionFinal = await tenantClient(fixture.empresaId).importacionCsv.findUnique({ where: { id: importId } });
    expect(importacionFinal?.estado).toBe("CONFIRMADA");
    expect(importacionFinal?.procesadaEn).not.toBeNull();
    expect(importacionFinal?.filasConError).toBe(0);

    const observacion = await tenantClient(fixture.empresaId).observacionCobertura.findFirst({
      where: { cadenaId: fixture.cadenaId, sku: "SKU-NODEP" },
    });
    expect(observacion).not.toBeNull();

    // (b) El job VIEJO/ajeno sigue exactamente como se encolo -- nunca
    //     reclamado. Bajo el bug real, este job es justamente el que el
    //     disparo inmediato de ARRIBA hubiera tomado (boss.fetch()
    //     ordena por created_on, y este es mas viejo). Consulta directa
    //     a pgboss.job (fuera de RLS, sin modelar en schema.prisma) via
    //     el mismo pool que ya administra pg-boss (boss.getDb()) --
    //     mismo mecanismo que usa procesarImportacionCsvPropia() para su
    //     propio reclamo, aca solo para leer.
    const filaJobViejo = await boss
      .getDb()
      .executeSql(`SELECT state, started_on, retry_count FROM pgboss.job WHERE name = $1 AND singleton_key = $2`, [
        COLA_IMPORTACION_CSV,
        importIdViejo,
      ]);
    expect(filaJobViejo.rows).toHaveLength(1);
    expect(filaJobViejo.rows[0].state).toBe("created");
    expect(filaJobViejo.rows[0].started_on).toBeNull();
    expect(filaJobViejo.rows[0].retry_count).toBe(0);
    } finally {
      // RONDA 14 -- limpieza garantizada del job viejo/ajeno que esta
      // prueba encolo, acotada por name+singleton_key=importIdViejo --
      // corre aunque una aserción de arriba haya fallado. Nunca toca
      // otros jobs (nunca boss.fetch(), ver cabecera de este archivo).
      await borrarJobDePrueba(importIdViejo);
    }
  }, 30000);
});
