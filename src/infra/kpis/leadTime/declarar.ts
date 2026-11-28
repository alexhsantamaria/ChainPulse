// Infraestructura (PURA -- sin Prisma) -- validacion y calculo
// compartidos por previsualizar y confirmar una ObservacionKpi de Lead
// time, KPI #1 del pipeline de los 6 pendientes (diseno aprobado
// 2026-11-27, docs/engineering/diseno-leadtime-implementacion-2026-11-27.md
// + decision del 2026-11-27 sobre la advertencia heuristica de
// duplicados). Mismo patron que src/infra/kpis/otif/declarar.ts -- mismo
// motivo para no importar Prisma aca (ver su comentario de cabecera):
// este archivo se prueba en declarar.test.ts sin ninguna base de datos.
// La orquestacion que SI toca Prisma vive en ./persistir.ts.
//
// Nivel 1 (modo "manual"): el usuario captura DIRECTAMENTE el lead time
// promedio ya calculado (ej. de un reporte externo) como un unico valor
// numerico -- NUNCA se inventa un numerador/denominador sintetico (a
// diferencia del agregado manual de OTIF, que SI es un ratio estimable a
// ojo). Decision confirmada 2026-11-27: `numerador`/`denominador` quedan
// `null` (ObservacionKpi.numerador/denominador son Float? en el schema --
// el contrato admite su ausencia; el adaptador de historico solo lee
// `valor`, y analisisDecision.ts ya guarda con `!== null` antes de
// comparar numerador/denominador entre periodos -- verificado antes de
// fijar esta decision, no asumido). La unidad ("dias") se muestra fija y
// no editable en el formulario de captura -- restriccion de UI, no de
// datos, por eso no aparece como campo aca.
//
// Nivel 2 (modo "pegado"): tabla de MULTIPLES filas {proceso, inicio,
// fin}, calculada fila a fila con calcularLeadTime() (ya construida y
// probada en src/engine/kpis/leadTime.ts, no se reescribe aca).
//
// Duplicados dentro de la misma carga (decision del 2026-11-27, Alex):
// Lead time NO reutiliza la regla de "pedido duplicado" de OTIF (C1) --
// un `proceso` es una etiqueta descriptiva que SI puede repetirse
// legitimamente varias veces en el mismo periodo (cada repeticion es una
// instancia distinta que se promedia). En su lugar, una advertencia
// HEURISTICA, NO BLOQUEANTE: si la terna (proceso saneado, inicio
// normalizado, fin normalizado) se repite EXACTAMENTE dentro de la misma
// carga, se marca cada fila implicada con una advertencia visible --
// nunca se rechaza, deduplica, fusiona u omite ninguna fila
// automaticamente, y la confirmacion nunca se bloquea por esto. No se
// detectan duplicados ENTRE cargas distintas (cada previsualizacion/
// confirmacion analiza solo las filas de su propio payload). No se
// agrega ningun campo de identidad de origen (`idOrigen` u equivalente)
// ni se toca Prisma/schema para esto -- queda documentado como limitacion
// conocida; una identidad estable de origen queda como mejora futura,
// basada en evidencia de uso real, no inventada aca.
import { calcularLeadTime, type FilaLeadTime } from "@/engine/kpis/leadTime";
import { RULE_VERSION_KPIS, type ResultadoCalculoKpi } from "@/engine/kpis/constantes";
import { MAX_FILAS_PEGADO_LEAD_TIME, MAX_LONGITUD_PROCESO } from "@/domain/limitesDeclaracionLeadTime";

// Mismo rotulo que ya declara el campo `fuente` de ObservacionKpi en
// prisma/schema.prisma ("manual" | "pegado" | "csv" -- CSV queda fuera
// del piloto, mismo criterio que OTIF).
export type ModoDeclaracionLeadTime = "manual" | "pegado";

export interface FilaLeadTimeEntrada {
  proceso: string;
  inicio: string; // ISO date, AAAA-MM-DD estricto
  fin: string | null; // null = proceso todavia no cerrado (dato de negocio incompleto, no error de forma)
  // Presente SOLO si esta fila comparte proceso+inicio+fin (ya saneados/
  // normalizados) con al menos otra fila de esta misma carga --
  // advertencia NO BLOQUEANTE, nunca hace que la fila se excluya,
  // rechace o fusione (ver comentario de cabecera).
  advertencia?: string;
}

