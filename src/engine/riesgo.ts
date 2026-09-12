import { ESCALA_VARIABILIDAD, PESO_RIESGO_CRITICIDAD, PESO_RIESGO_VARIABILIDAD, FACTOR_AMORTIGUACION_CON_ALTERNATIVA } from "./constantes";

// Seccion 3 — el riesgo combina la criticidad con la variabilidad de
// salud observada entre ciclos y la disponibilidad de alternativa. Con 0
// o 1 ciclos de historial, la variabilidad es 0 por definicion (no hay
// suficiente muestra) — limitacion v1 conocida, documentada en
// constantes.ts junto a ESCALA_VARIABILIDAD.
export function calcularRiesgo(
  criticidad: number,
  saludActual: number,
  historicoSalud: readonly number[],
  tieneAlternativa: boolean,
): number {
  const serie = [...historicoSalud, saludActual];
  const variabilidad = desviacionEstandar(serie) * ESCALA_VARIABILIDAD;

  const combinado =
    criticidad * PESO_RIESGO_CRITICIDAD + Math.min(100, variabilidad) * PESO_RIESGO_VARIABILIDAD;

  const factor = tieneAlternativa ? FACTOR_AMORTIGUACION_CON_ALTERNATIVA : 1;

  return clamp(combinado * factor, 0, 100);
}

function desviacionEstandar(valores: readonly number[]): number {
  if (valores.length < 2) return 0;
  const promedio = valores.reduce((a, b) => a + b, 0) / valores.length;
  const varianza = valores.reduce((acc, v) => acc + (v - promedio) ** 2, 0) / valores.length;
  return Math.sqrt(varianza);
}

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}
