// Motor de KPIs -- Tiempo de deteccion: "deteccion - ocurrencia". `inicio`
// es la fecha/hora de ocurrencia del incidente, `fin` la de su deteccion.
import { calcularTiempoEntreEventos, type FilaTiempoEntreEventos } from "./tiempoEntreEventos";
import type { ResultadoCalculoKpi } from "./constantes";

export type { FilaTiempoEntreEventos };

export function calcularTiempoDeteccion(filas: readonly FilaTiempoEntreEventos[]): ResultadoCalculoKpi {
  return calcularTiempoEntreEventos(filas, "falta la fecha/hora de deteccion, o es anterior a la ocurrencia");
}
