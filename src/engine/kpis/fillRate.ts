// Motor de KPIs -- Fill Rate: "unidades servidas / unidades solicitadas".
// `servido` se limita a `solicitado` (nunca aporta mas de 100% por una
// fila sobre-servida) -- criterio estandar de fill rate, evita que un
// error de captura infle el KPI agregado.
import { calcularRatio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export interface FilaFillRate {
  sku: string;
  pedido: string;
  solicitado: number;
  servido: number | null;
}

export function calcularFillRate(filas: readonly FilaFillRate[]): ResultadoCalculoKpi {
  return calcularRatio(
    filas,
    (fila) => {
      if (fila.servido === null || fila.solicitado <= 0) return null;
      return { numerador: Math.min(fila.servido, fila.solicitado), denominador: fila.solicitado };
    },
    "falta la cantidad servida",
  );
}
