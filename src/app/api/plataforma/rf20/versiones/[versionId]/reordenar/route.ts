// Ruta API — RF20 (PR 8): reordena las preguntas de un borrador (§7.6).
// Las seis invariantes (version en BORRADOR, payload no vacio, sin IDs
// duplicados, conjunto exacto de preguntas, orden positivo, secuencia
// 1..N sin huecos) viven exclusivamente en reordenar_preguntas_version();
// esta ruta solo valida la FORMA del JSON (zod) antes de reenviarlo.
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { reordenarPreguntasVersion } from "@/infra/rf20/gobernanzaVersiones";
import {
  RESPUESTA_CUERPO_INVALIDO,
  RESPUESTA_ERROR_INTERNO,
  respuestaRechazoGobernanza,
} from "@/infra/rf20/respuestasHttp";
import { reordenarSchema } from "./schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const parsed = reordenarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return RESPUESTA_CUERPO_INVALIDO();

  const { versionId } = await params;
  try {
    const salida = await reordenarPreguntasVersion(versionId, parsed.data.ordenes);
    if (!salida.reordenado) return respuestaRechazoGobernanza(salida.motivo);
    return NextResponse.json({ ok: true });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
