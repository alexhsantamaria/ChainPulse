// Infraestructura — mapeo UNIFORME de {ok|publicada|retirada|reordenado,
// motivo} (las funciones SECURITY DEFINER de §7) a HTTP, compartido por
// todas las rutas de RF20 (PR 8). Un solo lugar, para que ninguna ruta
// nueva invente su propio criterio de status code.
//
// Regla, documentada en el informe de entrega de PR 8 (no prescrita por
// la adenda, que explicitamente trata todo {ok:false, motivo} como "la
// misma categoria de error de cara al usuario" -- ver §7.8, prueba 1):
//   - motivo que significa "el recurso nombrado en la URL no existe"
//     (VERSION_INEXISTENTE, PREGUNTA_INEXISTENTE, RF20_ORIGEN_INEXISTENTE)
//     -> 404.
//   - cualquier otro motivo de rechazo (estado incorrecto, payload
//     invalido, carrera de publicacion, bloque Q1-Q7, etc.) -> 409,
//     mismo tratamiento uniforme para todos, tal como pide la adenda.
import { NextResponse } from "next/server";

const MOTIVOS_RECURSO_INEXISTENTE = new Set([
  "VERSION_INEXISTENTE",
  "PREGUNTA_INEXISTENTE",
  "RF20_ORIGEN_INEXISTENTE",
]);

export function respuestaRechazoGobernanza(motivo: string, status?: number): NextResponse {
  const codigo = status ?? (MOTIVOS_RECURSO_INEXISTENTE.has(motivo) ? 404 : 409);
  return NextResponse.json({ ok: false, motivo }, { status: codigo });
}

export const RESPUESTA_ERROR_INTERNO = () =>
  NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });

export const RESPUESTA_CUERPO_INVALIDO = () =>
  NextResponse.json({ ok: false, error: "CUERPO_INVALIDO" }, { status: 400 });

/**
 * El RAISE EXCEPTION 'RF20_ORIGEN_INEXISTENTE: ...' de
 * corregir_cuestionario_version() (§7.4) es la unica funcion de
 * gobernanza que señala "no existe" lanzando una excepcion de Postgres
 * en vez de devolver {ok:false, motivo} -- se detecta por el prefijo
 * fijo del mensaje, nunca reinterpretando el resto del texto.
 */
export function esErrorOrigenInexistente(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("RF20_ORIGEN_INEXISTENTE")
  );
}
