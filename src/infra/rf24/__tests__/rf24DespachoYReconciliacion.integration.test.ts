// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA (RF24
// PR-A, autorizacion de Alex 2026-10-22). Corre SOLO con
// `npm run test:integration` en Windows, contra una base de prueba real.
// Ver entornoPruebasIntegracionRf24.ts para la guardia. Esta sesion no
// la ejecuta.
//
// Cubre, de las 18 pruebas obligatorias de la autorizacion de PR-A:
//   12. Caida tras incrementar el quinto intento termina en cancelacion
//       por reconciliacion (incluye el caso del arriendo YA liberado --
//       CORRECCION Alex 2026-10-22, punto 2).
//   13. Preparacion del token antes del envio.
//   14. Reintentos producen exactamente el mismo hash y version.
//
// Mas alla de las 18 obligatorias -- CORRECCION Alex 2026-10-22, punto
// 7: Prueba 12bis, cobertura 1:1 dedicada de
// registrar_fallo_envio_solicitud_derechos (funcion 8), que antes solo
// estaba cubierta indirectamente por el modelo de fencing de la Prueba
// 11.
//
// Prueba 14 combina la derivacion REAL de tokenDerivacion.ts (unitaria,
// sin red -- ya cubierta en tokenDerivacion.test.ts) con la persistencia
// REAL vía asignar_token_pendiente (esta prueba, con Postgres real) --
// lo que esta prueba demuestra que la unitaria no puede es que la
// FUNCION SQL, no solo el calculo en memoria, acepta el reintento como
// idempotente (mismo hash) en vez de rechazarlo.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../../prisma/client";
import {
  derivarToken,
  hashearToken,
} from "./derivacionTokenPrueba"; // reubicado desde ../tokenDerivacion -- CORRECCION Alex 2026-10-22, punto 6
import {
  requerirEntornoDePruebasRf24Confirmado,
  crearFixtureEvaluacionRf24,
  borrarFixtureEvaluacionRf24,
  type FixtureEvaluacionRf24,
} from "./entornoPruebasIntegracionRf24";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "../../pruebaRevocacion/clientePrueba";

// CORRECCION B1 (Alex, auditoria de los 24 fallos, 2026-10-23): cliente
// Prisma conectado como neondb_owner -- mismo patron ya establecido en
// rf24EsquemaYPrivilegios.integration.test.ts (Ronda 8). Usado SOLO para
// sembrar/leer/borrar filas DIRECTAMENTE sobre "solicitudes_derechos"
// (Ronda 8 revoco su CRUD directo a chainpulse_app); las llamadas a las
// funciones publicas SECURITY DEFINER (reconciliar_solicitudes_derechos_
// agotadas, registrar_fallo_envio_solicitud_derechos, asignar_token_
// pendiente, confirmar_envio_token) siguen con el cliente de aplicacion
// normal (`prisma`), sin cambios -- ya tienen EXECUTE otorgado.
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

