// Sanitizacion de inyeccion de formulas CSV (Incremento 4, Bloque B --
// preparacion, hecho antes de que exista el resto del flujo de
// ingesta/R2 porque no depende de ellos). Riesgo real, no cosmetico: un
// CSV con `=cmd|'/c calc'!A1` (o variantes con +, -, @, tab, retorno de
// carro) abierto luego en Excel/Sheets se interpreta como formula y puede
// ejecutar codigo o filtrar datos -- vector conocido de "CSV/Formula
// Injection" (OWASP: https://community.owasp.org/attacks/CSV_Injection).
//
// CORRECCION 2026-09-24 (revision de Alex): la version anterior de este
// modulo mutaba el valor de una celda de texto (prefijo con apostrofo)
// ANTES de que ese valor se usara como identidad de negocio (SKU,
// ubicacion, pedido, proceso, incidente, alias de proveedor -- en este
// proyecto, todo campo de texto de una fila de KPI es a la vez una clave
// natural de deduplicacion, ver engine/kpis/*.ts). Neutralizar en el
// punto de ingesta habria roto esa identidad: dos cargas del mismo SKU
// "-001" habrian quedado indistinguibles de cualquier otro SKU si el
// prefijo se aplicara de forma inconsistente, y cualquier busqueda o
// comparacion contra el valor original (catalogo de productos, una
// re-importacion, un reporte) habria dejado de coincidir.
//
// Principio correcto: el riesgo de inyeccion de formulas existe SOLO en
// el momento en que un valor se escribe en un archivo que alguien va a
// abrir con una hoja de calculo -- nunca en el valor que la plataforma
// guarda y usa internamente como identidad. Por eso este modulo separa
// dos responsabilidades que antes estaban mezcladas:
//
//   1. Deteccion/validacion (esFormulaPeligrosa) -- PURA lectura, no muta
//      nada. Sirve para la UI de previsualizacion de Bloque B ("este
//      valor empieza con un caracter que se interpretaria como formula si
//      se exportara a Excel -- confirmalo") y para decidir si una
//      exportacion necesita neutralizacion, pero el valor guardado como
//      identidad de negocio SIEMPRE es el original, sin tocar.
//
//   2. Neutralizacion de exportacion (neutralizarCeldaParaHojaDeCalculo /
//      neutralizarFilaParaExportacion) -- se aplica UNICAMENTE al
//      construir un archivo de salida (CSV/XLSX) para que alguien lo abra
//      en una hoja de calculo, sobre una copia de los datos de
//      exportacion, nunca sobre la entidad persistida ni sobre el valor
//      usado para deduplicar/relacionar filas. Bloque B, cuando exista,
//      debe llamar a esta funcion solo en el modulo de exportacion/reporte,
//      nunca en el pipeline de ingesta.
//
// Estructura del CSV (delimitadores, comillas, saltos de linea dentro de
// una celda) es una preocupacion DISTINTA a la inyeccion de formulas, y
// no es responsabilidad de este modulo: un escritor RFC4180 correcto
// (PapaParse.unparse -- agregado como dependencia para esto, todavia sin
// integrar a ningun flujo real) ya escapa/cita automaticamente cualquier
// campo que contenga el delimitador, una comilla o un salto de linea --
// ver sanitizacionCsv.test.ts para una prueba de ida y vuelta contra
// PapaParse real, no solo contra la funcion aislada.
//
// Caracteres marcados como inicio peligroso: `=`, `+`, `-`, `@` (marcados
// por Alex, PLAN-DE-TRABAJO.md, Incremento 4 Bloque B) mas tab (`\t`) y
// retorno de carro (`\r`), que OWASP tambien documenta como capaces de
// disparar una formula en algunos lectores.

const CARACTERES_PELIGROSOS_INICIO = ["=", "+", "-", "@"] as const;
// Tab y retorno de carro se comprueban aparte, sobre el primer caracter
// CRUDO (sin trimStart): trimStart() los considera espacio en blanco y
// los eliminaria antes de poder verlos, asi que revisarlos DESPUES de
// trimear seria inutil -- justo los dos caracteres que OWASP marca como
// peligrosos por si mismos al inicio de una celda.
const CARACTERES_CONTROL_PELIGROSOS = ["\t", "\r"] as const;

/**
 * true si el valor empieza (en crudo, o ignorando espacios en blanco
 * comunes) con un caracter que Excel/Sheets podria interpretar como el
 * inicio de una formula. Deteccion PURA -- nunca modifica el valor ni
 * decide por si sola si hay que neutralizarlo (eso depende de si el valor
 * va a persistirse como identidad -- nunca se toca -- o a exportarse a
 * una hoja de calculo -- ver neutralizarCeldaParaHojaDeCalculo).
 */
export function esFormulaPeligrosa(valorCelda: string): boolean {
  if (valorCelda.length === 0) return false;
  if ((CARACTERES_CONTROL_PELIGROSOS as readonly string[]).includes(valorCelda.charAt(0))) {
    return true;
  }
  const primerCaracterTrasEspacios = valorCelda.trimStart().charAt(0);
  return (CARACTERES_PELIGROSOS_INICIO as readonly string[]).includes(primerCaracterTrasEspacios);
}

/**
 * Neutraliza una celda de texto potencialmente peligrosa prefijandola con
 * un apostrofo, para usar SOLO al construir un archivo (CSV/XLSX) que
 * alguien va a abrir en una hoja de calculo -- NUNCA sobre un valor que
 * se vaya a guardar como identidad de negocio o a compararse/deduplicarse
 * contra otro valor (ver el comentario de cabecera de este archivo).
 * Pura -- no muta el valor de entrada. Idempotente: aplicar dos veces no
 * duplica el prefijo.
 */
export function neutralizarCeldaParaHojaDeCalculo(valorCelda: string): string {
  if (valorCelda.startsWith("'")) return valorCelda; // ya neutralizada
  return esFormulaPeligrosa(valorCelda) ? `'${valorCelda}` : valorCelda;
}

/**
 * Aplica neutralizarCeldaParaHojaDeCalculo a un subconjunto de campos de
 * una fila que se va a ESCRIBIR EN UN ARCHIVO de salida (CSV/XLSX) --
 * tipicamente una fila ya formateada para exportacion/reporte, nunca la
 * entidad persistida ni una fila que todavia vaya a usarse para
 * deduplicar/relacionar contra otras filas (esa comparacion debe hacerse
 * siempre contra el valor original, sin neutralizar). Los campos no
 * listados en `campos`, o cuyo valor no sea string, se devuelven sin
 * tocar.
 */
export function neutralizarFilaParaExportacion<T extends Record<string, unknown>>(
  fila: T,
  campos: readonly (keyof T)[],
): T {
  const resultado = { ...fila };
  for (const campo of campos) {
    const valor = resultado[campo];
    if (typeof valor === "string") {
      resultado[campo] = neutralizarCeldaParaHojaDeCalculo(valor) as T[keyof T];
    }
  }
  return resultado;
}
