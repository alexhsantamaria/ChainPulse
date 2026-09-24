// Sanitizacion de inyeccion de formulas CSV (Incremento 4, Bloque B --
// preparacion, hecho antes de que exista el resto del flujo de
// ingesta/R2 porque no depende de ellos). Riesgo real, no cosmetico: un
// CSV con `=cmd|'/c calc'!A1` (o variantes con +, -, @) abierto luego en
// Excel/Sheets se interpreta como formula y puede ejecutar codigo o
// filtrar datos -- vector conocido de "CSV/Formula Injection" (OWASP).
//
// Aplica SOLO a campos de texto libre que la plataforma podria volver a
// exportar o mostrar en un contexto tipo hoja de calculo (SKU, ubicacion,
// pedido, proceso, incidente, alias de proveedor, etc.) -- NUNCA a campos
// que se parsean como numero/fecha, donde un "-" inicial es un signo
// legitimo (ej. FilaStockout.stockDisponible puede ser negativo, ver
// engine/kpis/stockout.ts): ese parseo numerico es una etapa distinta,
// sobre el valor ya convertido a number un signo no es una celda de
// texto que un lector de hoja de calculo vaya a interpretar como
// formula. El llamador (el mapeador de columnas de Bloque B, todavia sin
// construir) es quien decide que campos de una fila son "texto" para
// pasarlos por sanitizarFilaCsv -- este modulo no conoce el esquema de
// ningun KPI.
//
// Caracteres marcados por Alex (2026-09-24, PLAN-DE-TRABAJO.md, Incremento
// 4 Bloque B): `=`, `+`, `-`, `@` al inicio de celda. OWASP tambien marca
// tab (\t) y retorno de carro (\r) como caracteres iniciales peligrosos en
// algunos lectores -- no se incluyen aca porque no formaban parte de la
// especificacion; se puede extender esta lista si hace falta.
//
// Estrategia: prefijar con un apostrofo (') en vez de eliminar el
// caracter -- Excel/Sheets tratan la celda como texto literal (el
// apostrofo no se muestra al usuario), y el dato original queda integro y
// recuperable, a diferencia de borrar el caracter, que corromperia
// silenciosamente el valor si alguna vez llegara aca un campo mal
// mapeado.

const CARACTERES_PELIGROSOS = ["=", "+", "-", "@"] as const;

/**
 * true si el valor, ignorando espacios en blanco iniciales, empieza con
 * un caracter que Excel/Sheets podria interpretar como el inicio de una
 * formula.
 */
export function esFormulaPeligrosa(valorCelda: string): boolean {
  const primerCaracter = valorCelda.trimStart().charAt(0);
  return (CARACTERES_PELIGROSOS as readonly string[]).includes(primerCaracter);
}

/**
 * Neutraliza una celda de texto potencialmente peligrosa prefijandola con
 * un apostrofo. Pura -- no muta el valor de entrada. Idempotente: aplicar
 * dos veces no duplica el prefijo.
 */
export function sanitizarCeldaTexto(valorCelda: string): string {
  if (valorCelda.startsWith("'")) return valorCelda; // ya sanitizada
  return esFormulaPeligrosa(valorCelda) ? `'${valorCelda}` : valorCelda;
}

/**
 * Aplica sanitizarCeldaTexto a un subconjunto de campos de texto libre de
 * una fila ya parseada (ej. una fila de PapaParse mapeada a sus columnas
 * de destino). Los campos no listados en `camposTexto` (tipicamente
 * numericos/fecha, o cualquier valor que no sea string) se devuelven sin
 * tocar -- su sanitizacion, si hace falta, es responsabilidad de su
 * propio parseo, no de este modulo.
 */
export function sanitizarFilaCsv<T extends Record<string, unknown>>(
  fila: T,
  camposTexto: readonly (keyof T)[],
): T {
  const resultado = { ...fila };
  for (const campo of camposTexto) {
    const valor = resultado[campo];
    if (typeof valor === "string") {
      resultado[campo] = sanitizarCeldaTexto(valor) as T[keyof T];
    }
  }
  return resultado;
}
