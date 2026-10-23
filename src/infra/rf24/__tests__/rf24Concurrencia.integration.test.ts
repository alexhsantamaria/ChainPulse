// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA (RF24
// PR-A, autorizacion de Alex 2026-10-22). Corre SOLO con
// `npm run test:integration` en Windows, contra una base de prueba real.
// Ver entornoPruebasIntegracionRf24.ts para la guardia. Esta sesion no
// la ejecuta.
//
// Cubre, de las 18 pruebas obligatorias de la autorizacion de PR-A:
//   8. Creacion concurrente respetando 3/24h por evaluacion.
//   9. Dos retiros concurrentes de la misma finalidad producen un solo evento.
//   10. Dos workers no reclaman simultaneamente la misma solicitud.
//   11. Worker vencido no puede escribir despues de un nuevo reclamo.
//
// Mismo patron de concurrencia real que
// confirmarConcurrencia.integration.test.ts (Cobertura): Promise.all
// disparando las llamadas a la vez, nunca secuenciales -- lo que
// demuestra la serializacion es el propio Postgres (advisory lock /
// FOR UPDATE SKIP LOCKED / fencing por reclamoId), nunca un mock.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma/client";
import {
  requerirEntornoDePruebasRf24Confirmado,
  crearFixtureEvaluacionRf24,
  borrarFixtureEvaluacionRf24,
  hashCorreoNormalizado,
  type FixtureEvaluacionRf24,
} from "./entornoPruebasIntegracionRf24";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "../../pruebaRevocacion/clientePrueba";

// CORRECCION B1/B5 (Alex, auditoria de los 24 fallos, 2026-10-23): cliente
// Prisma conectado como neondb_owner (nunca chainpulse_app) -- mismo
// patron ya establecido en rf24EsquemaYPrivilegios.integration.test.ts
// (Ronda 8). Usado SOLO para (B1) sembrar/borrar filas DIRECTAMENTE sobre
// "solicitudes_derechos" (Ronda 8 revoco su CRUD directo a chainpulse_app)
// y (B5) para invocar la funcion INTERNA aplicar_efecto_solicitud_derechos,
// que nunca recibe GRANT EXECUTE para chainpulse_app a proposito -- nunca
// para el acceso de runtime real de la app, que sigue pasando por las
// funciones publicas SECURITY DEFINER (crear_solicitud_derechos,
// reclamar_solicitudes_derechos_para_envio, asignar_token_pendiente,
// confirmar_envio_token), sin cambios en esta ronda.
let prismaAdmin: ClientePrueba;

beforeAll(() => {
  const connectionString = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Las pruebas de integracion de RF24 necesitan SEED_DATABASE_URL o DATABASE_URL (conexion real a Postgres, como neondb_owner) -- no deberian correr en este entorno. Usar `npm run test:integration` en Windows, nunca `npm run test`.",
    );
  }
  prismaAdmin = construirClientePrueba(connectionString, "rf24-pruebas-integracion:admin");
});

afterAll(async () => {
  if (prismaAdmin) {
    await desconectarClientePrueba(prismaAdmin, "rf24-pruebas-integracion:admin:desconexion");
  }
});

interface ResultadoCreacion {
  creada: boolean;
  id: string | null;
}

// CORRECCION Alex 2026-10-22 (ronda noUncheckedIndexedAccess): helper local
// de pruebas -- extrae la unica fila esperada de un arreglo de resultados
// (p.ej. de $queryRaw), lanzando con un mensaje especifico si el arreglo
// viene vacio. Nunca usa "as" ni "!": el guard explicito
// (fila === undefined) es lo que hace seguro devolver T, no una aserción.
function obtenerFilaUnica<T>(filas: T[], mensaje: string): T {
  const fila = filas[0];
  if (fila === undefined) {
    throw new Error(mensaje);
  }
  return fila;
}

