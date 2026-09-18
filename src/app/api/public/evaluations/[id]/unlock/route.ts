// Ruta API publica — RF13/RF17/RF23: desbloquea el resultado detallado.
// Quinto endpoint del bloque publico, agregado a lo que listaban
// MVP-DEFINITIVO.md/PLAN-DE-TRABAJO.md (ver
// chainpulse/pendientes-tecnicos-incremento2.md, decision confirmada por
// Alex 2026-09-18) porque ninguno de los otros 4 encaja con una accion
// con body + rate limit propio.
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/prisma/client";
import * as Sentry from "@sentry/nextjs";
import { logError } from "@/infra/log";
import { extraerHuellaOrigenCruda } from "@/infra/public/huellaOrigen";
import { hashHuellaOrigen, registrarIntento, LIMITE_DESBLOQUEO_DETALLE } from "@/infra/rateLimit/limiteTasa";
import {
  TEXTO_CONSENTIMIENTO_VERSION,
  TEXTO_CONSENTIMIENTO_DIAGNOSTICO,
  TEXTO_CONSENTIMIENTO_INVESTIGACION,
} from "@/infra/public/textoConsentimiento";

// RF23: el consentimiento de Diagnostico es obligatorio y NO premarcado --
// z.literal(true) exige que el cliente lo mande expresamente en true
// (nunca se asume por el solo hecho de llamar a esta ruta). El de
// Investigacion es independiente y opcional (RF23: "no le exige aceptar
// este segundo consentimiento para poder ver su resultado").
const desbloqueoSchema = z.object({
  correo: z.string().email(),
  nombreCompleto: z.string().min(1),
  empresaNombre: z.string().min(1),
  telefono: z.string().min(1).optional(),
  consentimientoDiagnostico: z.literal(true),
  consentimientoInvestigacion: z.boolean().optional().default(false),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = desbloqueoSchema.safeParse(body);
  if (!parsed.success) {
    // RF17: correo con formato invalido (u otro dato invalido) se rechaza
    // sin persistir nada y sin desbloquear -- safeParse ya no persistio.
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
  if (evaluacion._count.hallazgos === 0) {
    return NextResponse.json({ ok: false, error: "EVALUACION_NO_COMPLETADA" }, { status: 409 });
  }

  // RF13/RF17: "si el mismo visitante intenta desbloquear de nuevo con
  // otro correo, el sistema no genera un segundo desbloqueo valido" --
  // idempotente, nunca sobreescribe el primer desbloqueo ni consume el
  // limite de tasa de nuevo.
  if (evaluacion.detalleDesbloqueado) {
    return NextResponse.json({ ok: true, yaDesbloqueado: true, detalleDesbloqueado: true });
  }

  const huellaHash = hashHuellaOrigen(extraerHuellaOrigenCruda(request.headers));
  const limite = await registrarIntento(huellaHash, "DESBLOQUEO_DETALLE", LIMITE_DESBLOQUEO_DETALLE, new Date(), prisma);
  if (!limite.permitido) {
    return NextResponse.json({ ok: false, error: "LIMITE_TASA_EXCEDIDO" }, { status: 429 });
  }

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.evaluacionExpresV2.update({
        where: { id },
        data: {
          correo: datos.correo,
          nombreCompleto: datos.nombreCompleto,
          empresaNombre: datos.empresaNombre,
          telefono: datos.telefono,
          detalleDesbloqueado: true,
          detalleDesbloqueadoEn: new Date(),
        },
      });

      await tx.consentimientoExpres.create({
        data: {
          evaluacionExpresV2Id: id,
          finalidad: "DIAGNOSTICO",
          aceptado: true,
          textoVersion: TEXTO_CONSENTIMIENTO_VERSION,
          textoSnapshot: TEXTO_CONSENTIMIENTO_DIAGNOSTICO,
        },
      });
      await tx.consentimientoExpres.create({
        data: {
          evaluacionExpresV2Id: id,
          finalidad: "INVESTIGACION",
          aceptado: datos.consentimientoInvestigacion,
          textoVersion: TEXTO_CONSENTIMIENTO_VERSION,
          textoSnapshot: TEXTO_CONSENTIMIENTO_INVESTIGACION,
        },
      });
    });

    return NextResponse.json({ ok: true, yaDesbloqueado: false, detalleDesbloqueado: true });
  } catch (err) {
    Sentry.captureException(err);
    logError("api/public/evaluations/[id]/unlock POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
