// Ruta API — lista y abre ciclos de pulso (RF5).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { abrirCiclo, YaHayCicloAbiertoError } from "@/infra/ciclos/abrirCiclo";

export async function GET() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  const ciclos = await tenantClient(session.user.empresaId).cicloPulso.findMany({
    orderBy: { abiertoEn: "desc" },
  });

  return NextResponse.json({ ok: true, ciclos });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }
  // RF5 es una accion de administrador -- un RESPONSABLE no abre ciclos.
  if (session.user.rol !== "ADMINISTRADOR") {
    return NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });
  }

  try {
    const resultado = await abrirCiclo(session.user.empresaId);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    if (err instanceof YaHayCicloAbiertoError) {
      return NextResponse.json({ ok: false, error: "CICLO_YA_ABIERTO" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