export type EntradaDeclaracionLeadTime =
  | {
      modo: "manual";
      cadenaId: string;
      periodoInicio: string; // ISO date, AAAA-MM-DD estricto
      periodoFin: string; // ISO date, AAAA-MM-DD estricto
      valorPromedioDias: number;
    }
  | {
      modo: "pegado";
      cadenaId: string;
      periodoInicio: string; // ISO date, AAAA-MM-DD estricto
      periodoFin: string; // ISO date, AAAA-MM-DD estricto
      // Payload de RED tal cual llega (JSON.parse), nunca validado
      // todavia -- mismo criterio que EntradaDeclaracionOtif.filas:
      // construirFilaLeadTime() (mas abajo) es el UNICO lugar que valida
      // la forma real de cada fila, elemento por elemento.
      filas: unknown[];
    };

// Fallos de validacion con detalle estructurado -- mismo criterio que
// FalloValidacionOtif: nunca datos sensibles (solo `proceso`, nunca
// fechas individuales). Deliberadamente SIN ningun error de tipo
// "duplicado" ni "fuera de periodo" -- ninguna de las dos reglas de OTIF
// se replica aca (ver comentario de cabecera).
export type FalloValidacionLeadTime =
  | { error: "DATOS_INVALIDOS" }
  | { error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" }
  | { error: "DEMASIADAS_FILAS"; limite: number; recibidas: number };

export type ResultadoPrevisualizarLeadTime =
  | { ok: true; resultado: ResultadoCalculoKpi; filasInterpretadas?: FilaLeadTimeEntrada[] }
  | ({ ok: false } & FalloValidacionLeadTime);

// Muestra de filas interpretadas devuelta en la previsualizacion del modo
// "pegado" -- mismo criterio y mismo numero que FILAS_DE_MUESTRA de OTIF:
// nunca el array completo, solo para que la UI confirme "asi se va a
// interpretar tu tabla" (y, aca ademas, "estas filas comparten advertencia
// de posible duplicado") antes de confirmar. Las advertencias se calculan
// sobre el conjunto COMPLETO de filas antes de recortar la muestra -- una
// fila fuera de la muestra puede ser la que marca a una fila SI mostrada,
// pero la muestra en si solo puede mostrar advertencias entre filas que
// quedaron dentro de las primeras FILAS_DE_MUESTRA (misma limitacion ya
// existente en el patron compartido con OTIF, no una regresion nueva).
const FILAS_DE_MUESTRA = 10;

export const MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME = "Posible duplicado dentro de esta carga; verificar antes de confirmar.";

const FORMATO_FECHA_ESTRICTO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parsea una fecha calendario AAAA-MM-DD ESTRICTA -- identico criterio
 * que parsearFechaCalendarioEstricta() de otif/declarar.ts (nunca acepta
 * otro formato, nunca deja que `Date` normalice en silencio una fecha que
 * no existe, ancla a UTC). Exportada para que persistir.ts parsee
 * exactamente las mismas fechas de periodo con el mismo criterio al
 * persistir.
 */
export function parsearFechaCalendarioEstricta(valor: string): Date | null {
  const coincidencia = FORMATO_FECHA_ESTRICTO.exec(valor);
  if (!coincidencia) return null;
  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    return null;
  }
  return fecha;
}

function periodoValido(periodoInicio: string, periodoFin: string): { inicio: Date; fin: Date } | null {
  const inicio = parsearFechaCalendarioEstricta(periodoInicio);
  const fin = parsearFechaCalendarioEstricta(periodoFin);
  if (!inicio || !fin) return null;
  if (inicio.getTime() > fin.getTime()) return null;
  return { inicio, fin };
}

