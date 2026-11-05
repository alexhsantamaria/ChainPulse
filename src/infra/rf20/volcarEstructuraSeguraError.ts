// Infraestructura — volcado SEGURO (allowlist explicito, nunca un
// recorrido generico ni un denylist) de la estructura de un error de
// Prisma/@prisma/adapter-pg, para uso EXCLUSIVO en el script de
// calibracion manual de scripts/rf20/calibrarExtractor23505RamaTemporal.ts
// (RF20 §7.10).
//
// Por que un allowlist y no un recorrido generico: un volcado generico
// (p.ej. JSON.stringify(error), o un recorrido recursivo que excluye
// solo los campos ya conocidos como sensibles) puede exponer, sin que
// nadie lo haya pedido, el mensaje crudo de Postgres
// (err.message/err.detail/err.hint pueden contener los VALORES
// insertados -- en esta calibracion, el codigo/numero sintetico, pero
// en general cualquier dato de fila), la consulta SQL completa, o
// cualquier campo que una version futura de la libreria decida
// agregar. Este modulo hace lo opuesto: declara, campo por campo,
// EXACTAMENTE lo que esta forma de error puede legitimamente contener
// de forma segura -- nombre de clase (constructor.name), .name, el
// NOMBRE de cada clave propia (nunca su valor), .code, y los campos ya
// confirmados empiricamente dentro de meta.driverAdapterError.cause --
// y nada mas se propaga. Nunca se lee ni se expone, en ningun nivel:
// .message, .stack, .originalMessage, .detail, .hint, ni ningun otro
// campo no listado explicitamente aqui.
//
// Fuente empirica de la forma de meta.driverAdapterError.cause: lectura
// directa del codigo fuente instalado de @prisma/client@6.19.3 y
// @prisma/adapter-pg@6.19.3, corroborada por una reproduccion local
// real (clases reales de @prisma/adapter-pg contra un pg.Pool
// sintetico, sin Neon, sin red) ejecutada como parte de esta
// correccion. Nota de compatibilidad: meta.driverAdapterError NO es una
// API publica documentada de Prisma (issue real: prisma/orm#29496) --
// por eso cada nivel de este modulo lee sus campos de forma defensiva,
// sin asumir nunca que estaran presentes.
//
// Deliberadamente SIN dependencias (ni Prisma, ni ningun otro modulo
// de infra, solo JavaScript puro) -- mismo motivo que
// src/infra/auth/etiquetaErrorSegura.ts: este modulo debe poder usarse
// desde cualquier contexto sin arrastrar, ni siquiera transitivamente,
// la construccion de PrismaClient.

function textoONull(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

function arregloDeStringsONull(valor: unknown): string[] | null {
  if (!Array.isArray(valor) || !valor.every((elemento) => typeof elemento === "string")) {
    return null;
  }
  return [...valor];
}

export type VolcadoSeguroConstraint = {
  fields: string[] | null;
  index: string | null;
  name: string | null;
};

function volcarConstraint(valor: unknown): VolcadoSeguroConstraint | null {
  if (!valor || typeof valor !== "object") return null;
  const c = valor as { fields?: unknown; index?: unknown; name?: unknown };
  return {
    fields: arregloDeStringsONull(c.fields),
    index: textoONull(c.index),
    name: textoONull(c.name),
  };
}

export type VolcadoSeguroCausa = {
  kind: string | null;
  originalCode: string | null;
  code: string | null;
  constraint: VolcadoSeguroConstraint | null;
};

function volcarCausa(valor: unknown): VolcadoSeguroCausa | null {
  if (!valor || typeof valor !== "object") return null;
  const c = valor as { kind?: unknown; originalCode?: unknown; code?: unknown; constraint?: unknown };
  return {
    kind: textoONull(c.kind),
    originalCode: textoONull(c.originalCode),
    code: textoONull(c.code),
    constraint: volcarConstraint(c.constraint),
  };
}

export type VolcadoSeguroDriverAdapterError = {
  tipo: string | null;
  name: string | null;
  causa: VolcadoSeguroCausa | null;
};

function volcarDriverAdapterError(valor: unknown): VolcadoSeguroDriverAdapterError | null {
  if (!valor || typeof valor !== "object") return null;
  const d = valor as { constructor?: { name?: unknown }; name?: unknown; cause?: unknown };
  return {
    tipo: textoONull(d.constructor?.name),
    name: textoONull(d.name),
    causa: volcarCausa(d.cause),
  };
}

export type VolcadoSeguroMeta = {
  clavesPropias: string[];
  driverAdapterError: VolcadoSeguroDriverAdapterError | null;
};

function volcarMeta(valor: unknown): VolcadoSeguroMeta | null {
  if (!valor || typeof valor !== "object") return null;
  const m = valor as { driverAdapterError?: unknown };
  return {
    clavesPropias: Object.keys(m),
    driverAdapterError: volcarDriverAdapterError(m.driverAdapterError),
  };
}

export type VolcadoSeguroError = {
  tipo: string | null;
  name: string | null;
  clavesPropias: string[];
  code: string | null;
  meta: VolcadoSeguroMeta | null;
};

const VOLCADO_VACIO: VolcadoSeguroError = {
  tipo: null,
  name: null,
  clavesPropias: [],
  code: null,
  meta: null,
};

/**
 * Unico punto permitido para inspeccionar un error de Prisma en el
 * script de calibracion (RF20 §7.10). Nunca lanza -- un fallo al leer
 * alguna propiedad (p.ej. un getter que lanza) no debe tapar el
 * resultado real, ya impreso, de la calibracion -- y nunca incluye
 * message/stack/detail/hint/originalMessage en ningun nivel, aunque el
 * error de entrada los tenga.
 */
export function volcarEstructuraSeguraError(error: unknown): VolcadoSeguroError {
  try {
    if (!error || typeof error !== "object") return VOLCADO_VACIO;
    const e = error as { constructor?: { name?: unknown }; name?: unknown; code?: unknown; meta?: unknown };
    return {
      tipo: textoONull(e.constructor?.name),
      name: textoONull(e.name),
      clavesPropias: Object.keys(e),
      code: textoONull(e.code),
      meta: volcarMeta(e.meta),
    };
  } catch {
    return VOLCADO_VACIO;
  }
}
