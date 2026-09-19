// Script — publica la primera CuestionarioVersion ("evaluacion-expres-v2",
// numero 1) con sus 7 PreguntaVersion + la subpregunta no puntuable de Q5,
// segun el cuestionario aprobado por Alex (2026-09-18, ver
// chainpulse-motor-v2-preguntas.md en el Proyecto). RF20/RF21.
//
// Bootstrap deliberado: RF19 (Curador Metodologico) todavia no tiene UI de
// publicacion, asi que este script hace ese primer paso a mano, sin
// asignar curadorId (columna nullable a proposito para este caso, ver
// comentario en prisma/schema.prisma). Cuando exista la UI de curaduria,
// las versiones siguientes se publican desde ahi, no desde un script.
//
// Corre siempre contra SEED_DATABASE_URL (rol neondb_owner), igual
// criterio que prisma/seed.ts: publicar contenido versionado es
// equivalente a una migracion, no una escritura de la app en runtime.
// Idempotente: upsert con `update: {}` en cada nivel (mismo patron que
// prisma/seed.ts) -- volver a correrlo no duplica ni pisa datos.
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const seedDatabaseUrl = process.env.SEED_DATABASE_URL;
if (!seedDatabaseUrl) {
  throw new Error(
    "Falta SEED_DATABASE_URL en .env -- ver prisma/seed.ts para el mismo requisito.",
  );
}

const adapter = new PrismaPg({ connectionString: seedDatabaseUrl });
const prisma = new PrismaClient({ adapter });

// Opcion de una PreguntaVersion.opciones -- Json, sin tipo propio en el
// schema (comentario: "lista fija de opciones, sin tabla propia"). `orden`
// es 0-based y es lo unico que el motor v2 realmente consume (ver
// src/domain/types.ts, RespuestaPreguntaV2.indiceOpcion): coincide 1:1,
// posicion por posicion, con ESTADOS_POR_DIMENSION en
// src/engine/v2/constantes.ts para Q2..Q7 -- cualquier reordenamiento aca
// sin el mismo cambio alla desalinea silenciosamente el motor.
interface OpcionPregunta {
  valor: string;
  texto: string;
  orden: number;
}

function opciones(...pares: [string, string][]): OpcionPregunta[] {
  return pares.map(([valor, texto], orden) => ({ valor, texto, orden }));
}

interface PreguntaSeed {
  codigo: string;
  orden: number;
  texto: string;
  dimension: "ALINEACION" | "COORDINACION" | "INTEGRACION" | "EVIDENCIA" | "RESILIENCIA";
  opciones: OpcionPregunta[];
  esNoPuntuable?: boolean;
}

