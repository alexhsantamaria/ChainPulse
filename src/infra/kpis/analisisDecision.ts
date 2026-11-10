// Infraestructura (PURA -- sin Prisma) -- analisis y decision de KPI
// (Incremento 4 PR2, Alex 2026-11-09; RONDA 2 de correcciones
// 2026-11-09): evolucion reciente, comparacion contra el periodo
// anterior, cambios observados (nunca inventados) y una recomendacion
// priorizada, para OTIF, Fill Rate y Cobertura.
//
// Patron YA validado en este mismo repositorio, no inventado para este
// PR (ver auditoria-incremento4-kpis-2026-11-06.md, "Hallazgo
// favorable"):
//   - src/engine/recomendacion.ts (generarRecomendacion(), RF8): reglas
//     deterministicas sobre valores YA calculados, prioridad por
//     severidad -- el mismo esqueleto se usa aca (clasificar ->
//     priorizar -> interpolar texto fijo), adaptado al dominio de KPIs
//     en vez de copiado literal (GradoDependencia/salud no existen en
//     este dominio).
//   - src/engine/queries/plantillasExplicacion.ts (Incremento 5):
//     "Las explicaciones se generan mediante plantillas deterministicas
//     e interpolacion de resultados calculados... Nunca inventar
//     causas." Mismo principio aplicado aca: todo "cambio observado" es
//     una resta/comparacion de datos YA persistidos (numerador,
//     denominador, conteos por categoria) -- nunca una razon de negocio
//     inferida (ej. "por un problema del proveedor") que esta tabla no
//     registra. No se importa ese archivo directamente -- vive en
//     src/engine/queries/, dominio propio del motor de consultas de
//     Incremento 5, sin declararse infraestructura comun (a diferencia
//     de src/infra/prisma/errores.ts, ya reutilizado desde 3+ dominios
//     distintos) -- mismo criterio de limite de dominio ya aplicado al
//     no reutilizar src/infra/rf20/volcarEstructuraSeguraError.ts en
//     PR1. Las 2 funciones de formato que hubiera reutilizado
//     (formatearPorcentaje, formatearVariacionPuntos) son una resta y un
//     toFixed cada una -- replicarlas aca no duplica logica compleja.
//
// Deliberadamente sin import de Prisma/tenantClient -- mismo motivo que
// src/infra/kpis/estadoVisualizacion.ts: funciones puras, probadas sin
// ninguna base de datos. Los tipos que consume se declaran localmente
// como interfaces minimas (no el tipo completo del modelo Prisma) -- el
// llamador (una pagina) decide que columnas pedir, incluida ruleVersion
// (ver RONDA 2, punto 4 mas abajo).
//
// NOTA (RONDA 2, Alex 2026-11-09): "Tendencia" se renombro a "Evolucion
// reciente" y "Causas observables" a "Cambios observados" SOLO en el
// texto de interfaz (las paginas que consumen este modulo) -- no se
// implemento ningun metodo real de deteccion de tendencia (pendiente,
// regresion/pendiente estadistica). Los nombres de campos de este
// archivo (tendencia, causasObservables) se conservan para no inflar el
// diff con un renombrado puramente cosmetico de identificadores
// internos que esta ronda no pidio.
//
// RONDA 3 (Alex, 2026-11-09): (1) se agrega variacionTasaSinDatos a
// Cobertura -- la tasa de filas sin datos se compara igual que validas y
// errores (antes se evaluaba por conteo crudo, lo que podia mostrar un
// "cambio" aunque la tasa fuera identica); (2) se agrega
// motivoInformacionInsuficiente (ver MotivoInformacionInsuficiente mas
// abajo) para distinguir "nunca hubo historico" de "hubo pero era de
// otra ruleVersion" de "la actual mezcla versiones" (Cobertura) de "el
// total de filas es cero".
//
// RONDA 4 (Alex, 2026-11-10), 2 correcciones sobre la Ronda 3:
//   (1) Cobertura ya no sobrecarga `ruleVersion: string | null` para
//       significar 2 situaciones distintas ("0 filas" y "2+ ruleVersion
//       mezcladas") -- ver EstadoVersionCobertura mas abajo. Esa
//       sobrecarga escondia un bug real: una importacion ACTUAL sin
//       filas se mostraba como VERSION_MEZCLADA en vez de TOTAL_CERO.
//   (2) La COMPARACION (periodoAnterior, en ambos dominios) ahora usa
//       ESTRICTAMENTE el periodo/importacion inmediatamente anterior
//       cronologico -- hasta la Ronda 3, si el inmediato anterior era
//       incompatible (otra ruleVersion), el codigo lo saltaba y
//       comparaba contra uno MAS ANTIGUO que si calzara. Eso es
//       incorrecto: 2 periodos que no son cronologicamente adyacentes
//       pueden tener cualquier cantidad de cambios sin relacion entre
//       medio, y presentar esa comparacion como "el cambio desde el
//       periodo anterior" induce a error. Ahora, si el inmediato
//       anterior no es comparable (por cualquier motivo), la
//       comparacion es informacion insuficiente -- nunca se busca uno
//       mas antiguo. La evolucion reciente (`tendencia`, la lista de
//       varios puntos) SI sigue excluyendo los incompatibles -- eso es
//       una lista para graficar tendencia, no "la comparacion contra el
//       periodo anterior", y no es lo que esta ronda pidio cambiar.
import type { ResumenFilasCobertura } from "./estadoVisualizacion";

