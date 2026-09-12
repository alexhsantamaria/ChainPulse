import type { RespuestaLikert, ResultadoSalud } from "@/domain/types";
import { LIKERT_MAX, LIKERT_MIN } from "./constantes";

// RF6 / Seccion 12 — calcula la salud de UNA conexion a partir de sus
// respuestas crudas de un ciclo. Escala Likert 1-5, normalizada a 0-100.
// "noAplica" excluye la pregunta del calculo por completo (no es un cero).
// "noSabe" tampoco se promedia como cero: se registra aparte y reduce la
// cobertura de confianza, sin arrastrar la salud hacia abajo.
export function calcularSalud(respuestas: readonly RespuestaLikert[]): ResultadoSalud {
  const noAplica = respuestas.filter((r) => r.noAplica);
  const consideradas = respuestas.filter((r) => !r.noAplica);
  const noSabe = consideradas.filter((r) => r.noSabe);
  const validas = consideradas.filter((r) => !r.noSabe && r.valor !== null);

  if (validas.length === 0) {
    return {
      salud: null,
      respuestasValidas: 0,
      respuestasNoSabe: noSabe.length,
      respuestasNoAplica: noAplica.length,
      coberturaConfianza: consideradas.length > 0 ? 0 : null,
    };
  }

  const suma = validas.reduce((acc, r) => acc + (r.valor as number), 0);
  const promedio = suma / validas.length;
  const salud = normalizarLikertA100(promedio);

  return {
    salud,
    respuestasValidas: validas.length,
    respuestasNoSabe: noSabe.length,
    respuestasNoAplica: noAplica.length,
    coberturaConfianza: consideradas.length > 0 ? validas.length / consideradas.length : null,
  };
}

function normalizarLikertA100(promedio: number): number {
  const clamped = Math.min(LIKERT_MAX, Math.max(LIKERT_MIN, promedio));
  return ((clamped - LIKERT_MIN) / (LIKERT_MAX - LIKERT_MIN)) * 100;
}
