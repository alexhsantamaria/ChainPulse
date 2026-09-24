// Motor de KPIs -- Porcentaje de observaciones sin stock. Reglas CERRADAS
// por Alex el 2026-09-24 en TRES rondas de revision (cada ronda mas
// precisa que la anterior -- esta es la version vigente, incorpora las
// tres) "para evitar interpretaciones ambiguas". Son reglas propuestas
// para el MVP, NO resultados validados con datos reales.
//
// Formula: 100 x observaciones validas con stock disponible <= 0 /
// observaciones validas. Esta funcion devuelve `valor` como FRACCION
// (0..1, mismo criterio que el resto de los KPIs de "%" -- ver
// constantes.ts), NUNCA 0..100; el x100 de la formula de Alex lo aplica
// la capa de UI al mostrarlo, no este motor.
//
// Reglas (Alex, 2026-09-24, rondas 1-2):
// 1. Una observacion = SKU + ubicacion + fecha de corte (dia calendario,
//    nunca fecha/hora).
// 2. Contar UNA sola observacion por combinacion:
//    - Si dos o mas filas de la misma combinacion coinciden exactamente
//      son redundancia de captura -- se colapsan a una sola, sin perder
//      informacion.
//    - Si DIFIEREN es un conflicto real, no una redundancia -- se
//      EXCLUYEN del calculo hasta resolverse y se reportan como
//      conflicto. Nunca se elige una "ganadora" en silencio (ni la
//      primera ni la ultima).
// 3. Un stock faltante o no numerico se excluye y se informa -- nunca se
//    convierte en 0 (ni en "con stock" ni en "sin stock").
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
// Reglas (Alex, 2026-09-24, ronda 3 -- precisiones adicionales):
// 7. La fecha de corte usa el dia calendario segun una ZONA HORARIA
//    explicita (parametro `zonaHoraria`, ej. "America/Lima"), no UTC --
//    "usar una fecha diaria según la zona horaria definida para la
//    cadena". De donde sale ese valor (Cadena, DefinicionKpi u otro
//    campo) lo decide el caller; esta funcion pura solo recibe la zona
//    ya resuelta. Si hay varias mediciones intradia para la misma
//    observacion, la regla 2 ya las trata como duplicado (colapso si
//    coinciden, conflicto senalado si difieren) -- no hay una "eleccion
//    de cual representa el cierre" adicional que resolver aca.
// 8. El stock se recibe como valor CRUDO con signo (`stockDisponible`,
//    numero o null), no como booleano pre-derivado -- asi esta funcion
//    puede aplicar su propia regla de signo en vez de heredar una
//    conversion hecha aguas arriba. Un saldo NEGATIVO cuenta como
//    observacion SIN STOCK (entra al numerador, igual que <= 0) Y se
//    señala aparte como anomalia para revision -- no se excluye, no es
//    lo mismo que un dato faltante.
//
// LIMITACION QUE DEBE MOSTRARSE (Alex, 2026-09-24, explicito -- no solo
// un comentario de codigo, tiene que llegar al catalogo funcional /
// DefinicionKpi.descripcion): esta es una tasa de OBSERVACIONES, no un
// promedio de tasas por SKU -- un SKU observado mas veces en el periodo
// pesa mas en el resultado. Ver prisma/seedDefinicionesKpi.ts.
//
// Productos inactivos (`activo === false`, de la primera ronda de
// revision): se mantiene como exclusion adicional.
import { calcularRatio, diaEnZona } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export interface FilaStockout {
  sku: string;
  ubicacion: string;
  // Fecha de corte de la observacion -- el dia calendario se calcula con
  // la zona horaria que recibe calcularStockout, no en UTC.
  fecha: Date;
  // Valor crudo de stock disponible (con signo). null/NaN = faltante o no
  // numerico -- se excluye (regla 3). Cero o negativo = sin stock (regla
  // implicita "stock <= 0"); negativo ademas se señala como anomalia
  // (regla 8).
  stockDisponible: number | null;
  // Producto inactivo/descontinuado. Opcional, default "activo" (true) si
  // se omite, para no romper filas que no declaran este campo.
  activo?: boolean;
}

function claveObservacion(fila: FilaStockout, zonaHoraria: string): string {
  return `${fila.sku}|${fila.ubicacion}|${diaEnZona(fila.fecha, zonaHoraria)}`;
}

function mismaObservacion(a: FilaStockout, b: FilaStockout): boolean {
  return a.stockDisponible === b.stockDisponible && (a.activo ?? true) === (b.activo ?? true);
}

function esValorValido(stock: number | null): stock is number {
  return stock !== null && Number.isFinite(stock);
}

/**
 * @param zonaHoraria Zona horaria IANA (ej. "America/Lima") usada para
 * calcular el dia calendario de `fecha` en cada fila -- regla 7. El
 * caller la resuelve (Cadena/DefinicionKpi/otro); esta funcion no asume
 * ningun valor por defecto.
 */
export function calcularStockout(filas: readonly FilaStockout[], zonaHoraria: string): ResultadoCalculoKpi {
  const porClave = new Map<string, FilaStockout[]>();
  for (const fila of filas) {
    const clave = claveObservacion(fila, zonaHoraria);
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

  // Anomalia (regla 8): saldo negativo, contado como sin stock pero
  // señalado aparte -- se mide sobre las filas que SI entran al calculo
  // (activo !== false y stock valido).
  const negativos = filasAEvaluar.filter(
    (fila) => fila.activo !== false && esValorValido(fila.stockDisponible) && fila.stockDisponible < 0,
  ).length;

  const base = calcularRatio(
    filasAEvaluar,
    (fila) => {
      if (fila.activo === false || !esValorValido(fila.stockDisponible)) return null;
      return { numerador: fila.stockDisponible <= 0 ? 1 : 0, denominador: 1 };
    },
    "sin dato de stock declarado o producto inactivo",
  );

  const notaNegativos =
    negativos > 0
      ? [
          `${negativos} observacion(es) con stock disponible negativo -- contabilizadas como sin stock, señaladas como anomalia para revision.`,
        ]
      : [];

  if (duplicadosColapsados === 0 && duplicadosConflicto === 0) {
    return { ...base, advertencias: [...notaNegativos, ...base.advertencias] };
  }

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
    advertencias: [...notaColapso, ...notaConflicto, ...notaNegativos, ...base.advertencias],
  };
}
