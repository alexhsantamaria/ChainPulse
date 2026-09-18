// Ruta API publica — RF12/RF13: lee el resultado ya calculado y persistido
// (gate macro/detalle, capa de presentacion -- nunca recalcula). Revela
// mas campos solo si detalleDesbloqueado=true (ver .../unlock/route.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/infra/prisma/client";
import { obtenerIndiceOpcionQ1 } from "@/infra/public/obtenerIndiceQ1";
import { ordenarHallazgosPersistidos } from "@/infra/public/ordenarHallazgosPersistidos";
import { formatearHallazgoMacro, formatearHallazgoDetalle } from "@/infra/public/formatearHallazgo";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const evaluacion = await prisma.evaluacionExpresV2.findUnique({
    where: { id },
    include: { hallazgos: true },
  });
  if (!evaluacion) {
    return NextResponse.json({ ok: false, error: "EVALUACION_INEXISTENTE" }, { status: 404 });
  }
  if (evaluacion.hallazgos.length === 0) {
    return NextResponse.json({ ok: false, error: "EVALUACION_NO_COMPLETADA" }, { status: 409 });
  }

  const q1IndiceOpcion = await obtenerIndiceOpcionQ1(prisma, id);
  const ordenados = ordenarHallazgosPersistidos(evaluacion.hallazgos, q1IndiceOpcion);

  return NextResponse.json({
    ok: true,
    detalleDesbloqueado: evaluacion.detalleDesbloqueado,
    hallazgos: evaluacion.detalleDesbloqueado
      ? ordenados.map(formatearHallazgoDetalle)
      : ordenados.map(formatearHallazgoMacro),
  });
}
