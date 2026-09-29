// Prueba de integracion -- recorrido COMPLETO de "columna sospechosa
// reconocida por el usuario" contra Postgres real: wizard (peticion de
// confirmacion) -> ruta de confirmar (persistencia) -> job de fondo
// (lectura y validacion). Regresion puntual pedida por Alex, 2026-09-29,
// sobre la prueba manual de CSV03:
//
//   Importacion b221c930-059e-45db-b1c2-f3121a85e495, cadena "Cobertura
//   VALIDACION - ERRORES". La UI acepto la confirmacion, pero el job
//   termino en ERROR con "El archivo trae columna(s) que parecen
//   fuente/periodo de consumo sin resolver: fuente consumo." pese a que
//   el usuario SI la habia reconocido en el paso 2 del asistente.
//
// Root cause (confirmado leyendo el codigo, no solo prediciendo): la
// ruta de confirmar validaba `columnasSospechosasReconocidas` del body
// correctamente mas nunca la persistia en
// ImportacionCsv.mapeoColumnas -- el job (job.ts), que vuelve a detectar
// las mismas columnas sospechosas de forma independiente (defensa en
// profundidad, para nunca confiar ciegamente en la ruta de confirmar),
// no tenia como distinguir "el usuario ya la reconocio" de "nunca se
// reviso" y fallaba siempre. Fix: la ruta ahora persiste
// `sospechosasReconocidas` (ver MapeoColumnasPersistido en job.ts) y el
// job filtra contra esa lista en vez de fallar sobre CUALQUIER
// sospechosa detectada.
//
// job.test.ts (unitario, Prisma/R2/cifrado mockeados) ya prueba esta
// misma logica en aislamiento -- lo que SOLO esta prueba de integracion
// demuestra es que el recorrido de punta a punta (la ruta HTTP real
// persistiendo, el job real leyendo esa persistencia, pg-boss real
// encolando/procesando) queda conectado como se espera, sin mocks de por
// medio en ninguno de esos pasos -- unicamente R2 (nunca se sube un
// archivo real a proposito) y el descifrado (el archivo nunca esta
// realmente cifrado en esta prueba) van mockeados, mismo criterio que
// confirmarConcurrencia.integration.test.ts (a) -- ver su cabecera.
//
// Corre SOLO con `npm run test:integration` en Windows -- misma guardia
// que las otras pruebas de integracion de Cobertura, ver
// entornoPruebasIntegracionCobertura.ts.
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

// A diferencia de confirmarConcurrencia.integration.test.ts (a) -- que
// mockea R2 para RECHAZAR a proposito porque no le interesa el
// pipeline de descarga/descifrado -- esta prueba SI necesita que el job
// llegue a leer contenido real (para poder ejercitar
// detectarColumnasSospechosasDeConsumo() sobre encabezados reales), asi
// que R2 y el descifrado se mockean para devolver, de forma controlada,
// el CSV en claro de mas abajo (el archivo nunca se cifra ni se sube de
// verdad en esta prueba -- eso ya esta cubierto en otro lado, ver
// cifradoObjeto.test.ts/almacenamiento.test.ts).
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
const ENCABEZADOS_REALES = [...Object.values(MAPEO), "fuente consumo"];
// Misma columna sospechosa que la importacion real reportada por Alex
// (fuente consumo) -- una sola fila valida es suficiente, lo que se
// prueba es que el job NO se detiene por la sospechosa reconocida, no
// el calculo de Cobertura en si (ya cubierto en otro lado).
const CSV_CON_COLUMNA_SOSPECHOSA_RECONOCIDA =
  "sku,ubicacion,fecha,inventario,unidad_inv,consumo,unidad_cons,fuente consumo\n" +
  "SKU-CSV03,LIMA (integracion sospechosas),2026-09-24,100,unidad,10,unidad,ERP mayo\n";

vi.mock("@/infra/storage/cifradoObjeto", () => ({
  obtenerClaveMaestraPorId: vi.fn().mockReturnValue(Buffer.alloc(32)),
  desenvolverDek: vi.fn().mockReturnValue(Buffer.alloc(32)),
  descifrarContenido: vi.fn().mockReturnValue(Buffer.from(CSV_CON_COLUMNA_SOSPECHOSA_RECONOCIDA)),
}));

