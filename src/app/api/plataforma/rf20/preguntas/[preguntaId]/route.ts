// Ruta API — RF20 (PR 8): editar o eliminar una pregunta de un borrador
// (§7.5). editar_pregunta_version()/eliminar_pregunta_version() no
// reciben "codigo" ni "orden" -- ninguno de los dos es editable por esta
// vía (coincide con gobernanzaVersiones.ts, ya fusionado en PR 7).
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { editarPreguntaVersion, eliminarPreguntaVersion } from "@/infra/rf20/gobernanzaVersiones";
import {
  RESPUESTA_CUERPO_INVALIDO,
  RESPUESTA_ERROR_INTERNO,
  respuestaRechazoGobernanza,
} from "@/infra/rf20/respuestasHttp";
import { editarPreguntaSchema } from "./schema";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ preguntaId: string }> },
) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const parsed = editarPreguntaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return RESPUESTA_CUERPO_INVALIDO();

  const { preguntaId } = await params;
  try {
    const salida = await editarPreguntaVersion({ preguntaId, ...parsed.data });
    if (!salida.ok) return respuestaRechazoGobernanza(salida.motivo);
    return NextResponse.json({ ok: true });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ preguntaId: string }> },
) {
  // validarSolicitudEscrituraPlataforma exige content-type: application/json
  // incluso sin cuerpo relevante -- es deliberado (la misma proteccion
  // Origin/content-type que el resto de la API): el cliente debe enviar
  // "{}" con ese header, un fetch cross-origin simple no puede hacerlo.
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { preguntaId } = await params;
  try {
    const salida = await eliminarPreguntaVersion(preguntaId);
    if (!salida.ok) return respuestaRechazoGobernanza(salida.motivo);
    return NextResponse.json({ ok: true });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
