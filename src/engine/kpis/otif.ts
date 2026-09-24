// Motor de KPIs -- OTIF (On Time In Full), MVP-DEFINITIVO Seccion 6.3/
// Especificacion V2 Seccion 11.1: "pedidos completos y a tiempo / pedidos
// evaluados". Un pedido cumple OTIF si llego COMPLETO (cantidadEntregada
// >= cantidadPedida) Y A TIEMPO (fechaReal <= fechaPrometida) -- criterio
// estandar de la industria, no una interpretacion propia. Se excluye un
// pedido sin fechaReal o sin cantidadEntregada: todavia no cerro el
// periodo evaluado, no cuenta como incumplimiento (MVP-DEFINITIVO §21
// "datos incompletos producen advertencia").
import { calcularRatio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export interface FilaOtif {
  pedido: string;
  fechaPrometida: Date;
  fechaReal: Date | null;
  cantidadPedida: number;
  cantidadEntregada: number | null;
}

export function calcularOtif(filas: readonly FilaOtif[]): ResultadoCalculoKpi {
  return calcularRatio(
    filas,
    (fila) => {
      if (fila.fechaReal === null || fila.cantidadEntregada === null || fila.cantidadPedida <= 0) {
        return null;
      }
      const completo = fila.cantidadEntregada >= fila.cantidadPedida;
      const aTiempo = fila.fechaReal.getTime() <= fila.fechaPrometida.getTime();
      return { numerador: completo && aTiempo ? 1 : 0, denominador: 1 };
    },
    "falta fecha real o cantidad entregada (pedido todavia no cerrado)",
  );
}
