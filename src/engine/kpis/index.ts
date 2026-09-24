// Motor de KPIs -- punto de entrada publico (Incremento 4 Bloque A).
// Reexporta las 10 funciones puras de calculo del catalogo inicial
// (MVP-DEFINITIVO Seccion 6.3/Especificacion V2 Seccion 11.1). Sin
// Prisma, sin Next -- infra/ es lo unico que deberia importar desde aqui
// fuera de los propios tests, mismo criterio que engine/index.ts y
// engine/v2/index.ts.
export { RULE_VERSION_KPIS } from "./constantes";
export type { ResultadoCalculoKpi } from "./constantes";

export { calcularOtif } from "./otif";
export type { FilaOtif } from "./otif";

export { calcularFillRate } from "./fillRate";
export type { FilaFillRate } from "./fillRate";

export { calcularStockout } from "./stockout";
export type { FilaStockout } from "./stockout";

export { calcularCobertura } from "./cobertura";
export type { FilaCobertura } from "./cobertura";

export { calcularLeadTime } from "./leadTime";
export type { FilaLeadTime } from "./leadTime";

export { calcularVariabilidadLeadTime } from "./variabilidadLeadTime";

export { calcularOtifProveedor } from "./otifProveedor";
export type { FilaOtifProveedor } from "./otifProveedor";

export { calcularTiempoDeteccion } from "./tiempoDeteccion";
export { calcularTiempoDecision } from "./tiempoDecision";
export { calcularTiempoRecuperacion } from "./tiempoRecuperacion";
export type { FilaTiempoEntreEventos } from "./tiempoEntreEventos";

// Catalogo cerrado codigo -> KPI, mismo codigo que DefinicionKpi.codigo
// (prisma/seedDefinicionesKpi.ts) -- unica fuente de verdad que Bloque B
// usara para elegir que funcion de calculo correr segun el KPI declarado.
// Los tipos de fila difieren por KPI (Prisma/CSV/UI de Bloque B son
// responsables de pasarle a cada funcion el tipo de fila que le
// corresponde -- no hay forma de tipar un despachador generico de punta a
// punta sin perder el tipado especifico de cada funcion).
export const CODIGOS_KPI = [
  "OTIF",
  "FILL_RATE",
  "STOCKOUT",
  "COBERTURA",
  "LEAD_TIME",
  "VARIABILIDAD_LEAD_TIME",
  "OTIF_PROVEEDOR",
  "TIEMPO_DETECCION",
  "TIEMPO_DECISION",
  "TIEMPO_RECUPERACION",
] as const;
export type CodigoKpi = (typeof CODIGOS_KPI)[number];
