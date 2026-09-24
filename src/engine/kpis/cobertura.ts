// Motor de KPIs -- Cobertura de inventario. Reglas CERRADAS por Alex el
// 2026-09-24 en TRES rondas de revision (cada ronda mas precisa que la
// anterior -- esta es la version vigente, incorpora las tres) "para
// evitar interpretaciones ambiguas". Son reglas propuestas para el MVP,
// NO resultados validados con datos reales.
//
// Formula por fila: inventario disponible a la fecha de corte / consumo
// diario esperado (dias de cobertura). SIEMPRE por SKU + ubicacion +
// fecha de corte -- NO existe en esta implementacion ningun agregado
// entre SKU (ni siquiera opcional/etiquetado): "la agregacion de
// cobertura entre SKU queda fuera de esta implementacion hasta acordar su
// metodologia" (Alex, 2026-09-24). Un caller que quiera comparar SKU debe
// iterar `porSku`, nunca sumar `coberturaDias` ni promediarlos aqui.
// Tampoco se suman inventarios de distintas fechas -- cada fila es una
// foto puntual, nunca se mezcla con otra fecha de corte.
//
// Reglas (Alex, 2026-09-24, rondas 1-2):
// 1. Inventario y consumo deben usar la MISMA UNIDAD. El consumo debe
//    estar expresado por dia (su periodo de referencia lo determina el
//    caller, igual que con Stockout -- esta funcion no lo conoce).
// 2. Consumo positivo e inventario cero -> 0 dias (CALCULADA, no un caso
//    especial: 0 / consumo_positivo = 0 es una cobertura real y grave).
// 3. Consumo cero -> "Sin consumo de referencia" (SIN_CONSUMO_REFERENCIA),
//    SIN resultado numerico -- nunca 0 dias, nunca se omite la fila.
// 4. Consumo o inventario faltante (null/undefined) -> "Datos incompletos"
//    (DATOS_INCOMPLETOS).
// 5. Valores negativos (inventario o consumo) -> se señalan para revision
//    (VALOR_NEGATIVO); nunca se convierten silenciosamente (ni a 0 ni a su
//    valor absoluto).
// 6. Unidades incompatibles entre inventarioDisponible y consumoDiario
//    esperado para la misma fila -> UNIDADES_INCOMPATIBLES, sin resultado
//    numerico.
// 7. Duplicados (misma SKU+ubicacion+fecha de corte): si coinciden
//    exactamente, se colapsan a una sola fila (redundancia de captura);
//    si difieren, TODAS las filas del grupo se señalan como DUPLICADO y
//    quedan excluidas del calculo -- mismo criterio que Stockout (ver
//    stockout.ts), nunca se elige una "ganadora" en silencio.
//
// Reglas (Alex, 2026-09-24, ronda 3 -- precisiones adicionales):
// 8. La fecha de corte usa el dia calendario segun una ZONA HORARIA
//    explicita (parametro `zonaHoraria`), no UTC -- misma regla y mismo
//    helper compartido (`diaEnZona`) que Stockout. Forma parte de la
//    clave de identidad de la fila (junto con SKU+ubicacion): dos filas
//    del mismo SKU+ubicacion en fechas de corte distintas NO son
//    duplicados entre si, son observaciones independientes -- nunca se
//    suman ni se comparan como si fueran la misma foto.
// 9. `inventarioDisponible` debe ser un campo declarado explicitamente
//    como tal por el origen del dato -- esta funcion no lo sustituye en
//    silencio por "inventario fisico" ni le descuenta reservas. Si en
//    algun momento hace falta esa conversion (inventario fisico menos
//    reservas, por ejemplo), debe ser una regla documentada y aplicada
//    ANTES de que la fila llegue aca (en Bloque B/ingesta), nunca dentro
//    de este calculo.
//
// Ejemplo (Alex, 2026-09-24) -- SKU A: 100 unid inventario, 10 unid/dia
// consumo -> 10 dias. SKU B: 0 unid inventario, 5 unid/dia consumo -> 0
// dias. Deben mostrarse AMBOS resultados por separado; nunca un resumen
// como "6,67 dias", porque ocultaria que B no tiene inventario.
import { diaEnZona } from "./compartido";
import type { ResultadoCalculoKpi as ResultadoCalculoKpiGenerico } from "./constantes";
import { RULE_VERSION_KPIS } from "./constantes";

