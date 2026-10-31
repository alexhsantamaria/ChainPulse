// Ruta API — RF20 (PR 8): retira manualmente una version PUBLICADA
// (§7.8, funcion de retiro manual) sin publicar ninguna otra. Misma
// decision de autorizacion que publicar/route.ts: solo
// ADMINISTRADOR_PLATAFORMA.
import { NextResponse } from "next/server";
import { requireAdministradorPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { retirarCuestionarioVersion } from "@/infra/rf20/gobernanzaVersiones";
import { RESPUESTA_ERROR_INTERNO, respuestaRechazoGobernanza } from "@/infra/rf20/respuestasHttp";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireAdministradorPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { versionId } = await params;
  try {
    const salida = await retirarCuestionarioVersion(versionId, resultado.sesion.usuarioId);
    if (!salida.retirada) return respuestaRechazoGobernanza(salida.motivo);
    return NextResponse.json({ ok: true });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
