// Ruta API -- previsualiza una o mas observaciones ObservacionOtifProveedor
// (nivel 1 manual -- un proveedor, o nivel 2 pegado -- varios
// proveedores en la misma tabla), SIN persistir nada. Incremento 5 PR3
// (Alex, 2026-11-18). Mismo patron que
// src/app/api/kpis/otif/observaciones/previsualizar/route.ts: solo
// ADMINISTRADOR, lectura real con limite de bytes, previsualizacion pura
// (no toca Prisma, no valida existencia de la cadena -- eso se valida
// recien al confirmar).
//
// Diferencia de forma respecto del payload de OTIF normal: en modo
// "manual" el body trae ademas `proveedorAlias`; en modo "pegado" cada
// fila trae ademas su propio `proveedorAlias` (varias filas pueden
// pertenecer a proveedores distintos dentro de la MISMA tabla pegada,
// Alex punto 10) -- declarar.ts es quien agrupa por
// proveedorAliasClave, esta ruta solo valida la FORMA del payload antes
// de llamar a previsualizarObservacionOtifProveedor().
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { previsualizarObservacionOtifProveedor, type EntradaDeclaracionOtifProveedor } from "@/infra/kpis/otifProveedor/declarar";
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
      // `unknown[]` deliberado -- mismo criterio que EntradaDeclaracionOtif.filas
      // (otif/declarar.ts): construirFilaOtifProveedor() valida cada fila,
      // elemento por elemento, antes de leer ninguna propiedad.
      filas: p.filas,
    };
  }

  return null;
}

export async function POST(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;

  // Lectura con limite REAL de bytes -- mismo criterio que OTIF normal
  // (ver cabecera de leerCuerpoJsonLimitado.ts).
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

  const resultado = previsualizarObservacionOtifProveedor(entrada);
  if (!resultado.ok) {
    // Reenvia el objeto COMPLETO (no solo `.error`) -- puede traer
    // detalle estructurado (filas/conflictos/limite/recibidas) que la UI
    // necesita para identificar el problema (mismo criterio que OTIF).
    return NextResponse.json(resultado, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    resultados: resultado.resultados,
    filasInterpretadas: resultado.filasInterpretadas,
  });
}
