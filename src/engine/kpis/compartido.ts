// Motor de KPIs -- helpers compartidos por las funciones de calculo de
// src/engine/kpis/*.ts (Incremento 4 Bloque A). Tres formas de agregacion
// cubren los 10 KPIs del catalogo inicial:
//   - calcularRatio: suma de contribuciones numerador/denominador fila a
//     fila (OTIF, Fill Rate, Stockout, Cobertura, OTIF proveedor -- los 5
//     KPIs que MVP-DEFINITIVO expresa como "X / Y").
//   - calcularPromedio: promedio simple de un valor numerico por fila
//     (Lead time, Tiempo de deteccion/decision/recuperacion -- los 4 KPIs
//     de "fecha fin - fecha inicio").
//   - calcularDesviacionEstandar: dispersion de un valor numerico por fila
//     (Variabilidad de lead time, el unico KPI que no es ratio ni
//     promedio).
// Todas son funciones puras: reciben solo filas ya tipadas (nunca Prisma
// ni infra), mismo criterio de pureza que el resto de src/engine/ (ADR-0002).
import { RULE_VERSION_KPIS, type ResultadoCalculoKpi } from "./constantes";

function cobertura(filasEvaluadas: number, filasExcluidas: number): number {
  const total = filasEvaluadas + filasExcluidas;
  return total === 0 ? 0 : filasEvaluadas / total;
}

function advertenciasBase(filasEvaluadas: number, filasExcluidas: number, motivoExclusion: string): string[] {
  const advertencias: string[] = [];
  if (filasExcluidas > 0) {
    advertencias.push(`${filasExcluidas} fila(s) excluida(s): ${motivoExclusion}.`);
  }
  if (filasEvaluadas === 0) {
    advertencias.push("Sin datos suficientes para calcular este KPI en el periodo evaluado.");
  }
  return advertencias;
}

/**
 * Ratio de suma de contribuciones: cada fila aporta {numerador,
 * denominador} (o se excluye devolviendo null / un denominador <= 0).
 * `motivoExclusion` describe, en una frase, por que una fila excluida no
 * es evaluable (para la advertencia visible al usuario, MVP-DEFINITIVO
 * §21 "datos incompletos producen advertencia").
 */
export function calcularRatio<T>(
  filas: readonly T[],
  evaluar: (fila: T) => { numerador: number; denominador: number } | null,
  motivoExclusion: string,
): ResultadoCalculoKpi {
  let numerador = 0;
  let denominador = 0;
  let filasEvaluadas = 0;
  let filasExcluidas = 0;

  for (const fila of filas) {
    const contribucion = evaluar(fila);
    if (!contribucion || contribucion.denominador <= 0) {
      filasExcluidas += 1;
      continue;
    }
    numerador += contribucion.numerador;
    denominador += contribucion.denominador;
    filasEvaluadas += 1;
  }

  return {
    valor: denominador > 0 ? numerador / denominador : null,
    numerador: filasEvaluadas > 0 ? numerador : null,
    denominador: filasEvaluadas > 0 ? denominador : null,
    filasEvaluadas,
    filasExcluidas,
    cobertura: cobertura(filasEvaluadas, filasExcluidas),
    advertencias: advertenciasBase(filasEvaluadas, filasExcluidas, motivoExclusion),
    ruleVersion: RULE_VERSION_KPIS,
  };
}

/**
 * Promedio simple de un valor numerico por fila (`evaluar` devuelve el
 * valor, o null si la fila se excluye). `numerador` es la suma,
 * `denominador` la cantidad de filas evaluadas.
 */
export function calcularPromedio<T>(
  filas: readonly T[],
  evaluar: (fila: T) => number | null,
  motivoExclusion: string,
): ResultadoCalculoKpi {
  const valores: number[] = [];
  let filasExcluidas = 0;

  for (const fila of filas) {
    const valor = evaluar(fila);
    if (valor === null) {
      filasExcluidas += 1;
      continue;
    }
    valores.push(valor);
  }

  const suma = valores.reduce((acc, v) => acc + v, 0);
  const filasEvaluadas = valores.length;

  return {
    valor: filasEvaluadas > 0 ? suma / filasEvaluadas : null,
    numerador: filasEvaluadas > 0 ? suma : null,
    denominador: filasEvaluadas > 0 ? filasEvaluadas : null,
    filasEvaluadas,
    filasExcluidas,
    cobertura: cobertura(filasEvaluadas, filasExcluidas),
    advertencias: advertenciasBase(filasEvaluadas, filasExcluidas, motivoExclusion),
    ruleVersion: RULE_VERSION_KPIS,
  };
}

/**
 * Desviacion estandar MUESTRAL (n-1) de un valor numerico por fila --
 * requiere al menos 2 filas evaluables, mismo criterio de "dispersion
 * sobre lead times comparables" de MVP-DEFINITIVO. `numerador`/
 * `denominador` quedan null a proposito: no hay una fraccion natural para
 * una desviacion estandar, a diferencia de calcularRatio/calcularPromedio.
 */
export function calcularDesviacionEstandar<T>(
  filas: readonly T[],
  evaluar: (fila: T) => number | null,
  motivoExclusion: string,
): ResultadoCalculoKpi {
  const valores: number[] = [];
  let filasExcluidas = 0;

  for (const fila of filas) {
    const valor = evaluar(fila);
    if (valor === null) {
      filasExcluidas += 1;
      continue;
    }
    valores.push(valor);
  }

  const filasEvaluadas = valores.length;
  const advertencias = advertenciasBase(filasEvaluadas, filasExcluidas, motivoExclusion);

  if (filasEvaluadas < 2) {
    if (filasEvaluadas === 1) {
      advertencias.push("Se necesitan al menos 2 observaciones comparables para calcular variabilidad; solo hay 1.");
    }
    return {
      valor: null,
      numerador: null,
      denominador: null,
      filasEvaluadas,
      filasExcluidas,
      cobertura: cobertura(filasEvaluadas, filasExcluidas),
      advertencias,
      ruleVersion: RULE_VERSION_KPIS,
    };
  }

  const promedio = valores.reduce((acc, v) => acc + v, 0) / filasEvaluadas;
  const sumaCuadrados = valores.reduce((acc, v) => acc + (v - promedio) ** 2, 0);
  const desviacion = Math.sqrt(sumaCuadrados / (filasEvaluadas - 1));

  return {
    valor: desviacion,
    numerador: null,
    denominador: null,
    filasEvaluadas,
    filasExcluidas,
    cobertura: cobertura(filasEvaluadas, filasExcluidas),
    advertencias,
    ruleVersion: RULE_VERSION_KPIS,
  };
}
