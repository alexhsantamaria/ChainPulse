// Ruta API — lista y abre ciclos de pulso (RF5).
import { NextResponse } from "next/server";
import { requireSession, requireAdmin } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { abrirCiclo, YaHayCicloAbiertoError } from "@/infra/ciclos/abrirCiclo";
import { logError } from "@/infra/log";

export async function GET() {
  const resultado = await requireSession();
  if ("respuesta" in resultado) return resultado.respuesta;

  const ciclos = await tenantClient(resultado.sesion.empresaId).cicloPulso.findMany({
    orderBy: { abiertoEn: "desc" },
  });

  return NextResponse.json({ ok: true, ciclos });
}

export async function POST() {
  // RF5 es una accion de administrador -- un RESPONSABLE no abre ciclos.
  const resultado = await requireAdmin();
  if ("respuesta" in resultado) return resultado.respuesta;

  try {
    const resultadoCiclo = await abrirCiclo(resultado.sesion.empresaId);
    return NextResponse.json({ ok: true, ...resultadoCiclo });
  } catch (err) {
    if (err instanceof YaHayCicloAbiertoError) {
      return NextResponse.json({ ok: false, error: "CICLO_YA_ABIERTO" }, { status: 409 });
    }
    logError("api/ciclos POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
