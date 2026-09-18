// Ruta API publica — RF21: guarda (o corrige) una respuesta de la
// evaluacion expres v2. Idempotente por diseno via upsert (el @@unique de
// Respuesta es [evaluacionExpresV2Id, preguntaVersionId]) -- la UX de
// guardado automatico llama esta ruta en cada respuesta, incluido volver
// atras y cambiar una ya dada, sin generar filas duplicadas.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import { parsearOpciones, resolverOrdenPorValor } from "@/infra/public/opciones";

const respuestaSchema = z
  .object({
    codigoPregunta: z.string().min(1),
    opcionValor: z.string().min(1).optional(),
    noSabe: z.boolean().optional().default(false),
    contextoLibre: z.string().min(1).max(200).optional(),
  })
  .refine((datos) => datos.noSabe || datos.opcionValor !== undefined || datos.contextoLibre !== undefined, {
    message: "Debe indicar opcionValor, contextoLibre o noSabe=true",
  });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = respuestaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }
  const datos = parsed.data;

  const evaluacion = await prisma.evaluacionExpresV2.findUnique({
    where: { id },
    include: { _count: { select: { hallazgos: true } } },
  });
  if (!evaluacion) {
    return NextResponse.json({ ok: false, error: "EVALUACION_INEXISTENTE" }, { status: 404 });
  }
  if (evaluacion._count.hallazgos > 0) {
    return NextResponse.json({ ok: false, error: "EVALUACION_YA_COMPLETADA" }, { status: 409 });
  }

  const pregunta = await prisma.preguntaVersion.findUnique({
    where: { cuestionarioVersionId_codigo: { cuestionarioVersionId: evaluacion.cuestionarioVersionId, codigo: datos.codigoPregunta } },
  });
  if (!pregunta) {
    return NextResponse.json({ ok: false, error: "PREGUNTA_INEXISTENTE" }, { status: 400 });
  }

  let datosRespuesta: { opcionSeleccionada: string | null; noSabe: boolean; contextoLibre: string | null };

  if (pregunta.esNoPuntuable) {
    if (!datos.contextoLibre) {
      return NextResponse.json({ ok: false, error: "CONTEXTO_LIBRE_REQUERIDO" }, { status: 400 });
    }
    datosRespuesta = { opcionSeleccionada: null, noSabe: false, contextoLibre: datos.contextoLibre };
  } else if (datos.noSabe) {
    datosRespuesta = { opcionSeleccionada: null, noSabe: true, contextoLibre: null };
  } else {
    if (!datos.opcionValor) {
      return NextResponse.json({ ok: false, error: "OPCION_VALOR_REQUERIDO" }, { status: 400 });
    }
    const opciones = parsearOpciones(pregunta.opciones, `PreguntaVersion ${pregunta.codigo}`);
    if (resolverOrdenPorValor(opciones, datos.opcionValor) === undefined) {
      return NextResponse.json({ ok: false, error: "OPCION_INVALIDA" }, { status: 400 });
    }
    datosRespuesta = { opcionSeleccionada: datos.opcionValor, noSabe: false, contextoLibre: null };
  }

  try {
    await prisma.respuesta.upsert({
      where: { evaluacionExpresV2Id_preguntaVersionId: { evaluacionExpresV2Id: id, preguntaVersionId: pregunta.id } },
      update: datosRespuesta,
      create: { evaluacionExpresV2Id: id, preguntaVersionId: pregunta.id, ...datosRespuesta },
    });
    return NextResponse.json({ ok: true, codigoPregunta: pregunta.codigo });
  } catch (err) {
    logError("api/public/evaluations/[id]/answers POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
