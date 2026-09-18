// Ruta API publica — RF21: crea una EvaluacionExpresV2 anonima y devuelve
// las preguntas de la CuestionarioVersion vigente. Primera ruta del
// proyecto sin requireSession() (anonima, RF11) -- protegida por
// LimiteTasa en vez de por sesion.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import { extraerHuellaOrigenCruda } from "@/infra/public/huellaOrigen";
import { hashHuellaOrigen, registrarIntento, LIMITE_INICIO_EVALUACION } from "@/infra/rateLimit/limiteTasa";

// Forma minima de PreguntaVersion que usa esta ruta. No se importa el tipo
// generado por Prisma aqui: en este entorno (Mac, ver README) el cliente
// Prisma no se regenera y su modulo de tipos no exporta los modelos
// nuevos -- el resto del proyecto evita el mismo problema importando solo
// PrismaClient/Prisma en vez de tipos de modelo individuales.
interface PreguntaVersionResumen {
  codigo: string;
  orden: number;
  texto: string;
  opciones: unknown;
  esNoPuntuable: boolean;
}

const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

const crearEvaluacionSchema = z
  .object({
    pais: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    sector: z.string().min(1).optional(),
    subsector: z.string().min(1).optional(),
    rangoTamano: z.string().min(1).optional(),
    rolParticipante: z.string().min(1).optional(),
    productoServicio: z.string().min(1),
    periodoInicio: z.string().datetime().optional(),
    periodoFin: z.string().datetime().optional(),
    tipoOperacion: z.string().min(1),
  })
  .refine(
    (datos) =>
      !datos.periodoInicio || !datos.periodoFin || new Date(datos.periodoInicio) <= new Date(datos.periodoFin),
    { message: "periodoInicio no puede ser posterior a periodoFin", path: ["periodoInicio"] },
  );

export async function POST(request: Request) {
  const huellaHash = hashHuellaOrigen(extraerHuellaOrigenCruda(request.headers));

  const limite = await registrarIntento(huellaHash, "INICIO_EVALUACION", LIMITE_INICIO_EVALUACION, new Date(), prisma);
  if (!limite.permitido) {
    return NextResponse.json({ ok: false, error: "LIMITE_TASA_EXCEDIDO" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = crearEvaluacionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }
  const datos = parsed.data;

  const cuestionarioVersion = await prisma.cuestionarioVersion.findFirst({
    where: { codigo: "evaluacion-expres-v2", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
    include: { preguntas: { orderBy: { orden: "asc" } } },
  });
  if (!cuestionarioVersion) {
    return NextResponse.json({ ok: false, error: "CUESTIONARIO_NO_DISPONIBLE" }, { status: 503 });
  }

  const periodoFin = datos.periodoFin ? new Date(datos.periodoFin) : new Date();
  const periodoInicio = datos.periodoInicio
    ? new Date(datos.periodoInicio)
    : new Date(periodoFin.getTime() - TREINTA_DIAS_MS);

  try {
    const evaluacion = await prisma.evaluacionExpresV2.create({
      data: {
        cuestionarioVersionId: cuestionarioVersion.id,
        pais: datos.pais ?? "PE",
        region: datos.region,
        sector: datos.sector,
        subsector: datos.subsector,
        rangoTamano: datos.rangoTamano,
        rolParticipante: datos.rolParticipante,
        productoServicio: datos.productoServicio,
        periodoInicio,
        periodoFin,
        tipoOperacion: datos.tipoOperacion,
        huellaOrigen: huellaHash,
      },
    });

    return NextResponse.json({
      ok: true,
      evaluacionExpresV2Id: evaluacion.id,
      preguntas: cuestionarioVersion.preguntas.map((p: PreguntaVersionResumen) => ({
        codigo: p.codigo,
        orden: p.orden,
        texto: p.texto,
        opciones: p.opciones,
        esNoPuntuable: p.esNoPuntuable,
      })),
    });
  } catch (err) {
    logError("api/public/evaluations POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
