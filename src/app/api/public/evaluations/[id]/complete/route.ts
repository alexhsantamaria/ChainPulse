// Ruta API publica — RF21/RF22: calcula el diagnostico v2 UNA sola vez y
// lo persiste (gate macro/detalle, ADR-0001: capa de presentacion, nunca
// de computo). Idempotente: si ya hay HallazgoExpres para esta
// evaluacion, no vuelve a calcular -- devuelve el resultado ya guardado
// (mismo orden de prioridad, reconstruido sin volver a correr el motor).
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { calcularDiagnosticoV2 } from "@/engine/v2";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import { construirRespuestasV2 } from "@/infra/public/construirRespuestasV2";
import { persistirHallazgos } from "@/infra/public/persistirHallazgos";
import { obtenerIndiceOpcionQ1 } from "@/infra/public/obtenerIndiceQ1";
import { ordenarHallazgosPersistidos } from "@/infra/public/ordenarHallazgosPersistidos";
import { formatearHallazgoMacro } from "@/infra/public/formatearHallazgo";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const evaluacion = await prisma.evaluacionExpresV2.findUnique({
    where: { id },
    include: {
      cuestionarioVersion: { include: { preguntas: true } },
      respuestas: true,
      hallazgos: true,
    },
  });
  if (!evaluacion) {
    return NextResponse.json({ ok: false, error: "EVALUACION_INEXISTENTE" }, { status: 404 });
  }

  // Idempotente -- nunca un segundo calculo (RF21/ADR-0001).
  if (evaluacion.hallazgos.length > 0) {
    const q1IndiceOpcion = await obtenerIndiceOpcionQ1(prisma, id);
    const ordenados = ordenarHallazgosPersistidos(evaluacion.hallazgos, q1IndiceOpcion);
    return NextResponse.json({
      ok: true,
      yaCompletada: true,
      hallazgos: ordenados.map(formatearHallazgoMacro),
    });
  }

  const { respuestasV2, respuestaIdPorCodigo, preguntasFaltantes } = construirRespuestasV2(
    evaluacion.cuestionarioVersion.preguntas,
    evaluacion.respuestas,
  );
  if (preguntasFaltantes.length > 0) {
    return NextResponse.json(
      { ok: false, error: "PREGUNTAS_INCOMPLETAS", preguntasFaltantes },
      { status: 400 },
    );
  }

  try {
    const findings = calcularDiagnosticoV2(respuestasV2);
    const contexto = {
      pais: evaluacion.pais,
      region: evaluacion.region,
      sector: evaluacion.sector,
      subsector: evaluacion.subsector,
      rangoTamano: evaluacion.rangoTamano,
      rolParticipante: evaluacion.rolParticipante,
    };

    const hallazgosCreados = await prisma.$transaction((tx: Prisma.TransactionClient) =>
      persistirHallazgos(tx, id, findings, respuestaIdPorCodigo, contexto),
    );

    return NextResponse.json({
      ok: true,
      yaCompletada: false,
      hallazgos: hallazgosCreados.map(formatearHallazgoMacro),
    });
  } catch (err) {
    logError("api/public/evaluations/[id]/complete POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
