// Ruta API — RF20 (PR 8): publica un borrador (§7.8). Decision de
// autorizacion de PR 8 (la adenda delega "autorizacion fina por rol" al
// llamador, §6.2): solo ADMINISTRADOR_PLATAFORMA puede publicar/retirar
// -- ver el informe de entrega para la justificacion completa. Todas las
// invariantes (JSON Q1-Q7, carrera de publicacion, etc.) viven
// exclusivamente en publicar_cuestionario_version(); esta ruta solo
// valida la forma del body y traduce {publicada, motivo}.
import { NextResponse } from "next/server";
import { requireAdministradorPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { publicarCuestionarioVersion } from "@/infra/rf20/gobernanzaVersiones";
import {
  RESPUESTA_CUERPO_INVALIDO,
  RESPUESTA_ERROR_INTERNO,
  respuestaRechazoGobernanza,
} from "@/infra/rf20/respuestasHttp";
import { publicarSchema } from "./schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireAdministradorPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const parsed = publicarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return RESPUESTA_CUERPO_INVALIDO();

  const { versionId } = await params;
  try {
    const salida = await publicarCuestionarioVersion({
      versionId,
      actorId: resultado.sesion.usuarioId,
      versionVigenteEsperadaId: parsed.data.versionVigenteEsperadaId,
    });
    if (!salida.publicada) return respuestaRechazoGobernanza(salida.motivo);
    return NextResponse.json({ ok: true });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
