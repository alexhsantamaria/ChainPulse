// Prueba de integracion -- fallo a mitad de lote contra Postgres real
// (Incremento 4 Bloque B, condiciones de cierre de Alex 2026-09-25,
// punto 4):
//
//   "Publicación por lotes: confirmar que un fallo intermedio no deja
//   observaciones parciales visibles como definitivas ni reemplaza
//   prematuramente las anteriores. No ejecutar el retiro al fallar no
//   basta, por sí solo, para garantizarlo."
//
// Corre SOLO con `npm run test:integration` en Windows -- misma guardia
// que las otras 2 pruebas nuevas, ver entornoPruebasIntegracionCobertura.ts.
//
// importarObservacionesCobertura() (importar.ts) parte el archivo en
// lotes de TAMANO_LOTE=500 filas y corre CADA lote en su PROPIA
// tenantTransaction -- probar eso con 501+ filas reales seria pesado e
// indirecto. Esta prueba ejercita procesarLoteCobertura() (la funcion
// que importarObservacionesCobertura llama por lote) directamente,
// envuelta a mano en tenantTransaction() -- exactamente el mismo patron,
// con control total sobre en que lote se fuerza el fallo. Lo que se
// prueba con mocks en job.test.ts es que el CODIGO nunca llega al
// retiro/CONFIRMADA si el paso de escritura lanza -- lo que SOLO
// Postgres real puede demostrar es que un lote que falla a mitad de
// camino no deja NINGUNA de sus filas escritas (ni siquiera las que
// alcanzaron a correr su INSERT antes del fallo forzado), mientras que
// un lote ANTERIOR ya confirmado queda intacto -- eso es lo que esta
// prueba verifica.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { tenantTransaction } from "../../../prisma/tenantTransaction";
import { tenantClient } from "../../../prisma/tenantClient";
import { procesarLoteCobertura, claveNegocio, type ContextoImportacionCobertura } from "../importar";
import type { FilaCoberturaParaImportar } from "../../../../domain/prepararFilasCoberturaParaImportar";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureCobertura,
  borrarFixtureCobertura,
  TX_OPTIONS_INTEGRACION,
  type FixtureCoberturaIntegracion,
} from "./entornoPruebasIntegracionCobertura";

let fixture: FixtureCoberturaIntegracion;

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  fixture = await crearFixtureCobertura("fallo-parcial");
}, 30000);

afterAll(async () => {
  if (fixture) await borrarFixtureCobertura(fixture);
});

function fila(numeroFila: number, sku: string): FilaCoberturaParaImportar {
  return {
    numeroFila,
    skuOriginal: sku,
    ubicacionOriginal: "LIMA (integracion fallo parcial)",
    fila: {
      sku,
      ubicacion: "LIMA (integracion fallo parcial)",
      fecha: new Date("2026-09-20T00:00:00.000Z"),
      inventarioDisponible: 100,
      consumoDiarioEsperado: 10,
      unidadInventario: "unidad",
      unidadConsumoDiario: "unidad",
    },
    estado: "CALCULADA",
    coberturaDias: 10,
  };
}

