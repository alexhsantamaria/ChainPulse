import type { DatosCriticidad } from "@/domain/types";
import {
  FACTOR_AMORTIGUACION_CON_ALTERNATIVA,
  PESO_IMPACTO,
  PESO_TIEMPO_RECUPERACION,
  PESO_TIEMPO_TOLERABLE,
  PUNTOS_IMPACTO,
  PUNTOS_TIEMPO_RECUPERACION,
  PUNTOS_TIEMPO_TOLERABLE,
} from "./constantes";

// RF3 / Seccion 3 — calcula la criticidad (0-100) de una conexion a
// partir de sus datos estaticos, declarados una sola vez. Formula v1,
// hipotesis de calibracion (Seccion 12): combinacion ponderada de
// impacto, tiempo tolerable y tiempo de recuperacion, amortiguada si
// existe una alternativa declarada.
export function calcularCriticidad(datos: DatosCriticidad): number {
  const puntosImpacto = PUNTOS_IMPACTO[datos.impactoPromesaCliente] ?? 0;
  const puntosTolerable = PUNTOS_TIEMPO_TOLERABLE[datos.tiempoTolerable] ?? 0;
  const puntosRecuperacion = PUNTOS_TIEMPO_RECUPERACION[datos.tiempoRecuperacion] ?? 0;

  const combinado =
    puntosImpacto * PESO_IMPACTO +
    puntosTolerable * PESO_TIEMPO_TOLERABLE +
    puntosRecuperacion * PESO_TIEMPO_RECUPERACION;

  const factor = datos.tieneAlternativa ? FACTOR_AMORTIGUACION_CON_ALTERNATIVA : 1;

  return clamp(combinado * factor, 0, 100);
}

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}