let fixture: FixtureCoberturaIntegracion;

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  fixture = await crearFixtureCobertura("sospechosas-reconocidas");
}, 30000);

afterAll(async () => {
  if (fixture) await borrarFixtureCobertura(fixture);
});

describe("recorrido completo: confirmar con columna sospechosa RECONOCIDA -- persistencia + job real, sin mocks de Prisma/pg-boss", () => {
  it("la ruta persiste sospechosasReconocidas y el job (disparo inmediato, real) procesa la fila sin marcar ERROR", async () => {
    const { tenantTransaction } = await import("../../../prisma/tenantTransaction");
    const { tenantClient } = await import("../../../prisma/tenantClient");

    const importId = await tenantTransaction<{ id: string }>(
      fixture.empresaId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (tx: any) =>
        tx.importacionCsv.create({
          data: {
            cadenaId: fixture.cadenaId,
            definicionKpiId: fixture.definicionKpiId,
            objetoStorageKey: `integracion/sospechosas-reconocidas/${randomUUID()}.bin`,
            estado: "PENDIENTE_REVISION",
            // "propuesto"/"encabezados" son lo que la ruta de SUBIR deja
            // persistido -- se reproduce a mano aca porque esta prueba
            // arranca directamente en el paso de confirmar (mismo
            // criterio que confirmarConcurrencia.integration.test.ts).
            // "sospechosasReconocidas" NO se incluye aca a proposito --
            // es exactamente lo que la ruta de confirmar debe agregar.
            mapeoColumnas: { encabezados: ENCABEZADOS_REALES, propuesto: MAPEO, confirmado: null },
            // Metadata de cifrado dummy -- solo necesita ser no-nula para
            // pasar el guard de job.ts (ver el comentario identico en
            // confirmarConcurrencia.integration.test.ts). El contenido
            // real nunca se descifra de verdad, ver el mock de arriba.
            cifradoVersion: 1,
            cifradoClaveId: "integracion-sospechosas-dummy",
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
        // Exactamente lo que el paso 2 del asistente manda cuando el
        // usuario tildo la casilla de "fuente consumo" -- ver
        // construirBodyConfirmar() en ImportadorCoberturaWizard.tsx.
        columnasSospechosasReconocidas: ["fuente consumo"],
        estrategia: "CARGA_PARCIAL",
        fuenteConsumo: "prueba de integracion (columna sospechosa reconocida)",
        periodoReferenciaConsumoInicio: "2026-09-01",
        periodoReferenciaConsumoFin: "2026-09-30",
        soloVistaPrevia: false,
      }),
    });
    const contexto = { params: Promise.resolve({ id: importId }) };

    // El "disparo inmediato" (procesarImportacionesCsv dentro de la
    // propia ruta, ver confirmar/route.ts) corre DENTRO de este await --
    // cuando POST() devuelve, el job real (pg-boss real, Postgres real)
    // ya termino de procesar esta importacion, sin necesidad de poll ni
    // sleep en la prueba.
    const respuesta = await POST(request, contexto);
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ ok: true, importId });

    const importacionFinal = await tenantClient(fixture.empresaId).importacionCsv.findUnique({ where: { id: importId } });
    // La aserción central de esta prueba: NUNCA quedo en ERROR pese a
    // que el archivo real (mockeado via descifrarContenido) SI trae la
    // columna sospechosa -- exactamente el bug reportado.
    expect(importacionFinal?.estado).toBe("CONFIRMADA");
    expect(importacionFinal?.procesadaEn).not.toBeNull();
    expect(importacionFinal?.filasConError).toBe(0);
    expect(importacionFinal?.erroresMuestra).toBeNull();
    expect((importacionFinal?.mapeoColumnas as { sospechosasReconocidas?: string[] } | null)?.sospechosasReconocidas).toEqual([
      "fuente consumo",
    ]);

    // La fila SI se importo de verdad (el job no solo evito el ERROR --
    // realmente escribio la observacion).
    const observacion = await tenantClient(fixture.empresaId).observacionCobertura.findFirst({
      where: { cadenaId: fixture.cadenaId, sku: "SKU-CSV03" },
    });
    expect(observacion).not.toBeNull();
  }, 30000);
});
