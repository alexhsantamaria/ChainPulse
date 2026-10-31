// Ruta API — RF20 (PR 8): detalle de una version (metadata + preguntas
// en orden) y edicion de sus metadatos. editar_metadata_cuestionario_version()
// (§7.5) ya rechaza por si misma cualquier version que no este en
// BORRADOR -- esta ruta no repite esa comprobacion, solo traduce el
// {ok, motivo} que la funcion devuelve.
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { obtenerDetalleVersion } from "@/infra/rf20/consultas";
import { editarMetadataCuestionarioVersion } from "@/infra/rf20/gobernanzaVersiones";
import {
  RESPUESTA_CUERPO_INVALIDO,
  RESPUESTA_ERROR_INTERNO,
  respuestaRechazoGobernanza,
} from "@/infra/rf20/respuestasHttp";
import { editarMetadataSchema } from "./schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { versionId } = await params;
  try {
    const version = await obtenerDetalleVersion(versionId);
    if (!version) {
      return NextResponse.json({ ok: false, motivo: "VERSION_INEXISTENTE" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, version });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const parsed = editarMetadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return RESPUESTA_CUERPO_INVALIDO();

  const { versionId } = await params;
  try {
    const salida = await editarMetadataCuestionarioVersion(versionId, parsed.data.notasCambio);
    if (!salida.ok) return respuestaRechazoGobernanza(salida.motivo);
    return NextResponse.json({ ok: true });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
