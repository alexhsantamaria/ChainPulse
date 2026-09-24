// Motor de KPIs -- helper compartido por los 3 KPIs de "tiempo entre dos
// eventos de un incidente" (deteccion, decision, recuperacion): misma
// forma de fila, mismo calculo (promedio en horas), solo cambia que dos
// eventos concretos se estan comparando. Mismo patron de helper
// compartido que dimensionSimple.ts en src/engine/v2/.
import { calcularPromedio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

const MS_POR_HORA = 1000 * 60 * 60;

// `inicio`/`fin` son deliberadamente genericos -- cada KPI wrapper
// (tiempoDeteccion.ts/tiempoDecision.ts/tiempoRecuperacion.ts) documenta,
// en su propio comentario, que par de eventos representan.
export interface FilaTiempoEntreEventos {
  incidente: string;
  inicio: Date;
  fin: Date | null;
}

export function calcularTiempoEntreEventos(
  filas: readonly FilaTiempoEntreEventos[],
  motivoExclusion: string,
): ResultadoCalculoKpi {
  return calcularPromedio(
    filas,
    (fila) => {
      if (fila.fin === null) return null;
      const horas = (fila.fin.getTime() - fila.inicio.getTime()) / MS_POR_HORA;
      return horas >= 0 ? horas : null;
    },
    motivoExclusion,
  );
}