export type DireccionVariacion = "MEJORA" | "EMPEORA" | "ESTABLE";

export interface VariacionValor {
  deltaAbsoluto: number;
  // null si el valor anterior es 0 -- una division por cero nunca se
  // disfraza de "0% de cambio" ni de ningun otro numero.
  deltaPorcentual: number | null;
  direccion: DireccionVariacion;
}

// RONDA 3 (Alex, 2026-11-09, punto 2): distingue POR QUE una comparacion
// (y, cuando aplica, la evolucion reciente) es informacion insuficiente
// -- "no hay un periodo anterior" y "el periodo anterior existe pero es
// de otra ruleVersion" son 2 situaciones MUY distintas para quien lee la
// pantalla (la 2da sugiere revisar la calibracion/version del motor, la
// 1ra es simplemente "todavia no hay suficiente historia"), y antes se
// mostraban con el mismo mensaje generico.
//   - SIN_HISTORICO: no hay NINGUN periodo/importacion anterior, de
//     ninguna version (historicoPrevio vacio).
//   - RULE_VERSION_INCOMPATIBLE: SI hay historico, pero ninguno tiene la
//     MISMA ruleVersion que el actual -- existe, pero no es comparable.
//   - VERSION_MEZCLADA (solo Cobertura): la importacion ACTUAL mezcla 2+
//     ruleVersion dentro de si misma (ver PuntoResumenCobertura.
//     ruleVersion) -- no hay ninguna version propia con la que buscar un
//     comparable, sin importar que exista historico.
//   - TOTAL_CERO (solo Cobertura): hay un periodo anterior de la MISMA
//     version, pero el total de filas (actual o anterior) es 0 -- no hay
//     tasa que calcular sobre 0 filas.
//   - SIN_DATOS_PERIODO_ANTERIOR (solo OTIF/Fill Rate): el periodo
//     anterior es comparable (misma version) pero su `valor` es null
//     (observacion SIN_DATOS) -- nada que restar.
//   - null: la comparacion SI fue posible.
export type MotivoInformacionInsuficiente =
  | "SIN_HISTORICO"
  | "RULE_VERSION_INCOMPATIBLE"
  | "VERSION_MEZCLADA"
  | "TOTAL_CERO"
  | "SIN_DATOS_PERIODO_ANTERIOR"
  | null;

// Umbral de "variacion estable" -- hipotesis de calibracion inicial,
// mismo criterio que SALUD_CRITICA_UMBRAL en src/engine/recomendacion.ts
// (constante documentada, ajustable con datos reales de los pilotos).
const EPSILON_ESTABLE = 0.005;

export function compararValorConAnterior(actual: number, anterior: number, masAltoEsMejor: boolean): VariacionValor {
  const deltaAbsoluto = actual - anterior;
  const deltaPorcentual = anterior === 0 ? null : deltaAbsoluto / Math.abs(anterior);

  let direccion: DireccionVariacion;
  if (Math.abs(deltaAbsoluto) <= EPSILON_ESTABLE) {
    direccion = "ESTABLE";
  } else {
    const subio = deltaAbsoluto > 0;
    direccion = subio === masAltoEsMejor ? "MEJORA" : "EMPEORA";
  }

  return { deltaAbsoluto, deltaPorcentual, direccion };
}

export type PrioridadRecomendacion = "ALTA" | "MEDIA" | "BAJA";

export interface RecomendacionKpi {
  prioridad: PrioridadRecomendacion;
  texto: string;
}

// ============================================================
// OTIF / Fill Rate (ObservacionKpi)
// ============================================================

