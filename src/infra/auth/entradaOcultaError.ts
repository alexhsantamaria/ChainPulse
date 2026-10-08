// Infraestructura — clasificacion segura de los errores que puede
// lanzar leerPasswordOculta() (scripts/restablecerPasswordCuentaPrueba.ts).
// Modulo deliberadamente SIN dependencias (mismo motivo que
// etiquetaErrorSegura.ts: evitar que --probar-entrada arrastre, ni
// siquiera transitivamente, la construccion de PrismaClient -- ver el
// comentario de cabecera de ese archivo).
//
// Corregido a pedido de Alex (tercera ronda de revision): antes, el
// codigo que capturaba un error de leerPasswordOculta() imprimia
// err.message (o String(err) para lo que no fuera instancia de Error)
// directamente, confiando en que leerPasswordOculta() "solo lanza sus
// propios errores de mensaje fijo". Esa suposicion no esta garantizada
// por el tipo -- nada impedia que, por una via no prevista, terminara
// ahi un error con contenido sensible en su mensaje. Ahora
// leerPasswordOculta() lanza EXCLUSIVAMENTE instancias de
// EntradaOcultaError, identificadas por un campo `motivo` interno fijo
// (nunca por el contenido de `message`), y mensajeEntradaOculta() las
// traduce a un mensaje fijo de la tabla de abajo. Cualquier error que
// NO sea una instancia de EntradaOcultaError (lo que no deberia pasar
// nunca, pero nunca se asume que no puede pasar) cae al mensaje
// generico ERROR_INESPERADO -- su .message/.stack jamas se lee ni se
// imprime en ningun punto de este modulo ni de quien lo usa.
export type MotivoEntradaOculta =
  | "TTY_NO_INTERACTIVA"
  | "FALLO_MODO_RAW"
  | "CANCELADO_CTRL_C"
  | "CANCELADO_CTRL_D"
  | "ERROR_INESPERADO";

export class EntradaOcultaError extends Error {
  constructor(public readonly motivo: MotivoEntradaOculta) {
    // El mensaje interno de Error es solo informativo para quien lea
    // una traza en desarrollo -- este mecanismo nunca imprime
    // err.message en ningun punto, solo el campo `motivo` (ver
    // mensajeEntradaOculta() mas abajo).
    super(`EntradaOcultaError: ${motivo}`);
    this.name = "EntradaOcultaError";
  }
}

const MENSAJES_ENTRADA_OCULTA: Record<MotivoEntradaOculta, string> = {
  TTY_NO_INTERACTIVA:
    "La entrada estandar no es una terminal interactiva (TTY) -- correr este script en una consola interactiva (PowerShell), nunca con la entrada redirigida desde un archivo o pipe.",
  FALLO_MODO_RAW:
    "No se pudo activar el modo de entrada oculta en esta terminal -- correr este script en una consola interactiva compatible (PowerShell en Windows).",
  CANCELADO_CTRL_C: "Entrada cancelada (Ctrl-C).",
  CANCELADO_CTRL_D: "Entrada cancelada (Ctrl-D).",
  ERROR_INESPERADO: "Ocurrio un error inesperado al leer la entrada -- intenta de nuevo.",
};

/**
 * Traduce cualquier error capturado alrededor de leerPasswordOculta() a
 * un mensaje FIJO para mostrar al usuario -- nunca lee ni imprime
 * err.message ni String(err), bajo ninguna circunstancia. Si err es una
 * EntradaOcultaError conocida, usa el mensaje fijo de su `motivo`; para
 * cualquier otra cosa (lo que no deberia pasar, pero nunca se asume que
 * no puede pasar), usa el mensaje generico ERROR_INESPERADO.
 */
export function mensajeEntradaOculta(err: unknown): string {
  if (err instanceof EntradaOcultaError) {
    return MENSAJES_ENTRADA_OCULTA[err.motivo];
  }
  return MENSAJES_ENTRADA_OCULTA.ERROR_INESPERADO;
}
