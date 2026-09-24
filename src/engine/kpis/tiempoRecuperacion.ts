// Motor de KPIs -- Tiempo de recuperacion: "recuperacion - interrupcion".
// `inicio` es la fecha/hora de interrupcion, `fin` la de la recuperacion
// completa.
import { calcularTiempoEntreEventos, type FilaTiempoEntreEventos } from "./tiempoEntreEventos";
import type { ResultadoCalculoKpi } from "./constantes";

export type { FilaTiempoEntreEventos };

export function calcularTiempoRecuperacion(filas: readonly FilaTiempoEntreEventos[]): ResultadoCalculoKpi {
  return calcularTiempoEntreEventos(filas, "falta la fecha/hora de recuperacion, o es anterior a la interrupcion");
}
