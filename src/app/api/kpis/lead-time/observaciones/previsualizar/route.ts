// Ruta API -- previsualiza una observacion Lead time (nivel 1 manual o
// nivel 2 pegado), SIN persistir nada. Mismo patron que
// src/app/api/kpis/otif/observaciones/previsualizar/route.ts.
//
// Solo ADMINISTRADOR (mismo criterio que OTIF). No resuelve cadenaId
// contra la base: la previsualizacion es pura -- la existencia de la
// cadena se valida recien al confirmar (confirmar/route.ts).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { previsualizarObservacionLeadTime, type EntradaDeclaracionLeadTime } from "@/infra/kpis/leadTime/declarar";
import { MAX_TAMANO_BODY_LEAD_TIME_BYTES } from "@/domain/limitesDeclaracionLeadTime";
import { leerCuerpoJsonLimitado } from "@/infra/http/leerCuerpoJsonLimitado";

export const runtime = "nodejs";

function aEntrada(payload: unknown): EntradaDeclaracionLeadTime | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.cadenaId !== "string" || !p.cadenaId) return null;
  if (typeof p.periodoInicio !== "string" || typeof p.periodoFin !== "string") return null;

  if (p.modo === "manual") {
    if (typeof p.valorPromedioDias !== "number") return null;
    return {
      modo: "manual",
      cadenaId: p.cadenaId,
      periodoInicio: p.periodoInicio,
      periodoFin: p.periodoFin,
      valorPromedioDias: p.valorPromedioDias,
    };
  }

  if (p.modo === "pegado") {
    if (!Array.isArray(p.filas)) return null;
    return {
      modo: "pegado",
      cadenaId: p.cadenaId,
      periodoInicio: p.periodoInicio,
      periodoFin: p.periodoFin,
      // entrada.filas es unknown[] -- construirFilaLeadTime() valida cada
      // fila, elemento por elemento, antes de leer ninguna propiedad
      // (mismo criterio que OTIF, ver declarar.ts).
      filas: p.filas,
    };
  }

  return null;
}

export async function POST(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;

  // Mismo lector con limite REAL de bytes que OTIF -- ver la cabecera de
  // leerCuerpoJsonLimitado.ts.
  const cuerpo = await leerCuerpoJsonLimitado(request, MAX_TAMANO_BODY_LEAD_TIME_BYTES);
  if (!cuerpo.ok) {
    if (cuerpo.motivo === "CUERPO_DEMASIADO_GRANDE") {
      return NextResponse.json({ ok: false, error: cuerpo.motivo, limiteBytes: MAX_TAMANO_BODY_LEAD_TIME_BYTES }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: cuerpo.motivo }, { status: 400 });
  }

  const entrada = aEntrada(cuerpo.datos);
  if (!entrada) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const resultado = previsualizarObservacionLeadTime(entrada);
  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    resultado: resultado.resultado,
    filasInterpretadas: resultado.filasInterpretadas,
  });
}
