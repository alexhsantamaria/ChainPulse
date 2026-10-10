// Ruta API -- previsualiza una observacion OTIF (nivel 1 manual o nivel 2
// pegado), SIN persistir nada. Incremento 4 Bloque B, piloto OTIF (Alex,
// 2026-10-08/09).
//
// Solo ADMINISTRADOR durante el piloto (decision 3, addendum Seccion 9 --
// acotada a esta fase, no una decision permanente del producto). No
// resuelve cadenaId contra la base: la previsualizacion es pura (mismo
// resultado para los mismos datos, sin tocar Prisma) -- la existencia de
// la cadena se valida recien al confirmar (confirmar/route.ts), unica
// operacion que persiste.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { previsualizarObservacionOtif, type EntradaDeclaracionOtif } from "@/infra/kpis/otif/declarar";
import { MAX_TAMANO_BODY_OTIF_BYTES } from "@/domain/limitesDeclaracionOtif";
import { leerCuerpoJsonLimitado } from "@/infra/http/leerCuerpoJsonLimitado";

export const runtime = "nodejs";

function aEntrada(payload: unknown): EntradaDeclaracionOtif | null {
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
      // CORREGIDO 2026-10-10 (Alex, segunda revision): sin `as any`. Este
      // `any` no tenia nada que ver con el cliente Prisma no regenerado
      // (ese caso SI queda documentado y pendiente para Windows, ver
      // persistir.ts) -- era un cast de datos de red que le mentia a
      // declarar.ts sobre la forma de cada fila. `entrada.filas` es ahora
      // `unknown[]` (ver EntradaDeclaracionOtif en declarar.ts):
      // construirFilaOtif() valida cada fila, elemento por elemento, antes
      // de leer ninguna propiedad.
      filas: p.filas,
    };
  }

  return null;
}

export async function POST(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;

  // Lee el body con un limite REAL de bytes (nunca solo Content-Length --
  // Alex 2026-10-10, ver la cabecera de leerCuerpoJsonLimitado.ts):
  // cuenta los bytes del stream a medida que llegan y cancela la lectura
  // apenas se supera MAX_TAMANO_BODY_OTIF_BYTES, sin terminar de
  // acumular un body excesivo en memoria.
  const cuerpo = await leerCuerpoJsonLimitado(request, MAX_TAMANO_BODY_OTIF_BYTES);
  if (!cuerpo.ok) {
    // CUERPO_DEMASIADO_GRANDE viaja con `limiteBytes` para que la UI pueda
    // mostrar el limite real en el mensaje, en vez de un generico "el
    // cuerpo es demasiado grande" sin numero (Alex 2026-10-10).
    if (cuerpo.motivo === "CUERPO_DEMASIADO_GRANDE") {
      return NextResponse.json({ ok: false, error: cuerpo.motivo, limiteBytes: MAX_TAMANO_BODY_OTIF_BYTES }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: cuerpo.motivo }, { status: 400 });
  }

  const entrada = aEntrada(cuerpo.datos);
  if (!entrada) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const resultado = previsualizarObservacionOtif(entrada);
  if (!resultado.ok) {
    // Reenvia el objeto COMPLETO (no solo `.error`) -- puede traer
    // detalle estructurado (pedidos afectados, limite/recibidas) que la
    // UI necesita para identificar las filas del problema (Alex
    // 2026-10-10).
    return NextResponse.json(resultado, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    resultado: resultado.resultado,
    filasInterpretadas: resultado.filasInterpretadas,
  });
}
