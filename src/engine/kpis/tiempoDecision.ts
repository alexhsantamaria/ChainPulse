// Motor de KPIs -- Tiempo de decision: "decision - deteccion". `inicio`
// es la fecha/hora de deteccion, `fin` la de la decision tomada.
import { calcularTiempoEntreEventos, type FilaTiempoEntreEventos } from "./tiempoEntreEventos";
import type { ResultadoCalculoKpi } from "./constantes";

export type { FilaTiempoEntreEventos };

export function calcularTiempoDecision(filas: readonly FilaTiempoEntreEventos[]): ResultadoCalculoKpi {
  return calcularTiempoEntreEventos(filas, "falta la fecha/hora de decision, o es anterior a la deteccion");
}
