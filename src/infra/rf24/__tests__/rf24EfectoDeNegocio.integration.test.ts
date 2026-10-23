// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA (RF24
// PR-A, autorizacion de Alex 2026-10-22). Corre SOLO con
// `npm run test:integration` en Windows, contra una base de prueba real.
// Ver entornoPruebasIntegracionRf24.ts para la guardia. Esta sesion no
// la ejecuta.
//
// Cubre, de las 18 pruebas obligatorias de la autorizacion de PR-A:
//   17. Datos de contacto nulificables sin romper constraints.
//   18. Cero cambios en respuestas, hallazgos y agregados durante
//       eliminacion de contacto.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma/client";
import {
  requerirEntornoDePruebasRf24Confirmado,
  crearFixtureEvaluacionRf24,
  borrarFixtureEvaluacionRf24,
  type FixtureEvaluacionRf24,
} from "./entornoPruebasIntegracionRf24";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "../../pruebaRevocacion/clientePrueba";

// CORRECCION B1/B5 (Alex, auditoria de los 24 fallos, 2026-10-23): cliente
// Prisma conectado como neondb_owner -- mismo patron ya establecido en
// rf24EsquemaYPrivilegios.integration.test.ts (Ronda 8). Usado para (B1)
// borrarFixtureEvaluacionRf24() (que necesita el admin para su propio
// deleteMany sobre "solicitudes_derechos") y para (B5) invocar la funcion
// INTERNA aplicar_efecto_solicitud_derechos, que nunca recibe GRANT
// EXECUTE para chainpulse_app a proposito -- esta describe SI quiere
// ejercitar deliberadamente la funcion interna con sus efectos de
// negocio (no hay una ruta publica equivalente que preserve el proposito
// de estas 2 pruebas, ver auditoria).
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

describe("Prueba 17 -- datos de contacto nulificables sin romper constraints", () => {
  let fixture: FixtureEvaluacionRf24;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  afterEach(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("aplicar_efecto_solicitud_derechos(ELIMINACION_CONTACTO) nulifica correo/nombreCompleto/empresaNombre/telefono sin violar ningun constraint de EvaluacionExpresV2", async () => {
    fixture = await crearFixtureEvaluacionRf24(`negocio-17-${randomUUID()}`);
    await prisma.evaluacionExpresV2.update({
      where: { id: fixture.evaluacionExpresV2Id },
      data: { empresaNombre: "Empresa de prueba RF24", telefono: "+51 999 999 999" },
    });

    await prismaAdmin.$executeRaw`SELECT public.aplicar_efecto_solicitud_derechos(${fixture.evaluacionExpresV2Id}, 'ELIMINACION_CONTACTO', NULL, 'FORMULARIO_PUBLICO')`;

    const evaluacionFinal = await prisma.evaluacionExpresV2.findUniqueOrThrow({
      where: { id: fixture.evaluacionExpresV2Id },
    });
    expect(evaluacionFinal.correo).toBeNull();
    expect(evaluacionFinal.nombreCompleto).toBeNull();
    expect(evaluacionFinal.empresaNombre).toBeNull();
    expect(evaluacionFinal.telefono).toBeNull();
    expect(evaluacionFinal.accesoPublicoRevocadoEn).not.toBeNull();
    // Ningun campo NO relacionado con contacto se toco -- la fila sigue
    // siendo una EvaluacionExpresV2 valida y completa.
    expect(evaluacionFinal.productoServicio).not.toBeNull();
    expect(evaluacionFinal.tipoOperacion).not.toBeNull();
  }, 30000);

  it("RETIRO_Y_ELIMINACION aplica el retiro de consentimiento Y la nulificacion de contacto en la misma llamada", async () => {
    fixture = await crearFixtureEvaluacionRf24(`negocio-17b-${randomUUID()}`);
    await prisma.consentimientoExpres.create({
      data: {
        evaluacionExpresV2Id: fixture.evaluacionExpresV2Id,
        finalidad: "INVESTIGACION",
        aceptado: true,
        textoVersion: "v1-negocio",
        textoSnapshot: "texto legal de prueba (negocio)",
      },
    });

    await prismaAdmin.$executeRaw`SELECT public.aplicar_efecto_solicitud_derechos(${fixture.evaluacionExpresV2Id}, 'RETIRO_Y_ELIMINACION', 'INVESTIGACION', 'FORMULARIO_PUBLICO')`;

    const evaluacionFinal = await prisma.evaluacionExpresV2.findUniqueOrThrow({
      where: { id: fixture.evaluacionExpresV2Id },
    });
    expect(evaluacionFinal.correo).toBeNull();

    const retiroInvestigacion = await prisma.consentimientoExpres.findFirst({
      where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id, finalidad: "INVESTIGACION", aceptado: false },
      orderBy: { createdAt: "desc" },
    });
    expect(retiroInvestigacion).not.toBeNull();
  }, 30000);
});