export interface PuntoObservacionKpi {
  id: string;
  periodoInicio: Date;
  periodoFin: Date;
  valor: number | null;
  numerador: number | null;
  denominador: number | null;
  // RONDA 2 (Alex 2026-11-09, punto 4): version de la regla de calculo
  // que produjo este punto (ResultadoCalculoKpi.ruleVersion). Nunca se
  // compara un punto contra otro de ruleVersion distinta -- 2 motores
  // de calculo distintos pueden no ser comparables entre si.
  ruleVersion: string;
}

export interface AnalisisObservacionKpi {
  // Orden cronologico ascendente, incluye el punto actual al final.
  // SOLO incluye puntos con la MISMA ruleVersion que el punto actual
  // (ver RONDA 2, punto 4) -- un punto historico de otra ruleVersion se
  // excluye por completo, nunca se mezcla en la evolucion ni en la
  // comparacion.
  tendencia: PuntoObservacionKpi[];
  tendenciaInformacionInsuficiente: boolean;
  periodoAnterior: PuntoObservacionKpi | null;
  variacion: VariacionValor | null;
  comparacionInformacionInsuficiente: boolean;
  // RONDA 3, punto 2: por que es insuficiente (null si SI fue posible) --
  // SIN_HISTORICO | RULE_VERSION_INCOMPATIBLE | SIN_DATOS_PERIODO_ANTERIOR
  // para este dominio (VERSION_MEZCLADA/TOTAL_CERO son exclusivos de
  // Cobertura, ver generarAnalisisImportacionCobertura()).
  motivoInformacionInsuficiente: MotivoInformacionInsuficiente;
  causasObservables: string[];
  causasInformacionInsuficiente: boolean;
  recomendacion: RecomendacionKpi | null;
  siguienteAccionPropuesta: string | null;
}

// Umbral de magnitud para distinguir ALTA de MEDIA cuando el KPI
// empeora -- hipotesis inicial, igual criterio de "ajustable con datos
// reales" que el resto de este archivo. 0.10 = 10 puntos porcentuales
// DE DELTA ABSOLUTO (RONDA 2, punto 3: antes comparaba el delta
// PORCENTUAL/relativo contra este mismo umbral, lo cual es incorrecto
// -- "10 puntos" es una magnitud absoluta en la escala 0..1 del KPI,
// no un porcentaje de cambio relativo).
const UMBRAL_VARIACION_ALTA_OBSERVACION_KPI = 0.10;

