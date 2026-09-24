// Motor de KPIs -- Lead time: "fecha fin - fecha inicio", promedio en
// dias sobre los procesos evaluados.
import { calcularPromedio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export const MS_POR_DIA = 1000 * 60 * 60 * 24;

export interface FilaLeadTime {
  proceso: string;
  inicio: Date;
  fin: Date | null;
}

export function calcularLeadTime(filas: readonly FilaLeadTime[]): ResultadoCalculoKpi {
  return calcularPromedio(
    filas,
    (fila) => {
      if (fila.fin === null) return null;
      const dias = (fila.fin.getTime() - fila.inicio.getTime()) / MS_POR_DIA;
      return dias >= 0 ? dias : null;
    },
    "falta la fecha de fin, o la fecha de fin es anterior al inicio",
  );
}
