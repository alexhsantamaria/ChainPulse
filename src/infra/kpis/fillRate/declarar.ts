// Infraestructura (PURA -- sin Prisma) -- validacion y calculo
// compartidos por previsualizar y confirmar una ObservacionKpi de Fill
// Rate, Incremento 4 Bloque B (Alex, 2026-10-14 -- siguiente KPI despues
// de OTIF, recomendado por auditoria-comparativa-8-kpis-pendientes-2026-10-14.md).
//
// Mismo patron que src/infra/kpis/otif/declarar.ts (reutilizado
// deliberadamente: previsualizar nunca persiste, confirmar recalcula
// server-side con la MISMA funcion, nunca confia en un `valor` enviado por
// el cliente), pero SIN la deuda especifica del piloto de OTIF: no hay
// ningun campo de fecha en `FilaFillRate` (src/engine/kpis/fillRate.ts:
// `{ sku, pedido, solicitado, servido }`), asi que esta version no
// necesita parser de fecha estricta para las filas individuales, ni una
// validacion de "fuera de periodo" -- no hay fecha de fila contra la que
// comparar el periodo. `periodoInicio`/`periodoFin` siguen siendo fechas
// (delimitan la ObservacionKpi persistida, igual que en OTIF), por eso
// SI necesitan el mismo parser estricto, copiado aca como una funcion
// local pequena y pura en vez de importarla de otif/declarar.ts -- evita
// acoplar este modulo nuevo al codigo ya piloteado de OTIF (que no se
// toca en este cambio).
//
// Deliberadamente SIN import de Prisma/tenantClient -- mismo motivo que
// otif/declarar.ts: estas funciones se prueban en declarar.test.ts sin
// ninguna base de datos. La orquestacion que SI toca Prisma vive en
// persistir.ts, que importa este archivo, nunca al reves.
import { calcularFillRate, type FilaFillRate } from "@/engine/kpis/fillRate";
import { calcularRatio } from "@/engine/kpis/compartido";
import type { ResultadoCalculoKpi } from "@/engine/kpis/constantes";
import { MAX_FILAS_PEGADO_FILL_RATE, MAX_LONGITUD_IDENTIFICADOR_FILL_RATE } from "@/domain/limitesDeclaracionFillRate";

// Mismo rotulo que ya declara el campo `fuente` de ObservacionKpi en
// prisma/schema.prisma ("manual" | "pegado" | "csv" -- CSV queda fuera de
// este alcance, igual que en OTIF).
export type ModoDeclaracionFillRate = "manual" | "pegado";

export interface FilaFillRateEntrada {
  sku: string;
  pedido: string;
  solicitado: number;
  servido: number | null;
}

export type EntradaDeclaracionFillRate =
  | {
      modo: "manual";
      cadenaId: string;
      periodoInicio: string; // ISO date, AAAA-MM-DD estricto
      periodoFin: string; // ISO date, AAAA-MM-DD estricto
      numerador: number;
      denominador: number;
    }
  | {
      modo: "pegado";
      cadenaId: string;
      periodoInicio: string; // ISO date, AAAA-MM-DD estricto
      periodoFin: string; // ISO date, AAAA-MM-DD estricto
      // Payload de RED tal cual llega (JSON.parse), nunca validado todavia
      // -- mismo criterio que EntradaDeclaracionOtif.filas: construirFilaFillRate()
      // (mas abajo) es el UNICO lugar que valida la forma real de cada
      // fila, elemento por elemento, antes de leer ninguna propiedad.
      filas: unknown[];
    };

