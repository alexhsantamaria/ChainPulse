// Motor — calcula el indice de integracion global de una empresa (RF16).
import type { ConexionParaIndice, ResultadoIndiceIntegracion } from "@/domain/types";
import { CRITICIDAD_ALTA_UMBRAL, PENALIZACION_POR_SPOF_PUNTOS, SALUD_ACEPTABLE_UMBRAL } from "./constantes";

// RF16 / Seccion 12 — indice de integracion v1: % de conexiones completas
// con salud "aceptable", penalizado por puntos unicos de falla (conexion
// de criticidad Alta o Critica sin alternativa declarada). No se presenta
// como una magnitud cientifica exacta (RF16) — es una hipotesis de
// calibracion inicial, expresa la tesis central del producto (Seccion 1).
export function calcularIndiceIntegracion(
  conexiones: readonly ConexionParaIndice[],
): ResultadoIndiceIntegracion {
  const totalConexiones = conexiones.length;

  if (totalConexiones === 0) {
    return { indiceIntegracion: 0, totalConexiones: 0, conexionesAceptables: 0, puntosUnicosFalla: 0 };
  }

  const conexionesAceptables = conexiones.filter((c) => c.salud >= SALUD_ACEPTABLE_UMBRAL).length;
  const puntosUnicosFalla = conexiones.filter(
    (c) => c.criticidad >= CRITICIDAD_ALTA_UMBRAL && !c.tieneAlternativa,
  ).length;

  const base = (conexionesAceptables / totalConexiones) * 100;
  const penalizado = base - puntosUnicosFalla * PENALIZACION_POR_SPOF_PUNTOS;

  return {
    indiceIntegracion: Math.max(0, penalizado),
    totalConexiones,
    conexionesAceptables,
    puntosUnicosFalla,
  };
}
