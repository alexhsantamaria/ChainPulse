// Dominio (PURO) -- normalizacion CENTRALIZADA del alias de proveedor,
// Incremento 5 PR3 (Alex, 2026-11-18, correccion obligatoria sobre el
// diseno original). Un unico lugar decide que dos alias "son el mismo
// proveedor" -- declarar.ts (previsualizar), persistir.ts (confirmar) y
// el motor de ranking (via proveedorAliasClave ya persistido) nunca
// reimplementan esta regla por su cuenta.
//
// `visible`: lo que se muestra/persiste como proveedorAlias -- recortado
// y con espacios internos colapsados, pero SIN tocar mayusculas/minusculas
// (nunca el nombre real del proveedor, mismo criterio de anonimizacion
// RF39 que FilaOtifProveedor -- este modulo no decide eso, solo normaliza
// el TEXTO que la persona ya escribio como alias).
//
// `clave`: version CANONICA para IDENTIDAD (proveedorAliasClave) --
// adicionalmente pasada por String.prototype.toLowerCase() SIN LOCALE
// (nunca toLocaleLowerCase()): toLowerCase() sin argumentos esta definida
// por ECMA-262 con una tabla de mapeo fija, igual en cualquier motor/host,
// a diferencia de toLocaleLowerCase() -- que en locale "tr" (turco)
// mapea "I" a "ı" (dotless i) en vez de "i", lo que haria que dos alias
// iguales en todo host "normal" dejaran de coincidir silenciosamente en
// un host configurado en turco. Case folding ESTABLE significa
// precisamente evitar esa dependencia del locale del proceso.
//
// Orden deliberado: trim -> colapsar espacios internos -> (clave) minusculas.
// "  Proveedor   A  " y "proveedor a" y "PROVEEDOR A" producen la MISMA
// `clave` ("proveedor a"), pero cada uno conserva su propio `visible"
// (con su propio casing, solo con espacios colapsados) -- la identidad
// vive en `clave`, nunca en `visible`.
export interface AliasProveedorNormalizado {
  readonly visible: string;
  readonly clave: string;
}

const ESPACIOS_INTERNOS = /\s+/g;

/**
 * Devuelve `null` cuando el alias queda VACIO despues de normalizar (solo
 * espacios, o cadena vacia) -- nunca se acepta un alias vacio, ni antes
 * ni despues de recortar (Alex, 2026-11-18, punto 5). El llamador trata
 * `null` como DATOS_INVALIDOS, igual que cualquier otro campo con forma
 * incorrecta en este proyecto (mismo criterio que construirFilaOtif()).
 */
export function normalizarAliasProveedor(valorCrudo: string): AliasProveedorNormalizado | null {
  const colapsado = valorCrudo.trim().replace(ESPACIOS_INTERNOS, " ");
  if (colapsado.length === 0) return null;
  return { visible: colapsado, clave: colapsado.toLowerCase() };
}

/**
 * Compara dos CLAVES ya normalizadas con el orden de puntos de codigo
 * UTF-16 (`<`/`>` de JS sobre strings) -- NUNCA `localeCompare()`, que
 * puede variar de resultado segun el locale/ICU del host (el mismo
 * problema de no-determinismo que motiva evitar toLocaleLowerCase()
 * arriba). Usada por el motor de ranking para el desempate determinista
 * (src/engine/queries/otifProveedorRetrasos.ts) -- nunca depende de el
 * `ORDER BY` de Postgres como unica garantia.
 */
export function compararClavesProveedor(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
