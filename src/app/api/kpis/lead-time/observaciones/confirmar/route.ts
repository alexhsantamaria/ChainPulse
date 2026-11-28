// Ruta API -- confirma (recalcula server-side y persiste) una
// observacion Lead time, nivel 1 manual o nivel 2 pegado. Mismo patron
// que src/app/api/kpis/otif/observaciones/confirmar/route.ts.
//
// Recibe el MISMO payload que previsualizar -- nunca persiste el `valor`
// que el cliente vio en la previsualizacion sin volver a calcularlo:
// confirmarObservacionLeadTime() (persistir.ts) revalida y recalcula
// desde cero antes de guardar.
//
// Solo ADMINISTRADOR (mismo criterio que OTIF).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { confirmarObservacionLeadTime } from "@/infra/kpis/leadTime/persistir";
import type { EntradaDeclaracionLeadTime } from "@/infra/kpis/leadTime/declarar";
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
      filas: p.filas,
    };
  }

  return null;
}

export async function POST(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

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

  const resultado = await confirmarObservacionLeadTime(entrada, { empresaId: sesion.empresaId });
  if (!resultado.ok) {
    const status = resultado.error === "CADENA_INEXISTENTE" ? 404 : resultado.error === "DEFINICION_KPI_NO_DISPONIBLE" ? 500 : 400;
    return NextResponse.json(resultado, { status });
  }

  return NextResponse.json({ ok: true, resultado: resultado.resultado, observacionId: resultado.observacionId });
}
