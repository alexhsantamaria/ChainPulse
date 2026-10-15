// Infraestructura (PURA) -- helpers compartidos de plantillas
// deterministicas e interpolacion (I5-12/I5-18/I5-21/I5-23). Decision de
// producto ya aprobada por Alex (Seccion 4 de la autorizacion):
// "Las explicaciones se generan mediante plantillas determinísticas e
// interpolación de resultados calculados... Nunca inventar causas." Estas
// funciones NUNCA generan texto libre -- solo interpolan numeros/strings
// ya calculados en frases fijas. Cada ejecutor de src/engine/queries/*.ts
// las reutiliza en vez de construir sus strings de respuesta a mano,
// mismo criterio de "biblioteca compartida" que Programa ChainPulse 53+
// v3 (Punto 2, fila I5-21) preveía para I5-12/I5-21.

/** Formatea una fraccion 0..1 (convencion de ResultadoCalculoKpi, ver
 * src/engine/kpis/constantes.ts) como porcentaje de 1 decimal, o "sin
 * datos" si es null -- NUNCA un 0% disfrazado de dato real. */
export function formatearPorcentaje(valorFraccion: number | null): string {
  if (valorFraccion === null) return "sin datos suficientes";
  return `${(valorFraccion * 100).toFixed(1)}%`;
}

/** Variacion en puntos porcentuales entre dos fracciones 0..1 -- null si
 * cualquiera de los dos falta (nunca una resta contra 0 disfrazada de
 * variacion real). */
export function formatearVariacionPuntos(actual: number | null, anterior: number | null): string {
  if (actual === null || anterior === null) return "sin datos suficientes para comparar";
  const puntos = (actual - anterior) * 100;
  const signo = puntos >= 0 ? "+" : "";
  return `${signo}${puntos.toFixed(1)} puntos`;
}

/** Plantilla fija del mensaje "no puedo responder todavia" (I5-25) --
 * UNICO lugar que arma este texto, para que las 6 preguntas lo redacten
 * igual. */
export function mensajeSinDatos(motivo: string): string {
  return `No puedo responder todavía: ${motivo}.`;
}

/** Plantilla fija de "como comprobarlo" -- interpolacion simple sobre una
 * instruccion ya determinada por el ejecutor (nunca texto libre). */
export function construirComoComprobar(instruccion: string): string {
  return `Para comprobarlo: ${instruccion}`;
}