export function generarAnalisisObservacionKpi(
  actual: PuntoObservacionKpi,
  // Periodos anteriores al actual (mismo cadenaId+definicionKpiId),
  // orden cronologico ascendente, de CUALQUIER ruleVersion -- el
  // filtrado por ruleVersion comparable ocurre dentro de esta funcion
  // (RONDA 2, punto 4), el llamador no necesita filtrar.
  historicoPrevio: PuntoObservacionKpi[],
): AnalisisObservacionKpi {
  // RONDA 2, punto 4: "para OTIF/Fill Rate usa unicamente historicos
  // comparables con la observacion actual" -- se excluye todo punto de
  // ruleVersion distinta ANTES de construir la evolucion reciente o la
  // comparacion, para que nunca se calcule una variacion entre 2
  // motores de calculo distintos.
  const historicoComparable = historicoPrevio.filter((punto) => punto.ruleVersion === actual.ruleVersion);

  const tendencia = [...historicoComparable, actual];
  const puntosConValor = tendencia.filter((p) => p.valor !== null);
  const tendenciaInformacionInsuficiente = puntosConValor.length < 2;

  // RONDA 4, punto 4: la COMPARACION (periodoAnterior) usa
  // ESTRICTAMENTE el periodo inmediatamente anterior CRONOLOGICO -- el
  // ultimo elemento de `historicoPrevio` SIN filtrar por ruleVersion
  // (nunca el ultimo de `historicoComparable`, que puede saltarse uno
  // incompatible para encontrar otro mas antiguo que si calce -- ese
  // era el bug de la Ronda 3, ver el comentario de cabecera de este
  // archivo). .at(-1) ?? null, mismo motivo de siempre (noUncheckedIndexedAccess).
  const periodoInmediatoAnterior = historicoPrevio.at(-1) ?? null;
  const periodoAnterior =
    periodoInmediatoAnterior !== null && periodoInmediatoAnterior.ruleVersion === actual.ruleVersion
      ? periodoInmediatoAnterior
      : null;

  // RONDA 3, punto 2 (orden corregido en RONDA 4 para mirar el
  // INMEDIATO anterior, nunca uno mas antiguo): si no hay ningun
  // periodo anterior, es "nunca hubo historico"; si hay uno pero su
  // ruleVersion no coincide, es "incompatible" -- SIN IMPORTAR que
  // exista uno mas antiguo que si coincida, nunca se lo usa ni se
  // busca. Solo si el inmediato anterior SI es comparable se distingue
  // el caso de "existe pero sin valor declarado".
  let motivoInformacionInsuficiente: MotivoInformacionInsuficiente = null;
  if (periodoInmediatoAnterior === null) {
    motivoInformacionInsuficiente = "SIN_HISTORICO";
  } else if (periodoInmediatoAnterior.ruleVersion !== actual.ruleVersion) {
    motivoInformacionInsuficiente = "RULE_VERSION_INCOMPATIBLE";
  } else if (periodoAnterior !== null && periodoAnterior.valor === null) {
    motivoInformacionInsuficiente = "SIN_DATOS_PERIODO_ANTERIOR";
  }

  let variacion: VariacionValor | null = null;
  const causasObservables: string[] = [];
  let causasInformacionInsuficiente = true;

  if (periodoAnterior !== null && periodoAnterior.valor !== null && actual.valor !== null) {
    // masAltoEsMejor=true: convencion de OTIF/Fill Rate (ambos son
    // porcentajes de cumplimiento -- un valor mas alto es un mejor
    // resultado, ver DefinicionKpi.formula de ambos).
    variacion = compararValorConAnterior(actual.valor, periodoAnterior.valor, true);

    if (
      periodoAnterior.numerador !== null &&
      periodoAnterior.denominador !== null &&
      actual.numerador !== null &&
      actual.denominador !== null
    ) {
      causasInformacionInsuficiente = false;
      const deltaNumerador = actual.numerador - periodoAnterior.numerador;
      const deltaDenominador = actual.denominador - periodoAnterior.denominador;
      if (deltaNumerador !== 0) {
        causasObservables.push(
          `El numerador pasó de ${periodoAnterior.numerador} a ${actual.numerador} (${deltaNumerador > 0 ? "+" : ""}${deltaNumerador}).`,
        );
      }
      if (deltaDenominador !== 0) {
        causasObservables.push(
          `El denominador pasó de ${periodoAnterior.denominador} a ${actual.denominador} (${deltaDenominador > 0 ? "+" : ""}${deltaDenominador}).`,
        );
      }
      if (deltaNumerador === 0 && deltaDenominador === 0) {
        causasObservables.push("El numerador y el denominador no cambiaron respecto al período anterior.");
      }
    }
  }

  const recomendacion = variacion === null ? null : construirRecomendacionObservacionKpi(variacion);
  const siguienteAccionPropuesta =
    recomendacion && recomendacion.prioridad !== "BAJA"
      ? "Registrar una acción de seguimiento con responsable y fecha objetivo para este período."
      : null;

  return {
    tendencia,
    tendenciaInformacionInsuficiente,
    periodoAnterior,
    variacion,
    comparacionInformacionInsuficiente: variacion === null,
    motivoInformacionInsuficiente,
    causasObservables,
    causasInformacionInsuficiente,
    recomendacion,
    siguienteAccionPropuesta,
  };
}

function construirRecomendacionObservacionKpi(variacion: VariacionValor): RecomendacionKpi {
  if (variacion.direccion === "EMPEORA") {
    // RONDA 2, punto 3: magnitud ALTA se decide por el DELTA ABSOLUTO
    // (puntos porcentuales del propio KPI), nunca por el delta
    // PORCENTUAL/relativo -- un KPI que cae de 0.80 a 0.70 cae "10
    // puntos" sin importar que eso sea un 12.5% relativo o cualquier
    // otro numero; comparar el umbral contra el relativo mezclaba 2
    // escalas distintas.
    const magnitudAlta = Math.abs(variacion.deltaAbsoluto) >= UMBRAL_VARIACION_ALTA_OBSERVACION_KPI;
    return {
      prioridad: magnitudAlta ? "ALTA" : "MEDIA",
      texto:
        "El resultado empeoró respecto al período anterior -- revisar los casos del período con mayor impacto en el numerador o el denominador antes del próximo cierre.",
    };
  }
  if (variacion.direccion === "MEJORA") {
    return {
      prioridad: "BAJA",
      texto: "El resultado mejoró respecto al período anterior -- mantener las prácticas de este período.",
    };
  }
  return {
    prioridad: "BAJA",
    texto: "El resultado se mantuvo estable respecto al período anterior -- sin cambios que requieran atención inmediata.",
  };
}