// Fallos de validacion con detalle estructurado -- las rutas
// (previsualizar/confirmar) devuelven este objeto tal cual al cliente,
// para que la UI pueda identificar las filas afectadas (siempre por
// `pedido`, nunca con datos sensibles) y explicar el problema sin
// adivinar. Mismo patron que FalloValidacionOtif, sin FILAS_FUERA_DE_PERIODO
// (no hay fecha de fila que comparar contra el periodo en Fill Rate).
export type FalloValidacionFillRate =
  | { error: "DATOS_INVALIDOS" }
  | { error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" }
  | { error: "DEMASIADAS_FILAS"; limite: number; recibidas: number }
  | { error: "PEDIDOS_DUPLICADOS"; pedidos: string[] };

export type ResultadoPrevisualizarFillRate =
  | { ok: true; resultado: ResultadoCalculoKpi; filasInterpretadas?: FilaFillRateEntrada[] }
  | ({ ok: false } & FalloValidacionFillRate);

// Muestra de filas interpretadas devuelta en la previsualizacion del modo
// "pegado" -- mismo criterio que FILAS_DE_MUESTRA de OTIF: nunca el array
// completo, solo para que la UI confirme "asi se va a interpretar tu
// tabla" antes de confirmar.
const FILAS_DE_MUESTRA = 10;

const FORMATO_FECHA_ESTRICTO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parsea una fecha calendario AAAA-MM-DD ESTRICTA -- copia local (no
 * importada de otif/declarar.ts a proposito, ver comentario de cabecera)
 * del mismo parser que OTIF ya valido: nunca acepta otro formato, nunca
 * deja que `Date` normalice en silencio una fecha que no existe. Ancla a
 * UTC para que la comparacion de periodo sea estable sin depender de la
 * zona horaria del servidor. Solo se usa aca para `periodoInicio`/
 * `periodoFin` (delimitan la ObservacionKpi) -- Fill Rate no tiene ningun
 * campo de fecha por fila.
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

/**
 * Clave de comparacion para detectar una fila duplicada dentro del mismo
 * payload -- identidad COMPUESTA `pedido + sku`, nunca `pedido` solo.
 *
 * Correccion de Alex 2026-10-14 (segunda revision, antes de autorizar el
 * commit): un `pedido` puede contener varias lineas, una por SKU --
 * MVP-DEFINITIVO.md linea 170 ("Fill Rate ... campos: SKU, pedido,
 * solicitado, servido") y el propio contrato de datos (`FilaFillRate`
 * con `sku` como campo PROPIO, distinto de `pedido`) no establecen
 * ninguna regla de dominio vigente que garantice un unico SKU por
 * pedido -- de hecho, que `sku` exista como campo separado es la
 * evidencia de lo contrario: si cada pedido tuviera un unico SKU, `sku`
 * seria redundante con `pedido` y no haria falta declararlo aparte. Sin
 * esa regla, la clave de duplicado NUNCA puede ser solo `pedido`: dos
 * filas del mismo pedido con SKU distinto son dos lineas legitimas del
 * mismo pedido (ej. un pedido que incluye dos productos), no un
 * duplicado -- deben aceptarse ambas. Solo cuenta como duplicado el
 * mismo `pedido` CON el mismo `sku` repetido.
 *
 * Ambos componentes se comparan con el mismo criterio SOLO trim,
 * SENSIBLE a mayusculas/minusculas que ya aprobo Alex para `pedido` en
 * OTIF (decision C1, 2026-10-10): " PED-1 " y "PED-1" son el mismo
 * pedido, "ped-1" y "PED-1" son distintos -- y lo mismo aplica ahora a
 * `sku`. Nunca se fuerza a mayusculas -- esta funcion es SOLO la clave de
 * comparacion, ni `pedido` ni `sku` guardados/mostrados se transforman.
 * `\u0000` como separador: no es un caracter valido dentro de `sku`/
 * `pedido` (ambos son texto legible, nunca binario), asi que no hay
 * colision posible entre, por ejemplo, pedido="A-B"+sku="C" y
 * pedido="A"+sku="B-C".
 */
function normalizarClaveFilaFillRate(pedido: string, sku: string): string {
  return `${pedido.trim()}\u0000${sku.trim()}`;
}

interface FilaFillRateValidada {
  motor: FilaFillRate;
  entrada: FilaFillRateEntrada;
}

// Objeto simple (nunca null, nunca un array) -- mismo criterio que
// esObjetoFilaCandidato de OTIF.
function esObjetoFilaCandidato(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Valida la forma real de una fila de red (unknown) antes de leer
 * cualquier propiedad -- mismo criterio que construirFilaOtif(): cada
 * campo se valida por tipo, una fila con forma incorrecta (no es un
 * objeto, le falta un campo, un campo tiene el tipo equivocado) devuelve
 * null, nunca lanza. `solicitado`/`servido` deben ser numeros FINITOS y
 * NO NEGATIVOS -- un valor negativo es un dato corrupto (nunca "fila sin
 * cerrar todavia", eso solo aplica a `servido: null`), se rechaza aca
 * como forma invalida, no se deja pasar al motor para que lo excluya en
 * silencio.
 *
 * Deliberadamente NO se rechaza `servido > solicitado` (sobre-entrega)
 * aca -- no es un error de forma ni un dato corrupto, es una fila
 * valida. El tope a `solicitado` (para que nunca aporte mas de 100% al
 * agregado) es una REGLA FUNCIONAL del motor (`calcularFillRate()`,
 * `Math.min(servido, solicitado)` en src/engine/kpis/fillRate.ts), no
 * una validacion de entrada -- aplicarlo aca, en el nivel de forma,
 * rechazaria de mas una fila de negocio perfectamente valida (una
 * sobre-entrega real, de dato de origen correcto).
 */
function construirFilaFillRate(filaCruda: unknown): FilaFillRateValidada | null {
  if (!esObjetoFilaCandidato(filaCruda)) return null;

  if (typeof filaCruda.sku !== "string") return null;
  const skuOriginal = filaCruda.sku;
  const sku = skuOriginal.trim();
  if (sku.length === 0 || sku.length > MAX_LONGITUD_IDENTIFICADOR_FILL_RATE) return null;

  if (typeof filaCruda.pedido !== "string") return null;
  const pedidoOriginal = filaCruda.pedido;
  const pedido = pedidoOriginal.trim();
  if (pedido.length === 0 || pedido.length > MAX_LONGITUD_IDENTIFICADOR_FILL_RATE) return null;

  const solicitadoCrudo = filaCruda.solicitado;
  if (typeof solicitadoCrudo !== "number" || !Number.isFinite(solicitadoCrudo) || solicitadoCrudo < 0) {
    return null;
  }

  // Mismo criterio que cantidadEntregada de OTIF: `servido` ausente
  // (undefined, propiedad faltante en el JSON) NO se trata como
  // equivalente a null -- es una fila con forma invalida y rechaza la
  // carga completa como DATOS_INVALIDOS (distinto del caso ya cubierto
  // por calcularFillRate(), donde el cliente SI manda `servido: null`
  // explicito para un pedido todavia no cerrado).
  const servidoCrudo = filaCruda.servido;
  if (servidoCrudo !== null && typeof servidoCrudo !== "number") return null;
  let servido: number | null = null;
  if (servidoCrudo !== null) {
    if (!Number.isFinite(servidoCrudo) || servidoCrudo < 0) return null;
    servido = servidoCrudo;
  }

  return {
    motor: { sku, pedido, solicitado: solicitadoCrudo, servido },
    entrada: { sku: skuOriginal, pedido: pedidoOriginal, solicitado: solicitadoCrudo, servido },
  };
}

/**
 * Valida y calcula una observacion de Fill Rate a partir del payload del
 * cliente -- NUNCA persiste. Reutilizada tal cual por
 * confirmarObservacionFillRate() (persistir.ts) para recalcular
 * server-side antes de guardar.
 *
 * Manual: un dato invalido (denominador<=0, numerador<0,
 * numerador>denominador, cualquiera de los dos no finito) rechaza la
 * peticion completa (DATOS_INVALIDOS) -- mismo criterio que OTIF: aca es
 * la unica observacion, no hay "fila que excluir".
 * numerador==denominador es valido (Fill Rate 100%).
 *
 * Pegado: calcularFillRate() decide fila por fila que se excluye por
 * datos de negocio incompletos (sin `servido` todavia) -- esa fila nunca
 * hace fallar la peticion completa, solo se refleja en
 * advertencias/cobertura del resultado. En cambio, estos problemas
 * rechazan la carga COMPLETA, sin excluir silenciosamente ni calcular un
 * resultado parcial (mismo criterio que OTIF):
 *   1. Formato ilegible en cualquier fila (numero no finito o negativo,
 *      `sku`/`pedido` vacio o demasiado largo) -- DATOS_INVALIDOS.
 *   2. Mas de MAX_FILAS_PEGADO_FILL_RATE filas -- DEMASIADAS_FILAS.
 *   3. La identidad COMPUESTA `pedido + sku` repetida dentro del mismo
 *      payload, despues del saneamiento (trim, sensible a mayusculas/
 *      minusculas en ambos campos) -- PEDIDOS_DUPLICADOS, identificando
 *      los pedidos afectados. NUNCA `pedido` solo: un mismo pedido con
 *      SKU distinto son dos lineas legitimas (ver
 *      normalizarClaveFilaFillRate() mas abajo) -- se aceptan ambas. A
 *      diferencia de OTIF no hay validacion de "fuera de periodo": Fill
 *      Rate no tiene ningun campo de fecha por fila contra el que
 *      comparar `periodoInicio`/`periodoFin`.
 */
export function previsualizarObservacionFillRate(entrada: EntradaDeclaracionFillRate): ResultadoPrevisualizarFillRate {
  if (!entrada.cadenaId) {
    return { ok: false, error: "DATOS_INVALIDOS" };
  }
  const periodo = periodoValido(entrada.periodoInicio, entrada.periodoFin);
  if (!periodo) {
    return { ok: false, error: "DATOS_INVALIDOS" };
  }

  if (entrada.modo === "manual") {
    if (!Number.isFinite(entrada.denominador) || !(entrada.denominador > 0)) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    if (!Number.isFinite(entrada.numerador) || entrada.numerador < 0) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    // numerador<=denominador: un agregado manual nunca puede reportar mas
    // unidades servidas que unidades solicitadas del periodo -- mismo
    // criterio que OTIF (numerador<=denominador) y que el propio motor
    // por fila (Math.min(servido, solicitado)).
    if (entrada.numerador > entrada.denominador) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }

    const resultado = calcularRatio(
      [{ numerador: entrada.numerador, denominador: entrada.denominador }],
      (fila) => fila,
      "fila manual invalida",
    );
    return { ok: true, resultado };
  }

  // modo "pegado"
  if (!Array.isArray(entrada.filas) || entrada.filas.length === 0) {
    return { ok: false, error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" };
  }

  if (entrada.filas.length > MAX_FILAS_PEGADO_FILL_RATE) {
    return { ok: false, error: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_FILL_RATE, recibidas: entrada.filas.length };
  }

  const filasFillRate: FilaFillRate[] = [];
  const filasValidadas: FilaFillRateEntrada[] = [];
  for (const filaCruda of entrada.filas) {
    const filaConstruida = construirFilaFillRate(filaCruda);
    if (!filaConstruida) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    filasFillRate.push(filaConstruida.motor);
    filasValidadas.push(filaConstruida.entrada);
  }

  // Pedido duplicado (tras saneamiento) rechaza TODA la carga -- mismo
  // criterio C1 de OTIF.
  // Clave COMPUESTA pedido+sku -- ver normalizarClaveFilaFillRate() mas
  // arriba para el razonamiento completo. Dos filas del mismo pedido con
  // SKU distinto nunca llegan aca como duplicado.
  const clavesVistas = new Map<string, number>();
  for (const fila of filasFillRate) {
    const clave = normalizarClaveFilaFillRate(fila.pedido, fila.sku);
    clavesVistas.set(clave, (clavesVistas.get(clave) ?? 0) + 1);
  }
  const clavesDuplicadas = new Set(
    Array.from(clavesVistas.entries())
      .filter(([, veces]) => veces > 1)
      .map(([clave]) => clave),
  );
  if (clavesDuplicadas.size > 0) {
    const pedidosAfectados = Array.from(
      new Set(
        filasFillRate
          .filter((f) => clavesDuplicadas.has(normalizarClaveFilaFillRate(f.pedido, f.sku)))
          .map((f) => f.pedido),
      ),
    );
    return { ok: false, error: "PEDIDOS_DUPLICADOS", pedidos: pedidosAfectados };
  }

  const resultado = calcularFillRate(filasFillRate);
  return { ok: true, resultado, filasInterpretadas: filasValidadas.slice(0, FILAS_DE_MUESTRA) };
}
