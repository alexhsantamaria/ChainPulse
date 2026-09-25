// Prueba de integracion -- concurrencia real contra Postgres (Incremento
// 4 Bloque B, condiciones de cierre de Alex 2026-09-25, punto 2):
//
//   "Concurrencia: probar dos confirmaciones simultáneas y correcciones
//   distintas sobre el mismo alcance. Los mocks y la prueba de dos jobs
//   independientes no demuestran esos escenarios."
//
// Corre SOLO con `npm run test:integration` en Windows -- misma guardia
// (DATABASE_URL + confirmacion explicita de entorno) que
// confirmarAtomicidad.integration.test.ts, ver
// entornoPruebasIntegracionCobertura.ts.
//
// Dos escenarios, cada uno contra Postgres/RLS REALES:
//
// (a) Dos POST de confirmar simultaneos sobre la MISMA importacion --
//     pasa por la ruta HTTP real (unico mock: requireAdmin, para no
//     depender de una sesion de NextAuth real -- eso es "ADMINISTRADOR
//     de punta a punta", una validacion manual aparte, ver el checklist
//     de Windows). R2/cifrado tambien van mockeados a proposito: lo que
//     esta prueba quiere demostrar es la concurrencia de la escritura en
//     Postgres, no el pipeline de R2 (ya cubierto en otro lado) -- real
//     trafico a R2 aca solo agregaria una dependencia de red innecesaria
//     y no determinista a esta prueba puntual.
//
// (b) Dos corridas de finalizarConRetiroAutorizado() en paralelo,
//     autorizadas con el MISMO hash, sobre el MISMO conjunto de filas
//     candidatas (alcance solapado) -- ejercita directamente el
//     SELECT ... FOR UPDATE nuevo (ver importar.ts) sin pasar por R2 en
//     absoluto (finalizarConRetiroAutorizado recibe clavesEnArchivo ya
//     calculado, nunca lee el archivo el mismo).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
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

// Ver el comentario de cabecera -- controlado a proposito, nunca real:
// cualquier intento de la ruta de confirmar de disparar el procesamiento
// inmediato falla de forma limpia (boss.fail()) sin tocar R2 de verdad.
vi.mock("@/infra/storage/r2", () => ({
  ClienteAlmacenamientoR2: vi.fn().mockImplementation(() => ({
    descargarObjeto: vi.fn().mockRejectedValue(new Error("R2 mockeado -- esta prueba no ejercita el pipeline de R2, ver cabecera")),
  })),
}));

let fixture: FixtureCoberturaIntegracion;

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  fixture = await crearFixtureCobertura("concurrencia");
}, 30000);

afterAll(async () => {
  if (fixture) await borrarFixtureCobertura(fixture);
});