// ============================================================
// Cobertura (ImportacionCsv + ObservacionCobertura, agregado por
// importacion -- NUNCA por SKU individual)
// ============================================================
//
// No existe (todavia) una metodologia de agregacion de Cobertura entre
// SKU (CONFIRMADO por Alex el 2026-09-24, ver el comentario de
// ObservacionCobertura en prisma/schema.prisma: "la agregacion de
// cobertura entre SKU queda fuera de esta implementacion hasta acordar
// su metodologia") -- por eso esta funcion NUNCA calcula un "promedio de
// dias de cobertura" entre SKUs: la evolucion reciente y la comparacion
// de Cobertura se miden sobre TASAS derivadas de los CONTEOS por
// categoria que ya produce resumirFilasCobertura()
// (valor/ceroReal/sinDatos/conErrores/total), nunca sobre una metrica
// inventada que no tiene una decision de producto detras.
//
// RONDA 2 (Alex 2026-11-09, punto 2): la direccion (MEJORA/EMPEORA) y la
// prioridad de la recomendacion se deciden por TASAS sobre el total de
// filas (tasa valida, tasa sin datos, tasa con errores), nunca por los
// CONTEOS absolutos solos -- 2 importaciones con distinto volumen de
// filas no son comparables por conteo (ej. 1 fila con error sobre 10 es
// peor que 2 filas con error sobre 100, aunque el conteo absoluto haya
// subido). Los conteos se siguen mostrando (ver "causasObservables" y
// los campos *Actual de ResumenFilasCobertura expuestos en
// PuntoResumenCobertura.resumen), pero solo como contexto -- jamas como
// la unica entrada de la decision de direccion/prioridad.

// RONDA 4, punto 1: estado de version EXPLICITO de una importacion --
// antes se sobrecargaba `ruleVersion: string | null` para significar 2
// situaciones MUY distintas ("esta importacion no tiene ninguna fila" y
// "esta importacion tiene filas, pero de 2+ ruleVersion distintas"),
// ambas colapsadas al mismo `null`. Esa sobrecarga escondia un bug
// real: una importacion ACTUAL sin filas (deberia ser TOTAL_CERO)
// terminaba mostrando VERSION_MEZCLADA, porque el codigo no podia
// distinguir "0 filas" de "mezclada" una vez colapsadas a `null`.
//   - SIN_FILAS: la importacion no tiene ninguna fila (total = 0).
//   - UNICA: TODAS sus filas declaran la MISMA ruleVersion (ese valor
//     vive en el campo `ruleVersion` de abajo).
//   - MEZCLADA: tiene filas, pero de 2+ ruleVersion distintas dentro de
//     la MISMA importacion.
export type EstadoVersionCobertura = "SIN_FILAS" | "UNICA" | "MEZCLADA";

export interface PuntoResumenCobertura {
  importId: string;
  periodoReferencia: { inicio: Date | null; fin: Date | null };
  resumen: ResumenFilasCobertura;
  // RONDA 4, punto 1: ver EstadoVersionCobertura arriba -- se deriva en
  // la pagina (cargarResultadoImportacionCobertura() /
  // cargarHistoricoResumenCobertura()) a partir del MISMO groupBy ya
  // existente (ver RONDA 2, punto 4), sin ninguna consulta nueva.
  estadoVersion: EstadoVersionCobertura;
  // Version de regla derivada de las filas de ESTA importacion -- SOLO
  // tiene un valor no null cuando estadoVersion === "UNICA" (en
  // SIN_FILAS/MEZCLADA no hay una version propia que declarar). Se
  // conserva como campo separado (en vez de fusionarlo con
  // estadoVersion) porque el resto de este archivo necesita comparar
  // ese string exacto contra el de otro punto.
  ruleVersion: string | null;
}

