// Motor de KPIs -- Porcentaje de observaciones sin stock. Reglas CERRADAS
// por Alex el 2026-09-24 (segunda revision, mas precisa que la primera --
// esta es la version vigente) "para evitar interpretaciones ambiguas".
// Son reglas propuestas para el MVP, NO resultados validados con datos
// reales.
//
// Formula: 100 x observaciones validas con stock disponible <= 0 /
// observaciones validas. Esta funcion devuelve `valor` como FRACCION
// (0..1, mismo criterio que el resto de los KPIs de "%" -- ver
// constantes.ts), NUNCA 0..100; el x100 de la formula de Alex lo aplica
// la capa de UI al mostrarlo, no este motor.
//
// Reglas (Alex, 2026-09-24):
// 1. Una observacion = SKU + ubicacion + fecha de corte (dia calendario,
//    nunca fecha/hora).
// 2. Contar UNA sola observacion por combinacion:
//    - Si dos o mas filas de la misma combinacion coinciden exactamente
//      (mismo conStock, mismo activo) son redundancia de captura -- se
//      colapsan a una sola, sin perder informacion.
//    - Si DIFIEREN (ej. una dice "con stock" y otra "sin stock" el mismo
//      dia) es un conflicto real, no una redundancia -- se SEÑALAN para
//      resolver a mano y se EXCLUYEN del calculo. Nunca se elige una
//      "ganadora" en silencio (ni la primera ni la ultima).
// 3. Un stock faltante o no numerico (`conStock === null`, ya derivado
//    aguas arriba por Bloque B a partir del valor crudo) se excluye y se
//    informa -- nunca se convierte en 0 (ni en "con stock" ni en "sin
//    stock").
// 4. Si no hay observaciones validas, el resultado es "Sin datos
//    suficientes" (`valor: null`, ver constantes.ts/compartido.ts).
// 5. El resultado expone numerador, denominador y observaciones
//    excluidas (`ResultadoCalculoKpi`) -- el PERIODO lo determina el
//    caller (Bloque B) al filtrar las filas antes de pasarlas aca; esta
//    funcion no conoce el periodo, solo calcula sobre las filas que
//    recibe.
// 6. Nunca se completan fechas sin registro (no hay relleno de dias
//    faltantes) ni se lo llama "porcentaje de dias sin stock" -- esta
//    funcion describe la MUESTRA REGISTRADA, no una serie temporal
//    continua.
//
// LIMITACION QUE DEBE MOSTRARSE (Alex, 2026-09-24, explicito -- no solo
// un comentario de codigo, tiene que llegar al catalogo funcional /
// DefinicionKpi.descripcion): esta es una tasa de OBSERVACIONES, no un
// promedio de tasas por SKU -- un SKU observado mas veces en el periodo
// pesa mas en el resultado. Ver prisma/seedDefinicionesKpi.ts.
//
// Productos inactivos (`activo === false`, de la primera ronda de
// revision): se mantiene como exclusion adicional -- Alex no la retiro en
// la segunda ronda, y no entra en conflicto con las reglas de arriba.
import { calcularRatio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export interface FilaStockout {
  sku: string;
  ubicacion: string;
  // Fecha de corte de la observacion -- dia calendario; la hora, si el
  // dato de origen la trae, se ignora para la clave de deduplicacion.
  fecha: Date;
  conStock: boolean | null;
  // Producto inactivo/descontinuado. Opcional, default "activo" (true) si
  // se omite, para no romper filas que no declaran este campo.
  activo?: boolean;
}

function claveObservacion(fila: FilaStockout): string {
  const dia = fila.fecha.toISOString().slice(0, 10);
  return `${fila.sku}|${fila.ubicacion}|${dia}`;
}

function mismaObservacion(a: FilaStockout, b: FilaStockout): boolean {
  return a.conStock === b.conStock && (a.activo ?? true) === (b.activo ?? true);
}

export function calcularStockout(filas: readonly FilaStockout[]): ResultadoCalculoKpi {
  const porClave = new Map<string, FilaStockout[]>();
  for (const fila of filas) {
    const clave = claveObservacion(fila);
    const grupo = porClave.get(clave);
    if (grupo) grupo.push(fila);
    else porClave.set(clave, [fila]);
  }

  const filasAEvaluar: FilaStockout[] = [];
  let duplicadosColapsados = 0;
  let duplicadosConflicto = 0;

  for (const grupo of porClave.values()) {
    const primero = grupo[0];
    if (!primero) continue;
    if (grupo.length === 1) {
      filasAEvaluar.push(primero);
      continue;
    }
    if (grupo.every((f) => mismaObservacion(f, primero))) {
      duplicadosColapsados += grupo.length - 1;
      filasAEvaluar.push(primero);
    } else {
      // Conflicto real: ninguna fila del grupo entra al calculo -- se
      // excluyen todas, no se elige una "ganadora" en silencio (regla 2).
      duplicadosConflicto += grupo.length;
    }
  }

  const base = calcularRatio(
    filasAEvaluar,
    (fila) => {
      if (fila.activo === false || fila.conStock === null) return null;
      return { numerador: fila.conStock ? 0 : 1, denominador: 1 };
    },
    "sin dato de stock declarado o producto inactivo",
  );

  if (duplicadosColapsados === 0 && duplicadosConflicto === 0) return base;

  const notaColapso =
    duplicadosColapsados > 0
      ? [`${duplicadosColapsados} observacion(es) duplicada(s) con el mismo valor (mismo SKU/ubicacion/fecha de corte) -- colapsadas a una sola.`]
      : [];
  const notaConflicto =
    duplicadosConflicto > 0
      ? [
          `${duplicadosConflicto} observacion(es) en conflicto (mismo SKU/ubicacion/fecha de corte, valores distintos) -- señaladas para resolver a mano, excluidas del calculo.`,
        ]
      : [];

  const filasExcluidas = base.filasExcluidas + duplicadosConflicto;
  const total = base.filasEvaluadas + filasExcluidas;

  return {
    ...base,
    filasExcluidas,
    cobertura: total === 0 ? 0 : base.filasEvaluadas / total,
    advertencias: [...notaColapso, ...notaConflicto, ...base.advertencias],
  };
}