describe("(a) dos POST de confirmar simultaneos sobre la MISMA importacion CARGA_PARCIAL", () => {
  it("nunca terminan en un estado inconsistente -- ambas respuestas son ok:true, la fila final tiene un unico conjunto de valores coherente", async () => {
    const { tenantTransaction } = await import("../../../prisma/tenantTransaction");
    const { tenantClient } = await import("../../../prisma/tenantClient");
    const MAPEO = {
      sku: "sku",
      ubicacion: "ubicacion",
      fechaCorte: "fecha",
      inventarioDisponible: "inventario",
      unidadInventario: "unidad_inv",
      consumoDiarioEsperado: "consumo",
      unidadConsumoDiario: "unidad_cons",
    };
    const importId = await tenantTransaction<{ id: string }>(
      fixture.empresaId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (tx: any) =>
        tx.importacionCsv.create({
          data: {
            cadenaId: fixture.cadenaId,
            definicionKpiId: fixture.definicionKpiId,
            objetoStorageKey: `integracion/concurrencia/${randomUUID()}.bin`,
            estado: "PENDIENTE_REVISION",
            mapeoColumnas: { encabezados: Object.values(MAPEO), propuesto: MAPEO, confirmado: null },
          },
          select: { id: true },
        }),
      TX_OPTIONS_INTEGRACION,
    ).then((r) => r.id);

    requireAdminMock.mockResolvedValue({
      sesion: { usuarioId: fixture.adminId, empresaId: fixture.empresaId, rol: "ADMINISTRADOR", email: "x@x.test" },
    });

    const { POST } = await import("../../../../app/api/kpis/cobertura/importaciones/[id]/confirmar/route");
    const cuerpo = () =>
      new Request(`https://x.test/api/kpis/cobertura/importaciones/${importId}/confirmar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mapeoColumnas: MAPEO,
          estrategia: "CARGA_PARCIAL",
          fuenteConsumo: "prueba de integracion (concurrencia)",
          periodoReferenciaConsumoInicio: "2026-09-01",
          periodoReferenciaConsumoFin: "2026-09-30",
          soloVistaPrevia: false,
        }),
      });
    const contexto = { params: Promise.resolve({ id: importId }) };

    // Las dos peticiones arrancan a la vez -- Promise.all dispara ambas
    // antes de que ninguna termine su primer `await` (el findUnique
    // inicial), acercandose lo mas posible a una interlocacion real sin
    // depender de dos procesos de Node separados.
    const [resA, resB] = await Promise.all([POST(cuerpo(), contexto), POST(cuerpo(), contexto)]);

    // Nunca un 409/500 -- los dos cuerpos son IDENTICOS, asi que cualquier
    // orden de llegada es, por diseno, una confirmacion nueva o un
    // reintento idempotente que coincide -- jamas un conflicto real.
    expect([resA.status, resB.status]).toEqual([200, 200]);
    const [jsonA, jsonB] = await Promise.all([resA.json(), resB.json()]);
    expect(jsonA.ok).toBe(true);
    expect(jsonB.ok).toBe(true);

    const importacionFinal = await tenantClient(fixture.empresaId).importacionCsv.findUnique({ where: { id: importId } });
    expect(importacionFinal?.estado).toBe("CONFIRMADA");
    expect(importacionFinal?.fuenteConsumo).toBe("prueba de integracion (concurrencia)");
    // mapeoColumnas.confirmado quedo escrito (por quien haya sido el
    // ultimo en escribir) con el UNICO valor que ambas peticiones
    // mandaron -- nunca una mezcla corrupta de las dos.
    expect((importacionFinal?.mapeoColumnas as { confirmado?: unknown })?.confirmado).toEqual(MAPEO);
  }, 30000);
});

describe("(b) dos correcciones REEMPLAZO_ALCANCE en paralelo, autorizadas sobre el MISMO conjunto de filas candidatas", () => {
  it("el FOR UPDATE serializa: exactamente una corrida retira, la otra ve el hash desactualizado -- nunca las dos retiran, nunca corrompe nada", async () => {
    const { tenantTransaction } = await import("../../../prisma/tenantTransaction");
    const { tenantClient } = await import("../../../prisma/tenantClient");
    const { calcularHashVistaPreviaRetiro } = await import("../../../../domain/hashVistaPreviaRetiroCobertura");
    const { finalizarConRetiroAutorizado } = await import("../importar");

    const alcance = {
      fechaCorteInicio: new Date("2026-09-01T00:00:00.000Z"),
      fechaCorteFin: new Date("2026-09-30T00:00:00.000Z"),
      ubicaciones: ["LIMA (integracion concurrencia)"],
    };

    // Dos filas vigentes reales, dentro del alcance, de fuente="csv" --
    // ninguna de las dos "correcciones" las trae en su archivo
    // (clavesEnArchivo vacio para ambas), asi que las DOS son candidatas
    // a retiro para las DOS corridas -- exactamente el escenario de
    // "alcances solapados" que Alex pidio probar.
    const fechaCorte = new Date("2026-09-15T00:00:00.000Z");
    const filas = await tenantTransaction<Array<{ id: string; sku: string; ubicacion: string; fechaCorte: Date }>>(
      fixture.empresaId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      async (tx: any) => {
        const comunes = {
          empresaId: fixture.empresaId,
          cadenaId: fixture.cadenaId,
          definicionKpiId: fixture.definicionKpiId,
          unidadInventario: "unidad",
          unidadConsumoDiario: "unidad",
          fuenteConsumo: "seed integracion",
          zonaHorariaReferencia: "America/Lima",
          estado: "CALCULADA",
          ruleVersion: "integracion-v1",
          fuente: "csv",
          vigente: true,
        };
        const f1 = await tx.observacionCobertura.create({
          data: {
            ...comunes,
            sku: "SKU-CONC-1",
            skuOriginal: "SKU-CONC-1",
            ubicacion: alcance.ubicaciones[0],
            ubicacionOriginal: alcance.ubicaciones[0],
            fechaCorte,
            contenidoHash: `hash-${randomUUID()}`,
          },
          select: { id: true, sku: true, ubicacion: true, fechaCorte: true },
        });
        const f2 = await tx.observacionCobertura.create({
          data: {
            ...comunes,
            sku: "SKU-CONC-2",
            skuOriginal: "SKU-CONC-2",
            ubicacion: alcance.ubicaciones[0],
            ubicacionOriginal: alcance.ubicaciones[0],
            fechaCorte,
            contenidoHash: `hash-${randomUUID()}`,
          },
          select: { id: true, sku: true, ubicacion: true, fechaCorte: true },
        });
        return [f1, f2];
      },
      TX_OPTIONS_INTEGRACION,
    );

    const hashAutorizado = calcularHashVistaPreviaRetiro(filas, alcance);

    // Dos ImportacionCsv distintas (dos "correcciones" separadas), ambas
    // autorizadas con el MISMO hash -- simula dos usuarios/pestañas que
    // vieron la misma vista previa y confirmaron por separado.
    const crearImportacion = () =>
      tenantTransaction<{ id: string }>(
        fixture.empresaId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
        (tx: any) =>
          tx.importacionCsv.create({
            data: {
              cadenaId: fixture.cadenaId,
              definicionKpiId: fixture.definicionKpiId,
              objetoStorageKey: `integracion/concurrencia-b/${randomUUID()}.bin`,
              estado: "CONFIRMADA",
              confirmadaEn: new Date(),
              estrategia: "REEMPLAZO_ALCANCE",
              alcanceFechaCorteInicio: alcance.fechaCorteInicio,
              alcanceFechaCorteFin: alcance.fechaCorteFin,
              alcanceUbicaciones: alcance.ubicaciones,
              retiroHashConfirmado: hashAutorizado,
            },
            select: { id: true },
          }),
        TX_OPTIONS_INTEGRACION,
      ).then((r) => r.id);
    const [importIdX, importIdY] = await Promise.all([crearImportacion(), crearImportacion()]);

    const datosFinalizacion = { filasDetectadas: 0, filasConError: 0, erroresMuestra: null };
    const [resultadoX, resultadoY] = await Promise.all([
      finalizarConRetiroAutorizado(
        { empresaId: fixture.empresaId, cadenaId: fixture.cadenaId, importId: importIdX },
        alcance,
        new Set<string>(),
        hashAutorizado,
        datosFinalizacion,
      ),
      finalizarConRetiroAutorizado(
        { empresaId: fixture.empresaId, cadenaId: fixture.cadenaId, importId: importIdY },
        alcance,
        new Set<string>(),
        hashAutorizado,
        datosFinalizacion,
      ),
    ]);

    const resultados = [resultadoX, resultadoY];
    const ganadores = resultados.filter((r) => r.ok);
    const perdedores = resultados.filter((r) => !r.ok);
    // La garantia central de esta prueba: NUNCA las dos ganan (eso seria
    // un doble retiro / condicion de carrera real). Exactamente una gana.
    expect(ganadores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);
    expect(ganadores[0]).toMatchObject({ ok: true, retiradas: 2 });
    expect(perdedores[0]).toMatchObject({ ok: false, motivo: "HASH_DESACTUALIZADO" });

    // Estado final de las 2 filas: las DOS quedaron retiradas (por quien
    // haya ganado) -- nunca una mezcla, nunca ninguna.
    const clienteFinal = tenantClient(fixture.empresaId);
    const filasFinales = await clienteFinal.observacionCobertura.findMany({
      where: { id: { in: filas.map((f) => f.id) } },
    });
    expect(filasFinales.every((f: { vigente: boolean }) => f.vigente === false)).toBe(true);

    // Solo la importacion ganadora quedo procesadaEn -- la perdedora
    // nunca escribio nada (ni retiro, ni finalizacion), justo lo que
    // marcarError() del job asumiria antes de marcar ERROR.
    const importacionGanadora = ganadores[0] === resultadoX ? importIdX : importIdY;
    const importacionPerdedora = importacionGanadora === importIdX ? importIdY : importIdX;
    const [finalGanadora, finalPerdedora] = await Promise.all([
      clienteFinal.importacionCsv.findUnique({ where: { id: importacionGanadora } }),
      clienteFinal.importacionCsv.findUnique({ where: { id: importacionPerdedora } }),
    ]);
    expect(finalGanadora?.procesadaEn).not.toBeNull();
    expect(finalPerdedora?.procesadaEn).toBeNull();
  }, 30000);
});