export interface AnalisisImportacionCobertura {
  // SOLO incluye, ademas de la actual, importaciones historicas con la
  // MISMA ruleVersion EXACTA que la actual (ver RONDA 2, punto 4) -- si
  // la actual mezcla versiones (ruleVersion null), queda sola (array de
  // 1 elemento, informacion insuficiente).
  tendencia: PuntoResumenCobertura[];
  tendenciaInformacionInsuficiente: boolean;
  periodoAnterior: PuntoResumenCobertura | null;
  // Tasas sobre el total de filas de la importacion actual (RONDA 2,
  // punto 2). `null` cuando el total de filas es 0 -- un total cero
  // nunca se disfraza de "0% de cada categoria", es informacion
  // insuficiente.
  tasaValidaActual: number | null;
  tasaConErroresActual: number | null;
  tasaSinDatosActual: number | null;
  // Variacion de TASAS (no de conteos absolutos) contra el periodo
  // anterior comparable.
  variacionTasaValidas: VariacionValor | null;
  variacionTasaConErrores: VariacionValor | null;
  // RONDA 3, punto 1: antes la "causa" de sin-datos se calculaba sobre
  // el CONTEO crudo (mismo error que ya se corrigio para validas/
  // errores en la Ronda 2) -- si el volumen total crecia pero la TASA
  // de filas sin datos se mantenia igual, igual se mostraba como un
  // "cambio". Ahora es una variacion de tasa mas, igual que las otras 2.
  variacionTasaSinDatos: VariacionValor | null;
  comparacionInformacionInsuficiente: boolean;
  // RONDA 3, punto 2: por que es insuficiente (null si SI fue posible) --
  // VERSION_MEZCLADA | SIN_HISTORICO | RULE_VERSION_INCOMPATIBLE |
  // TOTAL_CERO para este dominio (SIN_DATOS_PERIODO_ANTERIOR es
  // exclusivo de OTIF/Fill Rate).
  motivoInformacionInsuficiente: MotivoInformacionInsuficiente;
  causasObservables: string[];
  recomendacion: RecomendacionKpi | null;
  siguienteAccionPropuesta: string | null;
  notaMetodologica: string;
}

const NOTA_METODOLOGICA_COBERTURA =
  "No existe todavía una metodología acordada para agregar la cobertura entre SKU en un solo valor -- la evolución reciente y la comparación de este KPI se miden sobre tasas por categoría (válidas, sin datos, con errores) sobre el total de filas, nunca sobre un promedio de días inventado.";

// Umbrales de magnitud para la prioridad de la recomendacion de
// Cobertura -- RONDA 2, punto 2: se aplican sobre la TASA de filas con
// errores (fraccion del total, escala 0..1), nunca sobre el conteo
// absoluto. 0.05 = 5 puntos porcentuales de delta absoluto en la tasa;
// 0.20 = 20% de cambio relativo en la tasa -- mismo criterio de
// hipotesis inicial ajustable que el resto de este archivo.
const UMBRAL_TASA_PUNTOS_ALTA_COBERTURA = 0.05;
const UMBRAL_PORCENTUAL_ALTA_COBERTURA = 0.20;

function formatearTasaInterna(fraccion: number): string {
  return `${(fraccion * 100).toFixed(1)}%`;
}