describe("procesarLoteCobertura -- fallo a mitad de un lote, contra Postgres real", () => {
  it("lote 1 (exitoso) queda committeado; lote 2 (fallo forzado DESPUES de sus INSERT) no deja NINGUNA fila; un reintento completo converge sin duplicar ni dejar huecos", async () => {
    const importId = await tenantTransaction<{ id: string }>(
      fixture.empresaId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (tx: any) =>
        tx.importacionCsv.create({
          data: {
            cadenaId: fixture.cadenaId,
            definicionKpiId: fixture.definicionKpiId,
            objetoStorageKey: `integracion/fallo-parcial/${randomUUID()}.bin`,
            estado: "PENDIENTE_REVISION",
          },
          select: { id: true },
        }),
      TX_OPTIONS_INTEGRACION,
    ).then((r) => r.id);

    const contexto: ContextoImportacionCobertura = {
      empresaId: fixture.empresaId,
      cadenaId: fixture.cadenaId,
      definicionKpiId: fixture.definicionKpiId,
      importId,
      fuenteConsumo: "prueba de integracion (fallo parcial)",
      periodoReferenciaConsumoInicio: new Date("2026-09-01T00:00:00.000Z"),
      periodoReferenciaConsumoFin: new Date("2026-09-30T00:00:00.000Z"),
      ruleVersion: "integracion-v1",
      zonaHorariaReferencia: "America/Lima",
    };

    const lote1 = [fila(1, "SKU-LOTE1-A"), fila(2, "SKU-LOTE1-B")];
    const lote2 = [fila(3, "SKU-LOTE2-A"), fila(4, "SKU-LOTE2-B")];

    // Lote 1 -- corre real, sin forzar nada, en SU PROPIA transaccion
    // (mismo patron que importarObservacionesCobertura, un lote = una
    // tenantTransaction).
    const resultadoLote1 = await tenantTransaction(
      fixture.empresaId,
      (tx) => procesarLoteCobertura(tx, contexto, lote1),
      TX_OPTIONS_INTEGRACION,
    );
    expect(resultadoLote1.insertadas).toBe(2);

    // Lote 2 -- procesarLoteCobertura corre real (sus INSERT llegan a
    // ejecutarse como sentencias dentro de la transaccion), pero la
    // transaccion completa lanza DESPUES (fallo forzado, simulando un
    // timeout/crash justo antes del commit) -- Postgres debe revertir
    // TODAS las filas de este lote, no solo la que "fallo".
    await expect(
      tenantTransaction(
        fixture.empresaId,
        async (tx) => {
          await procesarLoteCobertura(tx, contexto, lote2);
          throw new Error("fallo forzado de prueba -- simula un timeout justo antes del commit del lote 2");
        },
        TX_OPTIONS_INTEGRACION,
      ),
    ).rejects.toThrow("fallo forzado de prueba");

    const cliente = tenantClient(fixture.empresaId);
    const clavesLote1 = lote1.map((f) => claveNegocio(f.fila.sku, f.fila.ubicacion, f.fila.fecha));
    const clavesLote2 = lote2.map((f) => claveNegocio(f.fila.sku, f.fila.ubicacion, f.fila.fecha));

    const filasLote1TrasElFallo = await cliente.observacionCobertura.findMany({
      where: { cadenaId: fixture.cadenaId, sku: { in: lote1.map((f) => f.fila.sku) } },
    });
    expect(filasLote1TrasElFallo).toHaveLength(2); // el lote 1, ya confirmado antes, sigue intacto
    expect(filasLote1TrasElFallo.every((f: { vigente: boolean }) => f.vigente === true)).toBe(true);

    const filasLote2TrasElFallo = await cliente.observacionCobertura.findMany({
      where: { cadenaId: fixture.cadenaId, sku: { in: lote2.map((f) => f.fila.sku) } },
    });
    expect(filasLote2TrasElFallo).toHaveLength(0); // NINGUNA fila del lote 2 quedo -- ni parcial, ni completa

    // Reintento completo (mismo criterio que un redelivery de pg-boss tras
    // el fallo: se vuelve a correr TODO el archivo desde el principio,
    // nunca solo "lo que falto") -- lote 1 debe resolver en yaProcesadas
    // (P2002, retry-safe, NUNCA insertadas de nuevo) y lote 2 esta vez sin
    // fallo forzado, debe insertarse real.
    const reintentoLote1 = await tenantTransaction(
      fixture.empresaId,
      (tx) => procesarLoteCobertura(tx, contexto, lote1),
      TX_OPTIONS_INTEGRACION,
    );
    expect(reintentoLote1).toEqual({ insertadas: 0, corregidas: 0, sinCambios: 0, yaProcesadas: 2 });

    const reintentoLote2 = await tenantTransaction(
      fixture.empresaId,
      (tx) => procesarLoteCobertura(tx, contexto, lote2),
      TX_OPTIONS_INTEGRACION,
    );
    expect(reintentoLote2).toEqual({ insertadas: 2, corregidas: 0, sinCambios: 0, yaProcesadas: 0 });

    // Estado final: exactamente 4 filas (2+2), todas vigentes, sin
    // duplicados (verificado por clave de negocio, no solo por conteo) y
    // sin huecos (las 4 claves esperadas, ni una mas ni una menos).
    const todasLasFilasFinal = await cliente.observacionCobertura.findMany({
      where: { cadenaId: fixture.cadenaId, sku: { in: [...lote1, ...lote2].map((f) => f.fila.sku) } },
    });
    expect(todasLasFilasFinal).toHaveLength(4);
    const clavesFinales = todasLasFilasFinal
      .map((f: { sku: string; ubicacion: string; fechaCorte: Date }) => claveNegocio(f.sku, f.ubicacion, f.fechaCorte))
      .sort();
    expect(clavesFinales).toEqual([...clavesLote1, ...clavesLote2].sort());
  }, 30000);
});
