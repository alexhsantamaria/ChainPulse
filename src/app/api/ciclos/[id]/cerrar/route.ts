// Ruta API — cierra un ciclo de pulso y calcula sus resultados reales (RF7).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { cerrarCiclo, CicloNoAbiertoError } from "@/infra/ciclos/cerrarCiclo";
import { logError } from "@/infra/log";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resultado = await requireAdmin();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { id } = await params;

  try {
    const resultadoCierre = await cerrarCiclo(resultado.sesion.empresaId, id);
    return NextResponse.json({ ok: true, ...resultadoCierre });
  } catch (err) {
    if (err instanceof CicloNoAbiertoError) {
      return NextResponse.json({ ok: false, error: "CICLO_NO_ABIERTO" }, { status: 409 });
    }
    logError("api/ciclos/[id]/cerrar", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