export function generarAnalisisImportacionCobertura(
  actual: PuntoResumenCobertura,
  // Importaciones PROCESADA anteriores a la actual (misma cadenaId), de
  // CUALQUIER ruleVersion, orden cronologico ascendente -- el filtrado
  // por ruleVersion comparable ocurre dentro de esta funcion (RONDA 2,
  // punto 4), el llamador no necesita filtrar.
  historicoPrevio: PuntoResumenCobertura[],
): AnalisisImportacionCobertura {
  // RONDA 4, punto 1: la evolucion reciente (lista de varios puntos,
  // NO "la comparacion" -- ver el comentario de cabecera del archivo)
  // sigue excluyendo todo punto que no sea UNICA con la MISMA
  // ruleVersion exacta que la actual. Si la actual no es UNICA, no hay
  // ninguna version propia con la que comparar nada.
  const historicoComparable =
    actual.estadoVersion === "UNICA"
      ? historicoPrevio.filter((p) => p.estadoVersion === "UNICA" && p.ruleVersion === actual.ruleVersion)
      : [];

  const tendencia = [...historicoComparable, actual];
  const tendenciaInformacionInsuficiente = tendencia.length < 2;

  // RONDA 4, punto 2/3: la COMPARACION usa ESTRICTAMENTE el periodo
  // inmediatamente anterior CRONOLOGICO -- el ultimo elemento de
  // `historicoPrevio` SIN filtrar (nunca el ultimo de
  // `historicoComparable`, que puede saltarse uno incompatible para
  // llegar a otro mas antiguo que si calce -- ese era el bug de la
  // Ronda 3).
  const periodoInmediatoAnterior = historicoPrevio.at(-1) ?? null;

  const totalActual = actual.resumen.total;
  // RONDA 2, punto 2: total=0 es informacion insuficiente -- no hay
  // tasa que calcular sobre 0 filas.
  const tasaValidaActual = totalActual > 0 ? (actual.resumen.valor + actual.resumen.ceroReal) / totalActual : null;
  const tasaConErroresActual = totalActual > 0 ? actual.resumen.conErrores / totalActual : null;
  const tasaSinDatosActual = totalActual > 0 ? actual.resumen.sinDatos / totalActual : null;

  let variacionTasaValidas: VariacionValor | null = null;
  let variacionTasaConErrores: VariacionValor | null = null;
  let variacionTasaSinDatos: VariacionValor | null = null;
  const causasObservables: string[] = [];
  let recomendacion: RecomendacionKpi | null = null;

  // RONDA 4, punto 3: el motivo se decide mirando PRIMERO el estado de
  // la propia actual (igual prioridad que ya tenia VERSION_MEZCLADA
  // desde la Ronda 3 -- si la actual no tiene una version propia, da
  // igual el historico) y, recien si la actual es UNICA, el estado del
  // periodo INMEDIATO anterior (nunca uno mas antiguo):
  //   - actual SIN_FILAS -> TOTAL_CERO (antes se perdia en
  //     VERSION_MEZCLADA por la sobrecarga de ruleVersion=null -- ver
  //     cabecera del archivo).
  //   - actual MEZCLADA -> VERSION_MEZCLADA.
  //   - actual UNICA, sin ningun periodo anterior -> SIN_HISTORICO.
  //   - actual UNICA, el INMEDIATO anterior SIN_FILAS -> TOTAL_CERO.
  //   - actual UNICA, el INMEDIATO anterior MEZCLADA -> VERSION_MEZCLADA.
  //   - actual UNICA, el INMEDIATO anterior UNICA pero de otra
  //     ruleVersion -> RULE_VERSION_INCOMPATIBLE (sin buscar uno mas
  //     antiguo que si coincida).
  //   - actual UNICA, el INMEDIATO anterior UNICA con la MISMA
  //     ruleVersion -> comparacion posible, `periodoAnterior` es ESE
  //     punto.
  let motivoInformacionInsuficiente: MotivoInformacionInsuficiente = null;
  let periodoAnterior: PuntoResumenCobertura | null = null;

  if (actual.estadoVersion === "SIN_FILAS") {
    motivoInformacionInsuficiente = "TOTAL_CERO";
  } else if (actual.estadoVersion === "MEZCLADA") {
    motivoInformacionInsuficiente = "VERSION_MEZCLADA";
  } else if (periodoInmediatoAnterior === null) {
    motivoInformacionInsuficiente = "SIN_HISTORICO";
  } else if (periodoInmediatoAnterior.estadoVersion === "SIN_FILAS") {
    motivoInformacionInsuficiente = "TOTAL_CERO";
  } else if (periodoInmediatoAnterior.estadoVersion === "MEZCLADA") {
    motivoInformacionInsuficiente = "VERSION_MEZCLADA";
  } else if (periodoInmediatoAnterior.ruleVersion !== actual.ruleVersion) {
    motivoInformacionInsuficiente = "RULE_VERSION_INCOMPATIBLE";
  } else {
    periodoAnterior = periodoInmediatoAnterior;
  }

  // `periodoAnterior` solo queda asignado en la rama final de arriba,
  // que ya garantiza (por construccion de estadoVersion) que NI el
  // total actual NI el total anterior son 0 -- SIN_FILAS en cualquiera
  // de los 2 lados ya se convirtio en TOTAL_CERO mas arriba, nunca
  // llega hasta aca.
  const comparacionPosible = periodoAnterior !== null;

  if (comparacionPosible && periodoAnterior !== null && tasaValidaActual !== null && tasaConErroresActual !== null && tasaSinDatosActual !== null) {
    const totalAnterior = periodoAnterior.resumen.total;
    const tasaValidaAnterior = (periodoAnterior.resumen.valor + periodoAnterior.resumen.ceroReal) / totalAnterior;
    const tasaConErroresAnterior = periodoAnterior.resumen.conErrores / totalAnterior;
    const tasaSinDatosAnterior = periodoAnterior.resumen.sinDatos / totalAnterior;

    // masAltoEsMejor=true: una tasa valida mas alta es mejor (mas SKUs
    // con un resultado calculable sobre el total de la importacion).
    variacionTasaValidas = compararValorConAnterior(tasaValidaActual, tasaValidaAnterior, true);
    // masAltoEsMejor=false: una tasa de errores mas alta es peor.
    variacionTasaConErrores = compararValorConAnterior(tasaConErroresActual, tasaConErroresAnterior, false);
    // masAltoEsMejor=false: una tasa de filas sin datos mas alta es peor
    // (RONDA 3, punto 1 -- antes esto se decidia por el CONTEO crudo, ver
    // el comentario del campo en la interfaz de arriba).
    variacionTasaSinDatos = compararValorConAnterior(tasaSinDatosActual, tasaSinDatosAnterior, false);

    const validasActualConteo = actual.resumen.valor + actual.resumen.ceroReal;
    const validasAnteriorConteo = periodoAnterior.resumen.valor + periodoAnterior.resumen.ceroReal;

    // Los conteos se muestran SIEMPRE como contexto junto a la tasa (con
    // su denominador, igual para las 3 categorias), pero la decision de
    // "cambio" (si se muestra la frase o no) la toma SIEMPRE la TASA,
    // nunca el conteo solo (RONDA 2, punto 2 -- extendido a sin-datos en
    // la RONDA 3, punto 1: si el volumen total crece pero la tasa de
    // cada categoria se mantiene igual, NO se presenta como un cambio).
    if (variacionTasaConErrores.direccion !== "ESTABLE") {
      causasObservables.push(
        `La tasa de filas con errores pasó de ${formatearTasaInterna(tasaConErroresAnterior)} (${periodoAnterior.resumen.conErrores}/${totalAnterior}) a ${formatearTasaInterna(tasaConErroresActual)} (${actual.resumen.conErrores}/${totalActual}).`,
      );
    }
    if (variacionTasaSinDatos.direccion !== "ESTABLE") {
      causasObservables.push(
        `La tasa de filas sin datos pasó de ${formatearTasaInterna(tasaSinDatosAnterior)} (${periodoAnterior.resumen.sinDatos}/${totalAnterior}) a ${formatearTasaInterna(tasaSinDatosActual)} (${actual.resumen.sinDatos}/${totalActual}).`,
      );
    }
    if (variacionTasaValidas.direccion !== "ESTABLE") {
      causasObservables.push(
        `La tasa de filas con resultado válido pasó de ${formatearTasaInterna(tasaValidaAnterior)} (${validasAnteriorConteo}/${totalAnterior}) a ${formatearTasaInterna(tasaValidaActual)} (${validasActualConteo}/${totalActual}).`,
      );
    }
    if (causasObservables.length === 0) {
      causasObservables.push("Las tasas por categoría no cambiaron respecto a la importación anterior.");
    }

    recomendacion = construirRecomendacionCobertura(variacionTasaConErrores);
  }

  const siguienteAccionPropuesta =
    recomendacion && recomendacion.prioridad !== "BAJA"
      ? "Registrar una acción de seguimiento con responsable y fecha objetivo para esta importación."
      : null;

  return {
    tendencia,
    tendenciaInformacionInsuficiente,
    periodoAnterior,
    tasaValidaActual,
    tasaConErroresActual,
    tasaSinDatosActual,
    variacionTasaValidas,
    variacionTasaConErrores,
    variacionTasaSinDatos,
    comparacionInformacionInsuficiente: !comparacionPosible,
    motivoInformacionInsuficiente,
    causasObservables,
    recomendacion,
    siguienteAccionPropuesta,
    notaMetodologica: NOTA_METODOLOGICA_COBERTURA,
  };
}

