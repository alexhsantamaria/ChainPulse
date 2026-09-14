// Ruta API — un responsable registra sus respuestas al cuestionario del ciclo abierto (RF6).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  registrarRespuestas,
  CicloNoAbiertoError,
  ConexionNoAsignadaError,
} from "@/infra/ciclos/registrarRespuestas";

const respuestaSchema = z.object({
  conexionId: z.string().min(1),
  valor: z.number().int().min(1).max(5).optional().nullable(),
  noSabe: z.boolean().optional(),
  noAplica: z.boolean().optional(),
});
const respuestasSchema = z.object({
  respuestas: z.array(respuestaSchema).min(1),
  // RNF9 -- duracion medida en el cliente (desde que se monta el
  // formulario hasta el submit), opcional: si falta o es invalida no se
  // registra la metrica, pero el envio de respuestas nunca se bloquea
  // por esto (ver registrarRespuestas.ts).
  duracionSegundos: z.number().min(0).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }
  // RF6 es una accion de responsable, limitada a su propio eslabon.
  if (session.user.rol !== "RESPONSABLE" || !session.user.eslabonId) {
    return NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = respuestasSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  try {
    const resultado = await registrarRespuestas({
      empresaId: session.user.empresaId,
      cicloPulsoId: id,
      responsableId: session.user.id,
      eslabonId: session.user.eslabonId,
      respuestas: parsed.data.respuestas,
      duracionSegundos: parsed.data.duracionSegundos,
    });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    if (err instanceof CicloNoAbiertoError) {
      return NextResponse.json({ ok: false, error: "CICLO_NO_ABIERTO" }, { status: 409 });
    }
    if (err instanceof ConexionNoAsignadaError) {
      return NextResponse.json({ ok: false, error: "CONEXION_NO_ASIGNADA" }, { status: 403 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