describe("Prueba 12 -- caida tras incrementar el quinto intento termina en cancelacion por reconciliacion", () => {
  let fixture: FixtureEvaluacionRf24;
  let solicitudId: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  afterEach(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("una fila con intentosEnvio=5 (maximo), reclamoId poblado y arriendo vencido se cancela atomicamente por el sweep, nunca por el fencing normal", async () => {
    fixture = await crearFixtureEvaluacionRf24(`reconciliacion-12-${randomUUID()}`);
    solicitudId = `agotada-${randomUUID()}`;
    const reclamoId = randomUUID();
    const tokenHash = "e".repeat(64);
    // Simula exactamente el escenario del punto 12: el worker incremento
    // intentosEnvio a 5 (via reclamar_solicitudes_derechos_para_envio, en
    // una corrida anterior) y murio ANTES de llamar a
    // cancelar_solicitud_derechos_por_envio_fallido -- el arriendo sigue
    // poblado (reclamoId, reclamadoHasta) pero ya vencio.
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion",
       "intentosEnvio", "reclamoId", "reclamadoHasta", "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${tokenHash}, 1, 5, ${reclamoId}, now() - interval '1 minute',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    // CORRECCION Alex 2026-10-22, punto 1: el maximo de intentos ya no
    // es parametro -- constante fija (5) dentro de la funcion.
    const resultado = obtenerFilaUnica<{ reconciliar_solicitudes_derechos_agotadas: number }>(
      await prisma.$queryRaw<Array<{ reconciliar_solicitudes_derechos_agotadas: number }>>`
        SELECT reconciliar_solicitudes_derechos_agotadas() AS reconciliar_solicitudes_derechos_agotadas`,
      "reconciliar_solicitudes_derechos_agotadas no devolvio fila.",
    );
    expect(resultado.reconciliar_solicitudes_derechos_agotadas).toBeGreaterThanOrEqual(1);

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.estado).toBe("CANCELADA");
    expect(filaFinal.tokenHash).toBeNull(); // nulificado de inmediato -- mismo criterio que cancelar por fallo
    expect(filaFinal.tokenKeyVersion).toBeNull();
    expect(filaFinal.reclamoId).toBeNull();
    expect(filaFinal.reclamadoHasta).toBeNull();
  }, 30000);

  it("una fila agotada pero cuyo arriendo AUN NO vencio no es tocada por el sweep (el worker podria seguir vivo)", async () => {
    fixture = await crearFixtureEvaluacionRf24(`reconciliacion-12b-${randomUUID()}`);
    solicitudId = `agotada-vigente-${randomUUID()}`;
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "intentosEnvio", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              5, ${randomUUID()}, now() + interval '1 minute',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    await prisma.$queryRaw`SELECT reconciliar_solicitudes_derechos_agotadas()`;

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.estado).toBe("PENDIENTE"); // sin cambios -- el arriendo todavia es vigente
  }, 30000);

  it("CORRECCION Alex 2026-10-22 punto 2: una fila con intentosEnvio=5 (maximo) cuyo arriendo YA fue liberado (reclamoId/reclamadoHasta NULL) antes de poder cancelar SI es alcanzada por el sweep", async () => {
    // Escenario exacto que el predicado original ("reclamadoHasta" <
    // now(), que EXCLUYE NULL) no cubria: el worker llamo con exito a
    // registrar_fallo_envio_solicitud_derechos (funcion 8) -- que libera
    // el arriendo poniendo reclamoId/reclamadoHasta en NULL -- pero
    // murio INMEDIATAMENTE despues, antes de poder evaluar si le
    // quedaban intentos y llamar a cancelar_solicitud_derechos_por_envio_fallido
    // (funcion 9). La fila queda PENDIENTE, agotada (intentosEnvio=5) y
    // SIN arriendo alguno (ambos NULL) -- antes de esta correccion, el
    // sweep nunca la encontraba (ni "< now()" ni fencing normal la
    // tocan, porque no hay reclamoId que fencing exija).
    fixture = await crearFixtureEvaluacionRf24(`reconciliacion-12c-${randomUUID()}`);
    solicitudId = `agotada-sin-arriendo-${randomUUID()}`;
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "intentosEnvio", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              5, NULL, NULL,
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    const resultado = obtenerFilaUnica<{ reconciliar_solicitudes_derechos_agotadas: number }>(
      await prisma.$queryRaw<Array<{ reconciliar_solicitudes_derechos_agotadas: number }>>`
        SELECT reconciliar_solicitudes_derechos_agotadas() AS reconciliar_solicitudes_derechos_agotadas`,
      "reconciliar_solicitudes_derechos_agotadas no devolvio fila.",
    );
    expect(resultado.reconciliar_solicitudes_derechos_agotadas).toBeGreaterThanOrEqual(1);

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.estado).toBe("CANCELADA");
  }, 30000);
});