// Objeto simple (nunca null, nunca un array) -- mismo criterio que
// esObjetoFilaCandidato() de otif/declarar.ts.
function esObjetoFilaCandidato(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

// Resultado de validar UNA fila de red (unknown) contra la forma que
// necesitan, respectivamente, el motor de calculo (fechas Date, proceso
// ya recortado) y la UI de previsualizacion (strings tal cual los mando
// el cliente). Mismo patron que FilaOtifValidada.
interface FilaLeadTimeValidada {
  motor: FilaLeadTime;
  entrada: FilaLeadTimeEntrada;
  // Clave de comparacion de duplicados (proceso saneado + timestamps de
  // inicio/fin ya normalizados) -- se calcula aca, una sola vez por fila,
  // para no volver a parsear fechas en la deteccion de advertencias.
  claveDuplicado: string;
}

/**
 * Valida la forma de una fila cruda de Lead time -- cada propiedad se
 * valida por tipo ANTES de usarla, nunca lanza, nunca deja pasar un valor
 * a medio validar (mismo criterio que construirFilaOtif()).
 */
function construirFilaLeadTime(filaCruda: unknown): FilaLeadTimeValidada | null {
  if (!esObjetoFilaCandidato(filaCruda)) return null;

  if (typeof filaCruda.proceso !== "string") return null;
  const procesoOriginal = filaCruda.proceso;
  const proceso = procesoOriginal.trim();
  if (proceso.length === 0 || proceso.length > MAX_LONGITUD_PROCESO) return null;

  if (typeof filaCruda.inicio !== "string") return null;
  const inicioTexto = filaCruda.inicio;
  const inicio = parsearFechaCalendarioEstricta(inicioTexto);
  if (!inicio) return null;

  // `fin` es nullable PERO, si esta presente, tiene que ser un string --
  // un campo ausente (undefined) NO se trata como "equivalente a null":
  // es una fila con forma invalida y rechaza la carga completa como
  // DATOS_INVALIDOS (mismo criterio que fechaReal de OTIF). `fin: null`
  // explicito SI es un dato de negocio valido (proceso aun no cerrado) --
  // se pasa tal cual al motor, que decide excluir esa fila del promedio.
  const finCrudo = filaCruda.fin;
  if (finCrudo !== null && typeof finCrudo !== "string") return null;
  let fin: Date | null = null;
  let finTexto: string | null = null;
  if (finCrudo !== null) {
    fin = parsearFechaCalendarioEstricta(finCrudo);
    if (!fin) return null;
    finTexto = finCrudo;
  }

  // Clave de duplicado: proceso SANEADO (trim, SENSIBLE a mayusculas/
  // minusculas -- mismo criterio que normalizarClavePedido() de OTIF,
  // ninguna decision funcional propia justifica case-insensitive aca
  // tampoco) + timestamps ya normalizados (nunca el string crudo de
  // fecha, para que dos representaciones equivalentes de la misma fecha
  // coincidan igual que coincidirian para el motor de calculo).
  const claveDuplicado = `${proceso}\u0000${inicio.getTime()}\u0000${fin === null ? "null" : fin.getTime()}`;

  return {
    motor: { proceso, inicio, fin },
    entrada: { proceso: procesoOriginal, inicio: inicioTexto, fin: finTexto },
    claveDuplicado,
  };
}

/**
 * Valida y calcula una observacion Lead time a partir del payload del
 * cliente -- NUNCA persiste (mismo RF que OTIF: "previsualizar nunca
 * escribe en la base"). Reutilizada tal cual por
 * confirmarObservacionLeadTime() (persistir.ts) para recalcular
 * server-side antes de guardar.
 *
 * Manual: `valorPromedioDias` debe ser un numero finito >= 0 (un lead
 * time no puede ser negativo; 0 es un caso de borde valido -- un proceso
 * instantaneo). Un dato invalido rechaza la peticion completa
 * (DATOS_INVALIDOS). El resultado se construye DIRECTAMENTE (nunca pasa
 * por calcularPromedio(), que forzaria numerador=valor/denominador=1 --
 * decision confirmada 2026-11-27: ambos quedan `null`).
 *
 * Pegado: calcularLeadTime() decide fila por fila que se excluye por
 * datos de negocio incompletos (sin `fin` o `fin` anterior a `inicio`) --
 * esa fila nunca hace fallar la peticion completa. En cambio, CUALQUIERA
 * de estos problemas rechaza la carga COMPLETA (mismo criterio que
 * OTIF para errores de FORMATO, nunca de negocio):
 *   1. Formato ilegible en cualquier fila -- DATOS_INVALIDOS.
 *   2. Mas de MAX_FILAS_PEGADO_LEAD_TIME filas -- DEMASIADAS_FILAS.
 * A diferencia de OTIF, NO HAY una tercera regla de "pedido duplicado"
 * (C1) ni una cuarta de "fuera de periodo" (A1/B2) -- ninguna de las dos
 * aplica al dominio de Lead time (ver comentario de cabecera). En su
 * lugar, los duplicados exactos (proceso+inicio+fin) se marcan con una
 * advertencia NO BLOQUEANTE en `filasInterpretadas`, nunca rechazan la
 * carga ni excluyen ninguna fila del calculo.
 */
export function previsualizarObservacionLeadTime(entrada: EntradaDeclaracionLeadTime): ResultadoPrevisualizarLeadTime {
  if (!entrada.cadenaId) {
    return { ok: false, error: "DATOS_INVALIDOS" };
  }
  const periodo = periodoValido(entrada.periodoInicio, entrada.periodoFin);
  if (!periodo) {
    return { ok: false, error: "DATOS_INVALIDOS" };
  }

  if (entrada.modo === "manual") {
    if (!Number.isFinite(entrada.valorPromedioDias) || entrada.valorPromedioDias < 0) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }

    // Una observacion manual es UN UNICO dato ya promediado, capturado
    // directamente -- nunca un numerador/denominador sintetico (decision
    // confirmada 2026-11-27, ver comentario de cabecera). filasEvaluadas=1
    // refleja ese unico dato; cobertura=1 y advertencias=[] porque no hay
    // ninguna fila excluida (no hay "filas" en el modo manual).
    const resultado: ResultadoCalculoKpi = {
      valor: entrada.valorPromedioDias,
      numerador: null,
      denominador: null,
      filasEvaluadas: 1,
      filasExcluidas: 0,
      cobertura: 1,
      advertencias: [],
      ruleVersion: RULE_VERSION_KPIS,
    };
    return { ok: true, resultado };
  }

  // modo "pegado"
  if (!Array.isArray(entrada.filas) || entrada.filas.length === 0) {
    return { ok: false, error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" };
  }

  if (entrada.filas.length > MAX_FILAS_PEGADO_LEAD_TIME) {
    return { ok: false, error: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_LEAD_TIME, recibidas: entrada.filas.length };
  }

  const filasLeadTime: FilaLeadTime[] = [];
  const filasValidadas: FilaLeadTimeEntrada[] = [];
  const clavesDuplicado: string[] = [];
  for (const filaCruda of entrada.filas) {
    const filaConstruida = construirFilaLeadTime(filaCruda);
    if (!filaConstruida) {
      // Error de FORMATO del payload (no un dato de negocio incompleto,
      // que calcularLeadTime() ya sabe excluir solo) -- rechaza la
      // peticion completa, mismo criterio que OTIF. NUNCA lanza.
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    filasLeadTime.push(filaConstruida.motor);
    filasValidadas.push(filaConstruida.entrada);
    clavesDuplicado.push(filaConstruida.claveDuplicado);
  }

  // Advertencia heuristica NO BLOQUEANTE (decision 2026-11-27): si la
  // terna (proceso saneado, inicio normalizado, fin normalizado) se
  // repite EXACTAMENTE dentro de esta misma carga, se marca cada fila
  // implicada -- nunca se rechaza, deduplica, fusiona u omite ninguna
  // fila. Nunca compara contra cargas anteriores (esta funcion no tiene
  // visibilidad de ninguna otra carga -- es pura, sin Prisma).
  const conteoClaves = new Map<string, number>();
  for (const clave of clavesDuplicado) {
    conteoClaves.set(clave, (conteoClaves.get(clave) ?? 0) + 1);
  }
  for (let i = 0; i < filasValidadas.length; i++) {
    // Guarda de seguridad de indices (TS2345/TS2322 bajo noUncheckedIndexedAccess
    // -- hallado en la validacion Windows, 2026-11-28): clavesDuplicado y
    // filasValidadas se llenan en el mismo bucle de arriba, elemento a
    // elemento, asi que SIEMPRE tienen la misma longitud y SIEMPRE hay un
    // valor en cada indice -- este `continue` nunca se ejecuta en la
    // practica. Es puramente una guarda de tipos para el compilador, NUNCA
    // elimina, filtra, fusiona ni rechaza ninguna fila real.
    const claveDuplicado = clavesDuplicado[i];
    const filaValidada = filasValidadas[i];

    if (claveDuplicado === undefined || filaValidada === undefined) {
      continue;
    }

    if ((conteoClaves.get(claveDuplicado) ?? 0) > 1) {
      filasValidadas[i] = {
        ...filaValidada,
        advertencia: MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME,
      };
    }
  }

  // El calculo SIEMPRE usa TODAS las filas, incluidas las marcadas con
  // advertencia -- la advertencia nunca excluye, fusiona ni deduplica
  // ninguna fila del promedio (regla 3/6 de la decision 2026-11-27).
  const resultado = calcularLeadTime(filasLeadTime);
  return { ok: true, resultado, filasInterpretadas: filasValidadas.slice(0, FILAS_DE_MUESTRA) };
}
