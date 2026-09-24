// Motor de KPIs -- Stockout: "eventos o periodos sin stock / base
// definida". Nota de diseno (no validada con datos reales, mismo espiritu
// que las notas de src/engine/cadena/compararCadena.ts): "base definida"
// no especifica un algoritmo exacto en MVP-DEFINITIVO -- se interpreta
// aca como el total de observaciones (SKU/ubicacion/fecha) efectivamente
// evaluadas en el periodo, cada una con un `conStock` declarado.
// Avisale a Alex si el criterio real deberia ser otro (ej. dias-SKU en
// vez de observaciones puntuales).
import { calcularRatio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export interface FilaStockout {
  sku: string;
  ubicacion: string;
  fecha: Date;
  conStock: boolean | null;
}

export function calcularStockout(filas: readonly FilaStockout[]): ResultadoCalculoKpi {
  return calcularRatio(
    filas,
    (fila) => {
      if (fila.conStock === null) return null;
      return { numerador: fila.conStock ? 0 : 1, denominador: 1 };
    },
    "no se declaro si hubo stock disponible",
  );
}