describe("Prueba 12bis -- registrar_fallo_envio_solicitud_derechos (funcion 8): cobertura 1:1 dedicada (CORRECCION Alex 2026-10-22, punto 7 -- va mas alla de las 18 pruebas obligatorias originales, que solo la cubrian indirectamente via el modelo de fencing de la Prueba 11)", () => {
  let fixture: FixtureEvaluacionRf24;
  let solicitudId: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  afterEach(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("libera el arriendo (reclamoId/reclamadoHasta -> NULL) sin tocar estado ni intentosEnvio, cuando el reclamoId coincide y el arriendo sigue vigente", async () => {
    fixture = await crearFixtureEvaluacionRf24(`fallo-envio-8-${randomUUID()}`);
    solicitudId = `fallo-${randomUUID()}`;
    const reclamoId = randomUUID();
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "intentosEnvio", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              2, ${reclamoId}, now() + interval '2 minutes',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    const resultado = obtenerFilaUnica<{ liberado: boolean }>(
      await prisma.$queryRaw<Array<{ liberado: boolean }>>`
        SELECT * FROM registrar_fallo_envio_solicitud_derechos(${solicitudId}, ${reclamoId})`,
      "registrar_fallo_envio_solicitud_derechos no devolvio fila.",
    );
    expect(resultado.liberado).toBe(true);

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.reclamoId).toBeNull();
    expect(filaFinal.reclamadoHasta).toBeNull();
    expect(filaFinal.estado).toBe("PENDIENTE"); // nunca cancela -- eso es la funcion 9, no esta
    expect(filaFinal.intentosEnvio).toBe(2); // nunca lo toca -- ya fue incrementado por la funcion 5
  }, 30000);

  it("no tiene efecto (liberado=false) cuando el reclamoId no coincide -- fencing, nunca libera el arriendo de otro worker", async () => {
    fixture = await crearFixtureEvaluacionRf24(`fallo-envio-8b-${randomUUID()}`);
    solicitudId = `fallo-fenced-${randomUUID()}`;
    const reclamoIdReal = randomUUID();
    const reclamoIdAjeno = randomUUID();
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "intentosEnvio", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              1, ${reclamoIdReal}, now() + interval '2 minutes',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    const resultado = obtenerFilaUnica<{ liberado: boolean }>(
      await prisma.$queryRaw<Array<{ liberado: boolean }>>`
        SELECT * FROM registrar_fallo_envio_solicitud_derechos(${solicitudId}, ${reclamoIdAjeno})`,
      "registrar_fallo_envio_solicitud_derechos no devolvio fila.",
    );
    expect(resultado.liberado).toBe(false);

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.reclamoId).toBe(reclamoIdReal); // intacto -- el reclamo ajeno no tuvo efecto
    expect(filaFinal.reclamadoHasta).not.toBeNull();
  }, 30000);

  it("no tiene efecto (liberado=false) cuando el arriendo YA vencio -- un worker que perdio su arriendo no puede liberarlo (ya no es suyo)", async () => {
    fixture = await crearFixtureEvaluacionRf24(`fallo-envio-8c-${randomUUID()}`);
    solicitudId = `fallo-vencido-${randomUUID()}`;
    const reclamoId = randomUUID();
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "intentosEnvio", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              1, ${reclamoId}, now() - interval '1 minute',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    const resultado = obtenerFilaUnica<{ liberado: boolean }>(
      await prisma.$queryRaw<Array<{ liberado: boolean }>>`
        SELECT * FROM registrar_fallo_envio_solicitud_derechos(${solicitudId}, ${reclamoId})`,
      "registrar_fallo_envio_solicitud_derechos no devolvio fila.",
    );
    expect(resultado.liberado).toBe(false);

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.reclamoId).toBe(reclamoId); // intacto -- el arriendo vencido no se puede "liberar" dos veces
  }, 30000);
});

describe("Prueba 13 -- preparacion del token antes del envio", () => {
  let fixture: FixtureEvaluacionRf24;
  let solicitudId: string;
  let reclamoId: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  afterEach(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("asignar_token_pendiente persiste tokenHash con envioConfirmadoEn todavia NULL -- el orden exigido (preparar antes de llamar a Resend)", async () => {
    fixture = await crearFixtureEvaluacionRf24(`preparacion-13-${randomUUID()}`);
    solicitudId = `prep-${randomUUID()}`;
    reclamoId = randomUUID();
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${reclamoId}, now() + interval '2 minutes',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    const token = derivarToken(solicitudId, 1);
    const tokenHash = hashearToken(token);

    const asignacion = obtenerFilaUnica<{ asignado: boolean }>(
      await prisma.$queryRaw<Array<{ asignado: boolean }>>`
        SELECT * FROM asignar_token_pendiente(${solicitudId}, ${reclamoId}, ${tokenHash}, 1)`,
      "asignar_token_pendiente no devolvio fila.",
    );
    expect(asignacion.asignado).toBe(true);

    // Punto central de la Prueba 13: el estado "token preparado, envio
    // AUN no confirmado" es un estado real y persistido -- exactamente
    // el punto en el que la aplicacion (PR-B) debe llamar a Resend, NO
    // antes (nunca envia un correo con un token que no fue persistido
    // primero) y NO despues de marcar enviado (eso seria confirmar antes
    // de preparar, el bloqueador original que esta migracion corrige).
    const filaIntermedia = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaIntermedia.tokenHash).toBe(tokenHash);
    expect(filaIntermedia.envioConfirmadoEn).toBeNull();

    const confirmacion = obtenerFilaUnica<{ confirmado: boolean }>(
      await prisma.$queryRaw<Array<{ confirmado: boolean }>>`
        SELECT * FROM confirmar_envio_token(${solicitudId}, ${reclamoId})`,
      "confirmar_envio_token no devolvio fila.",
    );
    expect(confirmacion.confirmado).toBe(true);

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.envioConfirmadoEn).not.toBeNull();
    expect(filaFinal.reclamoId).toBeNull(); // liberado al confirmar
  }, 30000);
});

