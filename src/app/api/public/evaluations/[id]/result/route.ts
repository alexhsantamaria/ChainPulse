// Ruta API publica — RF12/RF13: lee el resultado ya calculado y persistido
// (gate macro/detalle, capa de presentacion -- nunca recalcula). Revela
// mas campos solo si detalleDesbloqueado=true (ver .../unlock/route.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/infra/prisma/client";
import * as Sentry from "@sentry/nextjs";
import { logError } from "@/infra/log";
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

  // I2-34: formatearHallazgoDetalle puede lanzar TrazabilidadHallazgoInvalidaError
  // si la trazabilidad persistida esta ausente o corrupta (ver
  // formatearHallazgo.ts). Ese fallo se convierte aqui en la respuesta
  // controlada estandar del proyecto -- nunca en una promesa rechazada ni
  // en una respuesta parcial. Macro nunca lanza (no lee esos campos), asi
  // que este try/catch no cambia su comportamiento.
  try {
    return NextResponse.json({
      ok: true,
      detalleDesbloqueado: evaluacion.detalleDesbloqueado,
      hallazgos: evaluacion.detalleDesbloqueado
        ? ordenados.map(formatearHallazgoDetalle)
        : ordenados.map(formatearHallazgoMacro),
    });
  } catch (err) {
    Sentry.captureException(err);
    logError("api/public/evaluations/[id]/result GET", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
