// Ruta API -- confirma (recalcula server-side y persiste) una observacion
// Fill Rate, nivel 1 manual o nivel 2 pegado. Incremento 4 Bloque B,
// siguiente KPI despues de OTIF (Alex, 2026-10-14).
//
// Recibe el MISMO payload que previsualizar (reenviado por el cliente,
// sin id de borrador intermedio) y nunca persiste el `valor` que el
// cliente vio en la previsualizacion sin volver a calcularlo --
// confirmarObservacionFillRate() (persistir.ts) revalida y recalcula
// desde cero antes de guardar.
//
// Solo ADMINISTRADOR, mismo criterio que OTIF.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { confirmarObservacionFillRate } from "@/infra/kpis/fillRate/persistir";
import type { EntradaDeclaracionFillRate } from "@/infra/kpis/fillRate/declarar";
import { MAX_TAMANO_BODY_FILL_RATE_BYTES } from "@/domain/limitesDeclaracionFillRate";
import { leerCuerpoJsonLimitado } from "@/infra/http/leerCuerpoJsonLimitado";

export const runtime = "nodejs";

function aEntrada(payload: unknown): EntradaDeclaracionFillRate | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.cadenaId !== "string" || !p.cadenaId) return null;
  if (typeof p.periodoInicio !== "string" || typeof p.periodoFin !== "string") return null;

  if (p.modo === "manual") {
    if (typeof p.numerador !== "number" || typeof p.denominador !== "number") return null;
    return {
      modo: "manual",
      cadenaId: p.cadenaId,
      periodoInicio: p.periodoInicio,
      periodoFin: p.periodoFin,
      numerador: p.numerador,
      denominador: p.denominador,
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

  const cuerpo = await leerCuerpoJsonLimitado(request, MAX_TAMANO_BODY_FILL_RATE_BYTES);
  if (!cuerpo.ok) {
    if (cuerpo.motivo === "CUERPO_DEMASIADO_GRANDE") {
      return NextResponse.json({ ok: false, error: cuerpo.motivo, limiteBytes: MAX_TAMANO_BODY_FILL_RATE_BYTES }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: cuerpo.motivo }, { status: 400 });
  }

  const entrada = aEntrada(cuerpo.datos);
  if (!entrada) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  // empresaId SIEMPRE de la sesion, nunca de un campo enviado por el
  // cliente -- aislamiento multi-tenant (RNF1 capa 1), mismo criterio que
  // confirmar/route.ts de OTIF.
  const resultado = await confirmarObservacionFillRate(entrada, { empresaId: sesion.empresaId });
  if (!resultado.ok) {
    const status = resultado.error === "CADENA_INEXISTENTE" ? 404 : resultado.error === "DEFINICION_KPI_NO_DISPONIBLE" ? 500 : 400;
    return NextResponse.json(resultado, { status });
  }

  return NextResponse.json({ ok: true, resultado: resultado.resultado, observacionId: resultado.observacionId });
}
