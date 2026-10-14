// Ruta API -- previsualiza una observacion Fill Rate (nivel 1 manual o
// nivel 2 pegado), SIN persistir nada. Incremento 4 Bloque B, siguiente
// KPI despues de OTIF (Alex, 2026-10-14).
//
// Solo ADMINISTRADOR, mismo criterio que OTIF (decision 3, addendum
// Seccion 9 del MVP) -- declarar datos es una accion que modifica el
// estado del KPI de la empresa, no una lectura. No resuelve cadenaId
// contra la base: la previsualizacion es pura (mismo resultado para los
// mismos datos, sin tocar Prisma) -- la existencia de la cadena se valida
// recien al confirmar (confirmar/route.ts), unica operacion que persiste.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { previsualizarObservacionFillRate, type EntradaDeclaracionFillRate } from "@/infra/kpis/fillRate/declarar";
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
      // `entrada.filas` es `unknown[]` (ver EntradaDeclaracionFillRate en
      // declarar.ts) -- construirFilaFillRate() valida cada fila,
      // elemento por elemento, antes de leer ninguna propiedad. Nunca un
      // `as any` de datos de red.
      filas: p.filas,
    };
  }

  return null;
}

export async function POST(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;

  // Lee el body con un limite REAL de bytes (nunca solo Content-Length),
  // mismo mecanismo que la ruta equivalente de OTIF.
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

  const resultado = previsualizarObservacionFillRate(entrada);
  if (!resultado.ok) {
    // Reenvia el objeto COMPLETO (no solo `.error`) -- puede traer
    // detalle estructurado (pedidos afectados, limite/recibidas) que la
    // UI necesita para identificar las filas del problema.
    return NextResponse.json(resultado, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    resultado: resultado.resultado,
    filasInterpretadas: resultado.filasInterpretadas,
  });
}
