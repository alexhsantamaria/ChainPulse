// Ruta API -- confirma (recalcula server-side y persiste, TODO o NADA --
// Alex punto 11) una o mas observaciones ObservacionOtifProveedor.
// Incremento 5 PR3 (Alex, 2026-11-18). Mismo patron que
// src/app/api/kpis/otif/observaciones/confirmar/route.ts: recibe el
// MISMO payload que previsualizar, nunca persiste un `resultado` que el
// cliente haya visto en la previsualizacion sin recalcularlo --
// confirmarObservacionOtifProveedor() (persistir.ts) revalida y
// recalcula desde cero, dentro de una unica transaccion, antes de
// guardar.
//
// Solo ADMINISTRADOR durante el piloto (mismo criterio que OTIF normal,
// decision 3 del addendum Seccion 9).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { confirmarObservacionOtifProveedor } from "@/infra/kpis/otifProveedor/persistir";
import type { EntradaDeclaracionOtifProveedor } from "@/infra/kpis/otifProveedor/declarar";
import { MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES } from "@/domain/limitesDeclaracionOtifProveedor";
import { leerCuerpoJsonLimitado } from "@/infra/http/leerCuerpoJsonLimitado";

export const runtime = "nodejs";

function aEntrada(payload: unknown): EntradaDeclaracionOtifProveedor | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.cadenaId !== "string" || !p.cadenaId) return null;
  if (typeof p.periodoInicio !== "string" || typeof p.periodoFin !== "string") return null;

  if (p.modo === "manual") {
    if (typeof p.proveedorAlias !== "string") return null;
    if (typeof p.numerador !== "number" || typeof p.denominador !== "number") return null;
    return {
      modo: "manual",
      cadenaId: p.cadenaId,
      periodoInicio: p.periodoInicio,
      periodoFin: p.periodoFin,
      proveedorAlias: p.proveedorAlias,
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

  const cuerpo = await leerCuerpoJsonLimitado(request, MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES);
  if (!cuerpo.ok) {
    if (cuerpo.motivo === "CUERPO_DEMASIADO_GRANDE") {
      return NextResponse.json({ ok: false, error: cuerpo.motivo, limiteBytes: MAX_TAMANO_BODY_OTIF_PROVEEDOR_BYTES }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: cuerpo.motivo }, { status: 400 });
  }

  const entrada = aEntrada(cuerpo.datos);
  if (!entrada) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const resultado = await confirmarObservacionOtifProveedor(entrada, { empresaId: sesion.empresaId });
  if (!resultado.ok) {
    const status = resultado.error === "CADENA_INEXISTENTE" ? 404 : resultado.error === "DEFINICION_KPI_NO_DISPONIBLE" ? 500 : 400;
    // Reenvia el objeto COMPLETO -- ver comentario de previsualizar/route.ts.
    return NextResponse.json(resultado, { status });
  }

  return NextResponse.json({ ok: true, resultados: resultado.resultados });
}
