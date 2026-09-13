// Ruta API — cierra un ciclo de pulso y calcula sus resultados reales (RF7).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { cerrarCiclo, CicloNoAbiertoError } from "@/infra/ciclos/cerrarCiclo";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }
  if (session.user.rol !== "ADMINISTRADOR") {
    return NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const resultado = await cerrarCiclo(session.user.empresaId, id);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    if (err instanceof CicloNoAbiertoError) {
      return NextResponse.json({ ok: false, error: "CICLO_NO_ABIERTO" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
