// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA (RF24
// PR-A, autorizacion de Alex 2026-10-22). Corre SOLO con
// `npm run test:integration` en Windows, contra una base de prueba real.
// Ver entornoPruebasIntegracionRf24.ts para la guardia. Esta sesion no
// la ejecuta.
//
// Cubre, de las 18 pruebas obligatorias de la autorizacion de PR-A:
//   15. Estados terminales y purgas idempotentes.
//   16. Purga de tabla senuelo a siete dias.
//
// "Idempotente" se demuestra corriendo la MISMA purga dos veces seguidas
// -- la segunda corrida nunca encuentra nada mas que purgar (0 filas
// afectadas), nunca falla ni cuenta de mas.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma/client";
import {
  requerirEntornoDePruebasRf24Confirmado,
  crearFixtureEvaluacionRf24,
  borrarFixtureEvaluacionRf24,
  type FixtureEvaluacionRf24,
} from "./entornoPruebasIntegracionRf24";

interface ResultadoPurga {
  secretos_purgados: number;
  filas_eliminadas: number;
  intentos_descartados_purgados: number;
}

async function correrPurga(): Promise<ResultadoPurga> {
  const filas = await prisma.$queryRaw<ResultadoPurga[]>`
    SELECT * FROM purgar_solicitudes_derechos_segun_retencion()`;
  const resultado = filas[0];
  if (resultado === undefined) {
    throw new Error("purgar_solicitudes_derechos_segun_retencion no devolvio ninguna fila (se esperaba exactamente una).");
  }
  return resultado;
}

