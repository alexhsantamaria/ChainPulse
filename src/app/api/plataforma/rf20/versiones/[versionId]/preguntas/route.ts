// Ruta API — RF20 (PR 8): agrega una pregunta a un borrador (§7.5).
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { crearPreguntaVersion } from "@/infra/rf20/gobernanzaVersiones";
import {
  RESPUESTA_CUERPO_INVALIDO,
  RESPUESTA_ERROR_INTERNO,
  respuestaRechazoGobernanza,
} from "@/infra/rf20/respuestasHttp";
import { crearPreguntaSchema } from "./schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const parsed = crearPreguntaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return RESPUESTA_CUERPO_INVALIDO();

  const { versionId } = await params;
  try {
    const salida = await crearPreguntaVersion({ versionId, ...parsed.data });
    if (!salida.ok) return respuestaRechazoGobernanza(salida.motivo);
    return NextResponse.json({ ok: true, id: salida.id }, { status: 201 });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