export interface FilaCobertura {
  sku: string;
  ubicacion: string;
  // Fecha de corte de la observacion -- una fila = una foto del inventario
  // y el consumo esperado a esa fecha. El dia calendario se calcula con
  // la zona horaria que recibe calcularCobertura, no en UTC (regla 8).
  fecha: Date;
  // Campo explicito de inventario disponible -- nunca "inventario fisico"
  // sustituido en silencio, ver regla 9. Nullable: un valor faltante es
  // "Datos incompletos", nunca se trata como cero.
  inventarioDisponible: number | null;
  consumoDiarioEsperado: number | null;
  // Requeridas para validar la regla 1 (misma unidad). No se asume nada
  // por default -- si vienen vacias, se tratan como incompatibles (no se
  // puede confirmar que coinciden).
  unidadInventario: string;
  unidadConsumoDiario: string;
}

export type EstadoCoberturaFila =
  | "CALCULADA"
  | "SIN_CONSUMO_REFERENCIA"
  | "DATOS_INCOMPLETOS"
  | "VALOR_NEGATIVO"
  | "UNIDADES_INCOMPATIBLES"
  | "DUPLICADO";

export interface CoberturaPorSku extends FilaCobertura {
  estado: EstadoCoberturaFila;
  // Dias de cobertura -- null salvo estado === "CALCULADA" (nunca 0
  // disfrazando otro estado).
  coberturaDias: number | null;
}

export interface ResultadoCobertura {
  // SIEMPRE por SKU + ubicacion + fecha de corte. No existe campo de
  // agregado en este resultado -- ver el comentario de cabecera.
  porSku: CoberturaPorSku[];
  advertencias: string[];
  ruleVersion: string;
}

function unidadesCompatibles(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().toLowerCase();
  const na = norm(a);
  const nb = norm(b);
  return na.length > 0 && na === nb;
}

function evaluarFila(fila: FilaCobertura): CoberturaPorSku {
  if (fila.inventarioDisponible == null || fila.consumoDiarioEsperado == null) {
    return { ...fila, estado: "DATOS_INCOMPLETOS", coberturaDias: null };
  }
  if (fila.inventarioDisponible < 0 || fila.consumoDiarioEsperado < 0) {
    return { ...fila, estado: "VALOR_NEGATIVO", coberturaDias: null };
  }
  if (!unidadesCompatibles(fila.unidadInventario, fila.unidadConsumoDiario)) {
    return { ...fila, estado: "UNIDADES_INCOMPATIBLES", coberturaDias: null };
  }
  if (fila.consumoDiarioEsperado === 0) {
    return { ...fila, estado: "SIN_CONSUMO_REFERENCIA", coberturaDias: null };
  }
  return {
    ...fila,
    estado: "CALCULADA",
    coberturaDias: fila.inventarioDisponible / fila.consumoDiarioEsperado,
  };
}

function claveFila(fila: FilaCobertura, zonaHoraria: string): string {
  return `${fila.sku}|${fila.ubicacion}|${diaEnZona(fila.fecha, zonaHoraria)}`;
}

function mismaFila(a: FilaCobertura, b: FilaCobertura): boolean {
  return (
    a.inventarioDisponible === b.inventarioDisponible &&
    a.consumoDiarioEsperado === b.consumoDiarioEsperado &&
    a.unidadInventario.trim().toLowerCase() === b.unidadInventario.trim().toLowerCase() &&
    a.unidadConsumoDiario.trim().toLowerCase() === b.unidadConsumoDiario.trim().toLowerCase()
  );
}