describe("Prueba 15 -- estados terminales y purgas idempotentes", () => {
  let fixture: FixtureEvaluacionRf24;
  let idSecretoViejo: string;
  let idFilaTerminalVieja: string;
  let idFilaTerminalReciente: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  afterEach(async () => {
    // Las filas que sobrevivan la purga (idFilaTerminalReciente, y
    // cualquiera que la purga no haya tocado) se limpian aca --
    // borrarFixtureEvaluacionRf24 ya hace deleteMany de SolicitudDerechos
    // por evaluacionExpresV2Id antes de borrar la evaluacion.
    if (fixture) await borrarFixtureEvaluacionRf24(fixture);
  });

  it("purga secretos (tokenHash/huella/tokenKeyVersion) de filas terminales con mas de 72h, pero nunca borra la fila misma todavia -- y nunca viola envio_confirmado_requiere_token (CORRECCION Alex 2026-10-22, punto 4(b))", async () => {
    fixture = await crearFixtureEvaluacionRf24(`retencion-15-${randomUUID()}`);
    idSecretoViejo = `secreto-viejo-${randomUUID()}`;
    // Fila PROCESADA hace 73h (pasa el umbral de 72h de secretos, nunca
    // el de 1 año de la fila completa) -- actualizadaEn se fuerza con
    // SQL directo porque @updatedAt de Prisma siempre escribe now().
    // "envioConfirmadoEn" POBLADO a proposito: es un registro historico
    // que esta purga NUNCA nulifica (solo tokenHash/huella/tokenKeyVersion
    // lo son) -- la fila queda con envioConfirmadoEn NOT NULL y tokenHash
    // NULL simultaneamente, el escenario exacto que la constraint
    // "envio_confirmado_requiere_token" debe seguir permitiendo para un
    // estado terminal (si no lo permitiera, esta misma INSERT/UPDATE de
    // la purga violaria su propia constraint).
    await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion",
       "huellaOrigenHashSolicitud", "envioConfirmadoEn", "expiraEn", "consumidoEn", estado, "createdAt", "actualizadaEn")
      VALUES (${idSecretoViejo}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${"1".repeat(64)}, 1, 'huella-vieja', now() - interval '80 hours', now() - interval '80 hours',
              now() - interval '73 hours', 'PROCESADA', now() - interval '80 hours', now() - interval '73 hours')`;

    const primeraCorrida = await correrPurga();
    expect(primeraCorrida.secretos_purgados).toBeGreaterThanOrEqual(1);

    const filaTrasPurga = await prisma.solicitudDerechos.findUniqueOrThrow({ where: { id: idSecretoViejo } });
    expect(filaTrasPurga.tokenHash).toBeNull();
    expect(filaTrasPurga.tokenKeyVersion).toBeNull();
    expect(filaTrasPurga.huellaOrigenHashSolicitud).toBeNull();
    expect(filaTrasPurga.envioConfirmadoEn).not.toBeNull(); // nunca se nulifica -- registro historico
    expect(filaTrasPurga.estado).toBe("PROCESADA"); // la fila sigue existiendo -- solo 73h, no 1 año

    // Segunda corrida inmediata: idempotente -- ya no hay nada que
    // purgar de ESTA fila (sus secretos ya son NULL), 0 filas afectadas
    // por esta fila especificamente.
    const segundaCorrida = await correrPurga();
    const filaTrasSegundaPurga = await prisma.solicitudDerechos.findUniqueOrThrow({ where: { id: idSecretoViejo } });
    expect(filaTrasSegundaPurga.tokenHash).toBeNull();
    expect(segundaCorrida.secretos_purgados).toBe(0);
  }, 30000);

  it("elimina por completo una fila terminal con mas de 1 año; conserva una fila terminal reciente", async () => {
    fixture = await crearFixtureEvaluacionRf24(`retencion-15b-${randomUUID()}`);
    idFilaTerminalVieja = `terminal-vieja-${randomUUID()}`;
    idFilaTerminalReciente = `terminal-reciente-${randomUUID()}`;
    await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${idFilaTerminalVieja}, ${fixture.evaluacionExpresV2Id},
              'ELIMINACION_CONTACTO'::"TipoSolicitudDerechos", NULL,
              now() - interval '400 days', 'EXPIRADA', now() - interval '400 days', now() - interval '366 days')`;
    await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${idFilaTerminalReciente}, ${fixture.evaluacionExpresV2Id},
              'ELIMINACION_CONTACTO'::"TipoSolicitudDerechos", NULL,
              now() - interval '10 days', 'CANCELADA', now() - interval '10 days', now() - interval '5 days')`;

    const resultado = await correrPurga();
    expect(resultado.filas_eliminadas).toBeGreaterThanOrEqual(1);

    const filaVieja = await prisma.solicitudDerechos.findUnique({ where: { id: idFilaTerminalVieja } });
    expect(filaVieja).toBeNull(); // eliminada por completo

    const filaReciente = await prisma.solicitudDerechos.findUniqueOrThrow({ where: { id: idFilaTerminalReciente } });
    expect(filaReciente.estado).toBe("CANCELADA"); // conservada -- solo 5 dias desde actualizadaEn

    // Idempotente: correr otra vez no vuelve a "eliminar" la ya
    // eliminada (ya no existe, no puede volver a contarse).
    const segundaCorrida = await correrPurga();
    expect(segundaCorrida.filas_eliminadas).toBe(0);
  }, 30000);
});

describe("Prueba 16 -- purga de tabla senuelo a siete dias", () => {
  let idIntentoViejo: string;
  let idIntentoReciente: string;

  beforeAll(() => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  afterEach(async () => {
    await prisma.intentoSolicitudDerechosDescartado.deleteMany({
      where: { id: { in: [idIntentoViejo, idIntentoReciente].filter(Boolean) } },
    });
  });

  it("purga intentos senuelo con mas de 7 dias; conserva los recientes; idempotente en la segunda corrida", async () => {
    idIntentoViejo = `senuelo-viejo-${randomUUID()}`;
    idIntentoReciente = `senuelo-reciente-${randomUUID()}`;
    await prisma.$executeRaw`INSERT INTO "intentos_solicitud_derechos_descartados" (id, "creadoEn")
      VALUES (${idIntentoViejo}, now() - interval '8 days')`;
    await prisma.$executeRaw`INSERT INTO "intentos_solicitud_derechos_descartados" (id, "creadoEn")
      VALUES (${idIntentoReciente}, now() - interval '1 day')`;

    const primeraCorrida = await correrPurga();
    expect(primeraCorrida.intentos_descartados_purgados).toBeGreaterThanOrEqual(1);

    const intentoViejo = await prisma.intentoSolicitudDerechosDescartado.findUnique({ where: { id: idIntentoViejo } });
    expect(intentoViejo).toBeNull();

    const intentoReciente = await prisma.intentoSolicitudDerechosDescartado.findUniqueOrThrow({
      where: { id: idIntentoReciente },
    });
    expect(intentoReciente).not.toBeNull();

    const segundaCorrida = await correrPurga();
    expect(segundaCorrida.intentos_descartados_purgados).toBe(0);
  }, 30000);
});
