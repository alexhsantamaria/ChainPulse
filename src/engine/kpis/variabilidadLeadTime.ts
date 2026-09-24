// Motor de KPIs -- Variabilidad de lead time: desviacion estandar
// muestral de los lead times de procesos comparables (mismos campos que
// Lead time, MS_POR_DIA compartido -- ver leadTime.ts).
import { calcularDesviacionEstandar } from "./compartido";
import { MS_POR_DIA, type FilaLeadTime } from "./leadTime";
import type { ResultadoCalculoKpi } from "./constantes";

export type { FilaLeadTime };

export function calcularVariabilidadLeadTime(filas: readonly FilaLeadTime[]): ResultadoCalculoKpi {
  return calcularDesviacionEstandar(
    filas,
    (fila) => {
      if (fila.fin === null) return null;
      const dias = (fila.fin.getTime() - fila.inicio.getTime()) / MS_POR_DIA;
      return dias >= 0 ? dias : null;
    },
    "falta la fecha de fin, o la fecha de fin es anterior al inicio",
  );
}