const PREGUNTAS: PreguntaSeed[] = [
  {
    codigo: "Q1",
    orden: 1,
    texto: "¿Cuál es el resultado más importante que esta cadena debe entregar al cliente?",
    dimension: "ALINEACION",
    opciones: opciones(
      ["disponibilidad", "Disponibilidad"],
      ["rapidez", "Rapidez"],
      ["cumplimiento_fecha_cantidad", "Cumplimiento de fecha y cantidad"],
      ["calidad_consistencia", "Calidad y consistencia"],
      ["precio_eficiencia", "Precio o eficiencia"],
      ["personalizacion", "Personalización"],
      ["continuidad_interrupciones", "Continuidad ante interrupciones"],
      ["no_definida", "No está claramente definido"],
    ),
  },
  {
    codigo: "Q2",
    orden: 2,
    texto:
      "Si preguntáramos hoy a ventas, compras, operaciones y logística cuál es esa prioridad, ¿qué ocurriría?",
    dimension: "ALINEACION",
    opciones: opciones(
      ["compartida", "Darían la misma respuesta y deciden de acuerdo con ella"],
      ["aplicada_parcialmente", "Conocen la prioridad, pero no siempre la aplican"],
      ["diferente", "Darían respuestas diferentes"],
      ["inexistente", "No existe una prioridad compartida"],
      ["no_comprobable", "No puedo responder por las otras áreas"],
    ),
  },
  {
    codigo: "Q3",
    orden: 3,
    texto:
      "¿Cada área sabe qué necesita recibir, qué debe entregar y a quién afecta cuando incumple?",
    dimension: "ALINEACION",
    opciones: opciones(
      ["definido_se_utiliza", "Sí, está definido y se utiliza"],
      ["claro_para_algunas", "Está claro para algunas áreas"],
      ["depende_de_personas", "Depende de la experiencia de ciertas personas"],
      ["no_esta_claro", "No está claro"],
      ["no_lo_se", "No lo sé"],
    ),
  },
  {
    codigo: "Q4",
    orden: 4,
    texto:
      "Cuando cambia un pedido, la demanda o la capacidad, ¿la información llega a quien debe decidir antes de que sea tarde?",
    dimension: "COORDINACION",
    opciones: opciones(
      ["oportuna", "Casi siempre llega a tiempo y se decide"],
      ["decision_tardia", "Llega a tiempo, pero no siempre se decide"],
      ["informacion_tardia", "Suele llegar tarde"],
      ["fragmentada", "Cada área actúa por separado"],
      ["desconocida", "No lo sé"],
    ),
  },
  {
    codigo: "Q5",
    orden: 5,
    texto:
      "¿Compras, ventas, operaciones y logística trabajan con la misma información sobre cantidades, fechas y prioridades?",
    dimension: "INTEGRACION",
    opciones: opciones(
      ["fuente_compartida", "Sí, utilizan una fuente compartida y confiable"],
      ["fuentes_conciliadas", "Usan varias herramientas, pero normalmente coinciden"],
      ["conciliacion_manual", "Deben conciliar datos manualmente"],
      ["inconsistente", "Frecuentemente trabajan con información diferente"],
      ["desconocida", "No lo sé"],
    ),
  },
  {
    // Subpregunta contextual de Q5 (principio 7 de V2: la tecnologia
    // declarada no es senal de madurez por si sola) -- esNoPuntuable=true,
    // el motor v2 la ignora siempre (ver index.test.ts, "la subpregunta no
    // puntuable de Q5 nunca se usa como fuente de un hallazgo"). dimension
    // no es nullable en el schema; se deja INTEGRACION por contexto, sin
    // efecto en el calculo.
    codigo: "Q5-fuente",
    orden: 6,
    texto: "¿Cuál es la fuente principal que usan hoy para esa información?",
    dimension: "INTEGRACION",
    esNoPuntuable: true,
    opciones: opciones(
      ["sap_erp", "SAP / ERP"],
      ["excel", "Excel"],
      ["wms_tms_aps", "WMS / TMS / APS"],
      ["correo_mensajeria", "Correo / mensajería"],
      ["varios_sistemas", "Varios sistemas"],
      ["sin_fuente_definida", "Sin fuente definida"],
    ),
  },
  {
    codigo: "Q6",
    orden: 7,
    texto:
      "Durante los últimos 30 días, ¿puedes comprobar con datos si se cumplió lo prometido al cliente en fecha y cantidad?",
    dimension: "EVIDENCIA",
    opciones: opciones(
      ["verificada_declarada", "Sí, existe indicador y registro de respaldo"],
      ["incompleta", "Existe indicador, pero los datos están incompletos"],
      ["estimada", "Solo existe una estimación"],
      ["inexistente", "No se mide"],
      ["desconocida", "No lo sé"],
    ),
  },
  {
    codigo: "Q7",
    orden: 8,
    texto:
      "Si mañana falla el proveedor, proceso o transporte más crítico, ¿qué tan preparada está la cadena?",
    dimension: "RESILIENCIA",
    opciones: opciones(
      ["alternativa_probada", "Existe alternativa probada y responsable definido"],
      ["no_probada", "Existe alternativa, pero no ha sido probada"],
      ["dependiente_de_personas", "Depende de algunas personas para resolverlo"],
      ["inexistente", "No existe alternativa definida"],
      ["critico_desconocido", "No sabemos cuál es el punto crítico"],
    ),
  },
];

async function main() {
  const cuestionario = await prisma.cuestionarioVersion.upsert({
    where: { codigo_numero: { codigo: "evaluacion-expres-v2", numero: 1 } },
    update: {},
    create: {
      codigo: "evaluacion-expres-v2",
      numero: 1,
      estado: "PUBLICADA",
      publicadaEn: new Date(),
      notasCambio: "Version inicial -- cuestionario aprobado por Alex el 2026-09-18.",
    },
  });

  for (const pregunta of PREGUNTAS) {
    await prisma.preguntaVersion.upsert({
      where: {
        cuestionarioVersionId_codigo: {
          cuestionarioVersionId: cuestionario.id,
          codigo: pregunta.codigo,
        },
      },
      update: {},
      create: {
        cuestionarioVersionId: cuestionario.id,
        codigo: pregunta.codigo,
        orden: pregunta.orden,
        texto: pregunta.texto,
        dimension: pregunta.dimension,
        opciones: pregunta.opciones as unknown as Prisma.InputJsonValue,
        esNoPuntuable: pregunta.esNoPuntuable ?? false,
      },
    });
  }

  console.log(
    `CuestionarioVersion "${cuestionario.codigo}" v${cuestionario.numero} (${cuestionario.estado}) lista, con ${PREGUNTAS.length} preguntas.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