async function llamarCrearSolicitud(
  evaluacionId: string,
  correoHash: string,
  tipo: string,
  alcance: string | null,
): Promise<ResultadoCreacion> {
  // CORRECCION Alex 2026-10-22, punto 1 (ampliado en una segunda
  // ronda): crear_solicitud_derechos ya no recibe limite/ventana NI
  // expiracion como parametros -- son constantes fijas (3 solicitudes /
  // 24h / expiracion a 24h) dentro de la funcion.
  const filas = await prisma.$queryRaw<ResultadoCreacion[]>`
    SELECT * FROM crear_solicitud_derechos(
      ${evaluacionId}, ${correoHash}, ${tipo}, ${alcance},
      ${`huella-concurrencia-${randomUUID()}`})`;
  return obtenerFilaUnica<ResultadoCreacion>(
    filas,
    "crear_solicitud_derechos no devolvio ninguna fila (se esperaba exactamente una).",
  );
}

describe("Prueba 8 -- creacion concurrente respetando 3/24h por evaluacion", () => {
  let fixture: FixtureEvaluacionRf24;
  let correoHash: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  beforeEach(async () => {
    fixture = await crearFixtureEvaluacionRf24(`concurrencia-8-${randomUUID()}`);
    const evaluacion = await prisma.evaluacionExpresV2.findUniqueOrThrow({
      where: { id: fixture.evaluacionExpresV2Id },
    });
    correoHash = hashCorreoNormalizado(evaluacion.correo!);
  });

  afterEach(async () => {
    await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("5 creaciones simultaneas sobre la MISMA evaluacion nunca superan 3 PENDIENTE dentro de la ventana de 24h", async () => {
    // pg_advisory_xact_lock(hashtext(evaluacionId)) adentro de
    // crear_solicitud_derechos serializa las 5 transacciones sobre la
    // MISMA clave de advisory lock -- si el limite no se respetara bajo
    // concurrencia real (a diferencia de una prueba secuencial, que
    // nunca ejercitaria la carrera), mas de 3 quedarian 'creada: true'.
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        llamarCrearSolicitud(fixture.evaluacionExpresV2Id, correoHash, "ELIMINACION_CONTACTO", null),
      ),
    );
    const creadas = resultados.filter((r) => r.creada);
    expect(creadas.length).toBe(3);

    // CORRECCION B1 (Alex, auditoria de los 24 fallos, 2026-10-23):
    // lectura DIRECTA de la tabla (bypasea la funcion SECURITY DEFINER,
    // a diferencia de llamarCrearSolicitud() de arriba) -- exige SELECT
    // real sobre "solicitudes_derechos", que chainpulse_app ya no tiene
    // desde la migracion correctiva de Ronda 8. prismaAdmin, nunca prisma.
    const conteoReal = await prismaAdmin.solicitudDerechos.count({
      where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id },
    });
    expect(conteoReal).toBe(3);
  }, 30000);
});

