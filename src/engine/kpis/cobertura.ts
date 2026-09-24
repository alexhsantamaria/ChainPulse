// Motor de KPIs -- Cobertura de inventario: "inventario disponible /
// consumo diario esperado". Nota de diseno (no validada con datos
// reales): con varias filas (varios SKU, o el mismo SKU en distintos
// periodos) se agrega como PROMEDIO PONDERADO (suma de inventario / suma
// de consumo), no como promedio simple de la cobertura de cada fila --
// evita que un SKU de consumo casi nulo (cobertura enorme en dias)
// distorsione el promedio de todos los demas. Avisale a Alex si el
// criterio real deberia ser el promedio simple por SKU.
import { calcularRatio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export interface FilaCobertura {
  sku: string;
  inventarioDisponible: number;
  consumoDiarioEsperado: number;
}

export function calcularCobertura(filas: readonly FilaCobertura[]): ResultadoCalculoKpi {
  return calcularRatio(
    filas,
    (fila) => {
      if (fila.consumoDiarioEsperado <= 0 || fila.inventarioDisponible < 0) return null;
      return { numerador: fila.inventarioDisponible, denominador: fila.consumoDiarioEsperado };
    },
    "consumo diario esperado invalido o inventario negativo",
  );
}
