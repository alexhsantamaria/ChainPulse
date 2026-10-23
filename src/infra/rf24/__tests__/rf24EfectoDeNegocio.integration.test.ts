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
import {
  requerirEntornoDePruebasRf24Confirmado,
  crearFixtureEvaluacionRf24,
  borrarFixtureEvaluacionRf24,
  type FixtureEvaluacionRf24,
} from "./entornoPruebasIntegracionRf24";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "../../pruebaRevocacion/clientePrueba";

// CORRECCION punto 1 (Alex, auditoria v11 fallida, 2026-10-23): barrido
// amplio y coherente -- prismaAdmin (neondb_owner) para TODA creacion,
// lectura de inspeccion y limpieza DIRECTA de fixtures en las 5 suites de
// integracion de RF24. Este archivo en particular no tiene ningun
// contrato de chainpulse_app que validar: su unico objeto bajo prueba es
// la funcion INTERNA aplicar_efecto_solicitud_derechos (nunca recibe
// GRANT EXECUTE para chainpulse_app a proposito), siempre invocada via
// prismaAdmin -- por eso TODA otra operacion directa de este archivo
// (fixtures de EvaluacionExpresV2/Respuesta/HallazgoExpres/
// PreguntaVersion, de creacion, lectura de verificacion o limpieza) usa
// tambien prismaAdmin, sin excepcion por tabla, aunque chainpulse_app SI
// tendria privilegios sin restriccion sobre varias de ellas en
// produccion -- ninguna de esas operaciones es, en si misma, el contrato
// de chainpulse_app bajo prueba aqui.
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
    await prismaAdmin.evaluacionExpresV2.update({
      where: { id: fixture.evaluacionExpresV2Id },
      data: { empresaNombre: "Empresa de prueba RF24", telefono: "+51 999 999 999" },
    });

    await prismaAdmin.$executeRaw`SELECT public.aplicar_efecto_solicitud_derechos(${fixture.evaluacionExpresV2Id}, 'ELIMINACION_CONTACTO', NULL, 'FORMULARIO_PUBLICO')`;

    const evaluacionFinal = await prismaAdmin.evaluacionExpresV2.findUniqueOrThrow({
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
    await prismaAdmin.consentimientoExpres.create({
      data: {
        evaluacionExpresV2Id: fixture.evaluacionExpresV2Id,
        finalidad: "INVESTIGACION",
        aceptado: true,
        textoVersion: "v1-negocio",
        textoSnapshot: "texto legal de prueba (negocio)",
      },
    });

    await prismaAdmin.$executeRaw`SELECT public.aplicar_efecto_solicitud_derechos(${fixture.evaluacionExpresV2Id}, 'RETIRO_Y_ELIMINACION', 'INVESTIGACION', 'FORMULARIO_PUBLICO')`;

    const evaluacionFinal = await prismaAdmin.evaluacionExpresV2.findUniqueOrThrow({
      where: { id: fixture.evaluacionExpresV2Id },
    });
    expect(evaluacionFinal.correo).toBeNull();

    const retiroInvestigacion = await prismaAdmin.consentimientoExpres.findFirst({
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
      await prismaAdmin.hallazgoExpres.deleteMany({ where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id } });
      await prismaAdmin.respuesta.deleteMany({ where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id } });
      await prismaAdmin.preguntaVersion.deleteMany({ where: { cuestionarioVersionId: fixture.cuestionarioVersionId } });
      await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
    }
  });

  it("Respuesta y HallazgoExpres de la evaluacion quedan byte-a-byte identicos tras una eliminacion de contacto", async () => {
    fixture = await crearFixtureEvaluacionRf24(`negocio-18-${randomUUID()}`);
    // Respuesta exige una PreguntaVersion real de la MISMA
    // CuestionarioVersion del fixture (FK + @@unique([cuestionarioVersionId, codigo])) --
    // crearFixtureEvaluacionRf24() no crea ninguna (no la necesita para
    // RF24 en si), asi que esta prueba crea la unica que necesita.
    const preguntaVersion = await prismaAdmin.preguntaVersion.create({
      data: {
        cuestionarioVersionId: fixture.cuestionarioVersionId,
        codigo: "Q1",
        orden: 1,
        texto: "Pregunta de prueba (negocio 18)",
        dimension: "ALINEACION",
        opciones: [{ valor: "SI", texto: "Si", orden: 1 }],
      },
    });
    const respuesta = await prismaAdmin.respuesta.create({
      data: {
        evaluacionExpresV2Id: fixture.evaluacionExpresV2Id,
        preguntaVersionId: preguntaVersion.id,
        opcionSeleccionada: "SI",
      },
    });
    const hallazgo = await prismaAdmin.hallazgoExpres.create({
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

    const respuestaFinal = await prismaAdmin.respuesta.findUniqueOrThrow({ where: { id: respuesta.id } });
    const hallazgoFinal = await prismaAdmin.hallazgoExpres.findUniqueOrThrow({ where: { id: hallazgo.id } });
    expect(respuestaFinal).toEqual(respuesta); // ni un campo cambio
    expect(hallazgoFinal).toEqual(hallazgo);
  }, 30000);
});