function construirRecomendacionCobertura(variacionTasaConErrores: VariacionValor): RecomendacionKpi {
  if (variacionTasaConErrores.direccion === "EMPEORA") {
    // RONDA 2, punto 2: magnitud ALTA se decide sobre la TASA (puntos
    // porcentuales de delta absoluto, o delta relativo de la tasa),
    // nunca sobre el conteo absoluto de filas con error.
    const magnitudAlta =
      Math.abs(variacionTasaConErrores.deltaAbsoluto) >= UMBRAL_TASA_PUNTOS_ALTA_COBERTURA ||
      (variacionTasaConErrores.deltaPorcentual !== null &&
        Math.abs(variacionTasaConErrores.deltaPorcentual) >= UMBRAL_PORCENTUAL_ALTA_COBERTURA);
    return {
      prioridad: magnitudAlta ? "ALTA" : "MEDIA",
      texto:
        "La tasa de filas con errores aumentó respecto a la importación anterior -- revisar la calidad de los datos de origen (inventario/consumo) antes de la próxima carga.",
    };
  }
  if (variacionTasaConErrores.direccion === "MEJORA") {
    return {
      prioridad: "BAJA",
      texto:
        "La tasa de filas con errores disminuyó respecto a la importación anterior -- mantener las prácticas de carga de este período.",
    };
  }
  return {
    prioridad: "BAJA",
    texto:
      "La tasa de filas con errores se mantuvo estable respecto a la importación anterior -- sin cambios que requieran atención inmediata.",
  };
}