describe("Prueba 14 -- reintentos producen exactamente el mismo hash y version", () => {
  let fixture: FixtureEvaluacionRf24;
  let solicitudId: string;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
    // Clave real necesaria para derivarToken() -- solo para esta prueba,
    // que ejercita la derivacion real (no solo la persistencia). Si no
    // esta configurada en el entorno de pruebas, la prueba documenta por
    // que no puede correr en vez de fingir una clave.
    if (!process.env.RF24_TOKEN_DERIVE_KEY_V1) {
      process.env.RF24_TOKEN_DERIVE_KEY_V1 = randomBytes(32).toString("base64");
    }
  });

  afterEach(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("asignar_token_pendiente llamado dos veces con el MISMO token (reintento real tras un fallo de red hacia Resend) es idempotente -- nunca rechaza el segundo intento ni cambia el hash", async () => {
    fixture = await crearFixtureEvaluacionRf24(`reintento-14-${randomUUID()}`);
    solicitudId = `reintento-${randomUUID()}`;
    const reclamoId = randomUUID();
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${reclamoId}, now() + interval '2 minutes',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    // Primer intento: deriva y persiste.
    const tokenPrimerIntento = derivarToken(solicitudId, 1);
    const hashPrimerIntento = hashearToken(tokenPrimerIntento);
    const asignacionUno = obtenerFilaUnica<{ asignado: boolean }>(
      await prisma.$queryRaw<Array<{ asignado: boolean }>>`
        SELECT * FROM asignar_token_pendiente(${solicitudId}, ${reclamoId}, ${hashPrimerIntento}, 1)`,
      "asignar_token_pendiente no devolvio fila (primer intento).",
    );
    expect(asignacionUno.asignado).toBe(true);

    // Simula el fallo: Resend no confirma (p.ej. timeout de red) -- la
    // aplicacion reintenta DESDE CERO, volviendo a leer la fila, volviendo
    // a derivar el token con la MISMA tokenKeyVersion almacenada (nunca la
    // version activa global), y vuelve a llamar a asignar_token_pendiente.
    const filaTrasPrimerIntento = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    const tokenReintento = derivarToken(solicitudId, filaTrasPrimerIntento.tokenKeyVersion!);
    const hashReintento = hashearToken(tokenReintento);
    expect(hashReintento).toBe(hashPrimerIntento); // la propiedad central: determinismo

    const asignacionDos = obtenerFilaUnica<{ asignado: boolean }>(
      await prisma.$queryRaw<Array<{ asignado: boolean }>>`
        SELECT * FROM asignar_token_pendiente(${solicitudId}, ${reclamoId}, ${hashReintento}, ${filaTrasPrimerIntento.tokenKeyVersion!})`,
      "asignar_token_pendiente no devolvio fila (reintento).",
    );
    expect(asignacionDos.asignado).toBe(true); // nunca rechazado -- WHERE ("tokenHash" IS NULL OR "tokenHash" = p_token_hash)

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.tokenHash).toBe(hashPrimerIntento);
    expect(filaFinal.tokenKeyVersion).toBe(1);
  }, 30000);

  it("asignar_token_pendiente rechaza (asignado=false) un hash DISTINTO al ya persistido para la misma fila -- nunca sobrescribe en silencio", async () => {
    fixture = await crearFixtureEvaluacionRf24(`reintento-14b-${randomUUID()}`);
    solicitudId = `reintento-distinto-${randomUUID()}`;
    const reclamoId = randomUUID();
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "reclamoId", "reclamadoHasta",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${solicitudId}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${reclamoId}, now() + interval '2 minutes',
              now() + interval '1 day', 'PENDIENTE', now(), now())`;

    await prisma.$queryRaw`SELECT * FROM asignar_token_pendiente(${solicitudId}, ${reclamoId}, ${"f".repeat(64)}, 1)`;
    const asignacionConOtroHash = obtenerFilaUnica<{ asignado: boolean }>(
      await prisma.$queryRaw<Array<{ asignado: boolean }>>`
        SELECT * FROM asignar_token_pendiente(${solicitudId}, ${reclamoId}, ${"0".repeat(64)}, 1)`,
      "asignar_token_pendiente no devolvio fila (hash distinto).",
    );
    expect(asignacionConOtroHash.asignado).toBe(false);

    const filaFinal = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: solicitudId } });
    expect(filaFinal.tokenHash).toBe("f".repeat(64)); // conserva el primero, nunca lo pisa
  }, 30000);
});