/**
 * @param zonaHoraria Zona horaria IANA (ej. "America/Lima") usada para
 * calcular el dia calendario de `fecha` en cada fila -- regla 8. El
 * caller la resuelve; esta funcion no asume ningun valor por defecto.
 */
export function calcularCobertura(filas: readonly FilaCobertura[], zonaHoraria: string): ResultadoCobertura {
  const porClave = new Map<string, FilaCobertura[]>();
  for (const fila of filas) {
    const clave = claveFila(fila, zonaHoraria);
    const grupo = porClave.get(clave);
    if (grupo) grupo.push(fila);
    else porClave.set(clave, [fila]);
  }

  const filasAEvaluar: FilaCobertura[] = [];
  const filasDuplicadas: FilaCobertura[] = [];
  let duplicadosColapsados = 0;
  let duplicadosConflicto = 0;

  for (const grupo of porClave.values()) {
    const primero = grupo[0];
    if (!primero) continue;
    if (grupo.length === 1) {
      filasAEvaluar.push(primero);
      continue;
    }
    if (grupo.every((f) => mismaFila(f, primero))) {
      duplicadosColapsados += grupo.length - 1;
      filasAEvaluar.push(primero);
    } else {
      duplicadosConflicto += grupo.length;
      filasDuplicadas.push(...grupo);
    }
  }

  const porSku: CoberturaPorSku[] = [
    ...filasAEvaluar.map(evaluarFila),
    ...filasDuplicadas.map((fila) => ({ ...fila, estado: "DUPLICADO" as const, coberturaDias: null })),
  ];

  const contar = (estado: EstadoCoberturaFila) => porSku.filter((f) => f.estado === estado).length;
  const sinConsumo = contar("SIN_CONSUMO_REFERENCIA");
  const datosIncompletos = contar("DATOS_INCOMPLETOS");
  const valoresNegativos = contar("VALOR_NEGATIVO");
  const unidadesIncompatibles = contar("UNIDADES_INCOMPATIBLES");

  const advertencias: string[] = [];
  if (sinConsumo > 0) {
    advertencias.push(
      `${sinConsumo} SKU/ubicacion sin consumo diario esperado ("Sin consumo de referencia" -- no se calcula cobertura para esas filas).`,
    );
  }
  if (datosIncompletos > 0) {
    advertencias.push(`${datosIncompletos} fila(s) con datos incompletos (inventario o consumo faltante).`);
  }
  if (valoresNegativos > 0) {
    advertencias.push(
      `${valoresNegativos} fila(s) con valor negativo (inventario o consumo) -- señaladas para revision, no convertidas silenciosamente.`,
    );
  }
  if (unidadesIncompatibles > 0) {
    advertencias.push(
      `${unidadesIncompatibles} fila(s) con unidades incompatibles entre inventario y consumo diario -- no se calculo cobertura.`,
    );
  }
  if (duplicadosColapsados > 0) {
    advertencias.push(
      `${duplicadosColapsados} observacion(es) duplicada(s) con el mismo valor (mismo SKU/ubicacion/fecha de corte) -- colapsadas a una sola.`,
    );
  }
  if (duplicadosConflicto > 0) {
    advertencias.push(
      `${duplicadosConflicto} observacion(es) en conflicto (mismo SKU/ubicacion/fecha de corte, valores distintos) -- señaladas para resolver a mano, excluidas del calculo.`,
    );
  }
  if (porSku.length === 0) {
    advertencias.push("Sin datos suficientes para calcular cobertura en el periodo evaluado.");
  }

  return { porSku, advertencias, ruleVersion: RULE_VERSION_KPIS };
}

// Tipo re-exportado unicamente para que un llamador que quiera tratar
// Cobertura de forma generica (ej. un futuro despachador de Bloque B)
// pueda referenciar el contrato comun sin importar directamente de
// constantes.ts -- Cobertura NO devuelve ResultadoCalculoKpi (a diferencia
// de los otros 9 KPIs: no tiene un unico "valor", sino un detalle por SKU),
// ver el comentario de cabecera.
export type { ResultadoCalculoKpiGenerico };