describe("Prueba 9 -- dos retiros concurrentes de la misma finalidad producen un solo evento", () => {
  let fixture: FixtureEvaluacionRf24;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  beforeEach(async () => {
    fixture = await crearFixtureEvaluacionRf24(`concurrencia-9-${randomUUID()}`);
    // Consentimiento DIAGNOSTICO vigente y aceptado, previo al retiro --
    // sin esto, la funcion de todas formas inserta un retiro "sin
    // consentimiento previo registrado" (ver Funcion 2), pero esta
    // prueba quiere el caso real: un consentimiento vigente que se
    // retira.
    await prisma.consentimientoExpres.create({
      data: {
        evaluacionExpresV2Id: fixture.evaluacionExpresV2Id,
        finalidad: "DIAGNOSTICO",
        aceptado: true,
        textoVersion: "v1-concurrencia",
        textoSnapshot: "texto legal de prueba (concurrencia)",
      },
    });
  });

  afterEach(async () => {
    await prisma.consentimientoExpres.deleteMany({
      where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id },
    });
    await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  // CORRECCION B5 (Alex, auditoria de los 24 fallos, 2026-10-23):
  // aplicar_efecto_solicitud_derechos es la funcion INTERNA de la
  // migracion de funciones -- a proposito nunca recibe GRANT EXECUTE
  // para chainpulse_app. prismaAdmin (neondb_owner), nunca prisma.
  it("dos llamadas simultaneas a aplicar_efecto_solicitud_derechos sobre la misma finalidad insertan exactamente un evento de retiro", async () => {
    // pg_advisory_xact_lock(hashtext(evaluacionId || ':' || finalidad))
    // serializa las dos llamadas; la segunda, al ver que ya quedo
    // "aceptado=false" como el mas reciente (IS DISTINCT FROM false),
    // es un no-op -- nunca inserta un segundo evento.
    await Promise.all([
      prismaAdmin.$executeRaw`SELECT public.aplicar_efecto_solicitud_derechos(${fixture.evaluacionExpresV2Id}, 'RETIRO_CONSENTIMIENTO', 'DIAGNOSTICO', 'FORMULARIO_PUBLICO')`,
      prismaAdmin.$executeRaw`SELECT public.aplicar_efecto_solicitud_derechos(${fixture.evaluacionExpresV2Id}, 'RETIRO_CONSENTIMIENTO', 'DIAGNOSTICO', 'FORMULARIO_PUBLICO')`,
    ]);

    const eventosDeRetiro = await prisma.consentimientoExpres.count({
      where: {
        evaluacionExpresV2Id: fixture.evaluacionExpresV2Id,
        finalidad: "DIAGNOSTICO",
        aceptado: false,
      },
    });
    expect(eventosDeRetiro).toBe(1);

    const evaluacionFinal = await prisma.evaluacionExpresV2.findUniqueOrThrow({
      where: { id: fixture.evaluacionExpresV2Id },
    });
    expect(evaluacionFinal.accesoPublicoRevocadoEn).not.toBeNull();
  }, 30000);
});

describe("Prueba 10 -- dos workers no reclaman simultaneamente la misma solicitud", () => {
  let fixture: FixtureEvaluacionRf24;
  let solicitudId: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  beforeEach(async () => {
    fixture = await crearFixtureEvaluacionRf24(`concurrencia-10-${randomUUID()}`);
    solicitudId = `reclamo-${randomUUID()}`;
    // CORRECCION B1 (Alex, 2026-10-23): prismaAdmin, nunca prisma --
    // Ronda 8 revoco el INSERT directo de chainpulse_app sobre esta tabla.
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              now() + interval '1 day', 'PENDIENTE', now(), now())`;
  });

  afterEach(async () => {
    await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("dos reclamos simultaneos, con UNA SOLA fila candidata en la tabla, solo uno obtiene la fila -- FOR UPDATE SKIP LOCKED (CORRECCION Alex 2026-10-22 punto 1: el lote ya no es parametrizable -- fijo en 10 -- pero con una sola fila elegible la carrera es identica)", async () => {
    interface FilaReclamo {
      id: string;
      reclamoId: string;
    }
    const [reclamoA, reclamoB] = await Promise.all([
      prisma.$queryRaw<FilaReclamo[]>`SELECT id, "reclamoId" FROM reclamar_solicitudes_derechos_para_envio()`,
      prisma.$queryRaw<FilaReclamo[]>`SELECT id, "reclamoId" FROM reclamar_solicitudes_derechos_para_envio()`,
    ]);
    // Exactamente uno de los dos reclamos obtiene la fila (nunca los dos,
    // nunca ninguno) -- SKIP LOCKED hace que el segundo, bloqueado por el
    // primero, simplemente no vea la fila como candidata (0 filas), en
    // vez de esperar y despues fallar.
    const totalFilasReclamadas = reclamoA.length + reclamoB.length;
    expect(totalFilasReclamadas).toBe(1);

    // CORRECCION B1 (Alex, 2026-10-23): lectura directa de tabla --
    // prismaAdmin, nunca prisma (mismo motivo que arriba).
    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.intentosEnvio).toBe(1); // incrementado una sola vez, nunca dos
    expect(filaFinal.reclamoId).not.toBeNull();
  }, 30000);
});

describe("Prueba 11 -- worker vencido no puede escribir despues de un nuevo reclamo", () => {
  let fixture: FixtureEvaluacionRf24;
  let solicitudId: string;
  let reclamoViejoId: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  beforeEach(async () => {
    fixture = await crearFixtureEvaluacionRf24(`concurrencia-11-${randomUUID()}`);
    solicitudId = `vencido-${randomUUID()}`;
    reclamoViejoId = randomUUID();
    // Siembra directamente una fila YA reclamada, con el arriendo YA
    // vencido (reclamadoHasta en el pasado) -- simula un worker que
    // reclamo, nunca termino, y cuyo arriendo expiro.
    // CORRECCION B1 (Alex, 2026-10-23): prismaAdmin, nunca prisma.
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "intentosEnvio", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              1, ${reclamoViejoId}, now() - interval '1 minute',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;
  });

  afterEach(async () => {
    await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("un segundo worker reclama la fila (arriendo vencido); el worker viejo ya no puede asignar_token_pendiente ni confirmar_envio_token", async () => {
    interface FilaReclamo {
      id: string;
      reclamoId: string;
    }
    // CORRECCION Alex 2026-10-22, punto 1: lote/lease/maximo de intentos
    // ya no son parametros -- constantes fijas (10/2min/5) dentro de la
    // funcion.
    const filasNuevoReclamo = await prisma.$queryRaw<FilaReclamo[]>`
      SELECT id, "reclamoId" FROM reclamar_solicitudes_derechos_para_envio()
      WHERE id = ${solicitudId}`;
    const nuevoReclamo = obtenerFilaUnica<FilaReclamo>(
      filasNuevoReclamo,
      "reclamar_solicitudes_derechos_para_envio no devolvio la fila esperada para la solicitud sembrada.",
    );
    expect(nuevoReclamo.reclamoId).not.toBe(reclamoViejoId);

    // El worker VIEJO (con su reclamoId ya sustituido) intenta escribir
    // -- debe fallar SIN EFECTO (asignado/confirmado=false), nunca lanzar
    // ni tocar la fila que ahora pertenece al worker nuevo.
    const asignacionVieja = obtenerFilaUnica<{ asignado: boolean }>(
      await prisma.$queryRaw<Array<{ asignado: boolean }>>`
        SELECT * FROM asignar_token_pendiente(${solicitudId}, ${reclamoViejoId}, ${"c".repeat(64)}, 1)`,
      "asignar_token_pendiente no devolvio fila para el intento del worker viejo.",
    );
    expect(asignacionVieja.asignado).toBe(false);

    const confirmacionVieja = obtenerFilaUnica<{ confirmado: boolean }>(
      await prisma.$queryRaw<Array<{ confirmado: boolean }>>`
        SELECT * FROM confirmar_envio_token(${solicitudId}, ${reclamoViejoId})`,
      "confirmar_envio_token no devolvio fila para el intento del worker viejo.",
    );
    expect(confirmacionVieja.confirmado).toBe(false);

    // El worker NUEVO, con el reclamoId correcto, si puede escribir.
    const asignacionNueva = obtenerFilaUnica<{ asignado: boolean }>(
      await prisma.$queryRaw<Array<{ asignado: boolean }>>`
        SELECT * FROM asignar_token_pendiente(${solicitudId}, ${nuevoReclamo.reclamoId}, ${"d".repeat(64)}, 1)`,
      "asignar_token_pendiente no devolvio fila para el intento del worker nuevo.",
    );
    expect(asignacionNueva.asignado).toBe(true);

    // CORRECCION B1 (Alex, 2026-10-23): lectura directa de tabla --
    // prismaAdmin, nunca prisma (mismo motivo que arriba).
    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.tokenHash).toBe("d".repeat(64)); // nunca "c".repeat(64), el intento del worker viejo
  }, 30000);
});
