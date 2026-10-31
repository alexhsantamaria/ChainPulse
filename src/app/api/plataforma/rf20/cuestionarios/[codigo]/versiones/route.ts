// Ruta API — RF20 (PR 8): historial de versiones de un codigo. Lectura
// directa (§4.1), sin invocar ninguna funcion SECURITY DEFINER.
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { listarVersionesPorCodigo } from "@/infra/rf20/consultas";
import { RESPUESTA_ERROR_INTERNO } from "@/infra/rf20/respuestasHttp";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { codigo } = await params;
  try {
    const versiones = await listarVersionesPorCodigo(codigo);
    return NextResponse.json({ ok: true, codigo, versiones });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
