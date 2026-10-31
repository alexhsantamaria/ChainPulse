// Ruta API — RF20 (PR 8): crea el borrador derivado de una version
// (§7.4). corregirCuestionarioVersion() ya copia las preguntas del
// origen reutilizando crear_pregunta_version() en una transaccion
// interactiva de Prisma -- esta ruta no repite esa copia.
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { corregirCuestionarioVersion } from "@/infra/rf20/gobernanzaVersiones";
import { RESPUESTA_ERROR_INTERNO, esErrorOrigenInexistente } from "@/infra/rf20/respuestasHttp";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { versionId } = await params;
  try {
    const creada = await corregirCuestionarioVersion(versionId, resultado.sesion.usuarioId);
    return NextResponse.json({ ok: true, ...creada }, { status: 201 });
  } catch (error) {
    if (esErrorOrigenInexistente(error)) {
      return NextResponse.json({ ok: false, motivo: "RF20_ORIGEN_INEXISTENTE" }, { status: 404 });
    }
    return RESPUESTA_ERROR_INTERNO();
  }
}