describe("Prueba 18 -- cero cambios en respuestas, hallazgos y agregados durante eliminacion de contacto", () => {
  let fixture: FixtureEvaluacionRf24;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
  });

  afterEach(async () => {
    if (fixture) {
      await prisma.hallazgoExpres.deleteMany({ where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id } });
      await prisma.respuesta.deleteMany({ where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id } });
      await prisma.preguntaVersion.deleteMany({ where: { cuestionarioVersionId: fixture.cuestionarioVersionId } });
      await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
    }
  });

  it("Respuesta y HallazgoExpres de la evaluacion quedan byte-a-byte identicos tras una eliminacion de contacto", async () => {
    fixture = await crearFixtureEvaluacionRf24(`negocio-18-${randomUUID()}`);
    // Respuesta exige una PreguntaVersion real de la MISMA
    // CuestionarioVersion del fixture (FK + @@unique([cuestionarioVersionId, codigo])) --
    // crearFixtureEvaluacionRf24() no crea ninguna (no la necesita para
    // RF24 en si), asi que esta prueba crea la unica que necesita.
    const preguntaVersion = await prisma.preguntaVersion.create({
      data: {
        cuestionarioVersionId: fixture.cuestionarioVersionId,
        codigo: "Q1",
        orden: 1,
        texto: "Pregunta de prueba (negocio 18)",
        dimension: "ALINEACION",
        opciones: [{ valor: "SI", texto: "Si", orden: 1 }],
      },
    });
    const respuesta = await prisma.respuesta.create({
      data: {
        evaluacionExpresV2Id: fixture.evaluacionExpresV2Id,
        preguntaVersionId: preguntaVersion.id,
        opcionSeleccionada: "SI",
      },
    });
    const hallazgo = await prisma.hallazgoExpres.create({
      data: {
        evaluacionExpresV2Id: fixture.evaluacionExpresV2Id,
        dimension: "ALINEACION",
        estadoCategoria: "estado de prueba (negocio 18)",
        enunciado: "Hallazgo de prueba (no debe cambiar tras eliminacion de contacto)",
        estadoEvidencia: "DECLARADO",
        coberturaConfianza: 0.5,
        evidenciaFaltante: [],
        ruleVersion: "v2-preliminary",
        contextoSnapshot: { dimension: "ALINEACION", pais: "PE", preguntaCodigos: ["Q1"] },
      },
    });

    await prismaAdmin.$executeRaw`SELECT public.aplicar_efecto_solicitud_derechos(${fixture.evaluacionExpresV2Id}, 'ELIMINACION_CONTACTO', NULL, 'FORMULARIO_PUBLICO')`;

    const respuestaFinal = await prisma.respuesta.findUniqueOrThrow({ where: { id: respuesta.id } });
    const hallazgoFinal = await prisma.hallazgoExpres.findUniqueOrThrow({ where: { id: hallazgo.id } });
    expect(respuestaFinal).toEqual(respuesta); // ni un campo cambio
    expect(hallazgoFinal).toEqual(hallazgo);
  }, 30000);
});
