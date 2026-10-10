// Infraestructura (PURA -- sin Prisma) -- validacion y calculo
// compartidos por previsualizar y confirmar una ObservacionKpi de OTIF,
// piloto Incremento 4 Bloque B (Alex, 2026-10-08/09, addendum con las 3
// decisiones resueltas; correcciones de validacion del 2026-10-10 --
// fechas calendario estrictas, numeros finitos, pertenencia al periodo
// por fechaPrometida con limites INCLUSIVOS (decision A1/B2), pedidos
// duplicados tras saneamiento (decision C1), limite de filas).
//
// Nivel 1 (modo "manual"): formulario de UNA observacion agregada --
// numerador/denominador del periodo, sin pasar por filas de pedido
// individuales -- NO tiene filas ni pedidos individuales, asi que
// ninguna de las validaciones de pertenencia al periodo o duplicados de
// mas abajo le aplica (Alex, 2026-10-10). Nivel 2 (modo "pegado"): tabla
// de MULTIPLES filas de pedido, calculada fila a fila con calcularOtif()
// (ya construida y probada, no se reescribe aca).
//
// Deliberadamente SIN import de Prisma/tenantClient (mismo motivo que la
// extraccion de tenantScope.ts desde tenantClient.ts en la Ronda 5: un
// archivo que en su primera linea hace `import ... from "@/infra/prisma/
// client"` arrastra la construccion del singleton real de PrismaClient
// con solo cargar el modulo -- revienta `npm run test` con "PrismaClient
// did not initialize yet" aun si el test nunca toca la base. Las
// funciones de ESTE archivo son puras: reciben solo datos ya tipados, se
// prueban en declarar.test.ts sin ninguna base de datos. La orquestacion
// que SI toca Prisma (confirmar, con upsert real) vive en
// src/infra/kpis/otif/persistir.ts, que importa este archivo, nunca al
// reves.
import { calcularOtif, type FilaOtif } from "@/engine/kpis/otif";
import { calcularRatio } from "@/engine/kpis/compartido";
import type { ResultadoCalculoKpi } from "@/engine/kpis/constantes";
import { MAX_FILAS_PEGADO_OTIF, MAX_LONGITUD_PEDIDO } from "@/domain/limitesDeclaracionOtif";

// Mismo rotulo que ya declara el campo `fuente` de ObservacionKpi en
// prisma/schema.prisma ("manual" | "pegado" | "csv" -- CSV queda fuera
// del piloto, Alex 2026-10-08).
export type ModoDeclaracionOtif = "manual" | "pegado";

export interface FilaOtifEntrada {
  pedido: string;
  fechaPrometida: string; // ISO date, AAAA-MM-DD estricto
  fechaReal: string | null; // ISO date, AAAA-MM-DD estricto
  cantidadPedida: number;
  cantidadEntregada: number | null;
}

export type EntradaDeclaracionOtif =
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
      // CORREGIDO 2026-10-10 (Alex): `unknown[]`, no `FilaOtifEntrada[]` --
      // esto es el payload de RED tal cual llega (JSON.parse), nunca
      // validado todavia. Tiparlo como FilaOtifEntrada[] aca era una
      // mentira de tipos que obligaba a las rutas a hacer `p.filas as any`
      // para "calzarlo", y dejaba a construirFilaOtif() confiando en una
      // forma que nadie habia verificado -- cualquier fila que no fuera un
      // objeto (null, un numero, un string, un array) podia lanzar una
      // excepcion no controlada en vez de devolver DATOS_INVALIDOS.
      // construirFilaOtif() (mas abajo) es ahora el UNICO lugar que valida
      // la forma real de cada fila, elemento por elemento, antes de leer
      // ninguna propiedad.
      filas: unknown[];
    };

// Fallos de validacion con detalle estructurado -- las rutas
// (previsualizar/confirmar) devuelven este objeto tal cual al cliente
// (ver sus comentarios de cabecera), para que la UI pueda identificar las
// filas afectadas (siempre por `pedido`, nunca con datos sensibles --
// ninguna fecha/cantidad individual viaja en el error) y explicar el
// problema sin adivinar. `error` sigue siendo siempre un string, asi que
// el llamador que solo necesita el codigo (`resultado.error`) sigue
// funcionando sin cambios.
export type FalloValidacionOtif =
  | { error: "DATOS_INVALIDOS" }
  | { error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" }
  | { error: "DEMASIADAS_FILAS"; limite: number; recibidas: number }
  | { error: "PEDIDOS_DUPLICADOS"; pedidos: string[] }
  | { error: "FILAS_FUERA_DE_PERIODO"; pedidos: string[] };

export type ResultadoPrevisualizarOtif =
  | { ok: true; resultado: ResultadoCalculoKpi; filasInterpretadas?: FilaOtifEntrada[] }
  | ({ ok: false } & FalloValidacionOtif);

// Muestra de filas interpretadas devuelta en la previsualizacion del modo
// "pegado" -- mismo criterio que FILAS_DE_MUESTRA en la ruta de subida de
// Cobertura: nunca el array completo, solo para que la UI confirme "asi
// se va a interpretar tu tabla" antes de confirmar.
const FILAS_DE_MUESTRA = 10;

const FORMATO_FECHA_ESTRICTO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parsea una fecha calendario AAAA-MM-DD ESTRICTA -- nunca acepta otro
 * formato (con hora, con `/`, con espacios, etc.) y nunca deja que
 * `Date` normalice en silencio una fecha que no existe (ej.
 * "2026-02-30" -> 2 de marzo): valida que los componentes anio/mes/dia
 * que pide coincidan EXACTAMENTE con los que `Date.UTC` devuelve de
 * vuelta (Alex, 2026-10-10 -- "rechazar fechas normalizadas en
 * silencio"). Ancla a UTC (nunca a la hora local del proceso) para que
 * la comparacion de pertenencia al periodo (A1/B2 mas abajo) sea estable
 * sin depender de la zona horaria del servidor. Exportada para que
 * persistir.ts parsee exactamente las mismas fechas de periodo con el
 * mismo criterio al persistir (nunca con un `new Date(string)` directo,
 * mas laxo).
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
 * CORREGIDO 2026-10-10 (Alex): la decision aprobada para pedidos OTIF es
 * SOLO trim, SENSIBLE a mayusculas/minusculas -- la regla de
 * normalizarClaveNegocio (interpretarFilaCoberturaCsv.ts, 2026-09-24,
 * SKU/ubicacion de Cobertura: trim + mayusculas) NO se traslada
 * automaticamente a este identificador distinto, sin una decision
 * funcional propia que declare los pedidos OTIF case-insensitive. Por
 * eso " PED-1 " y "PED-1" SI son el mismo pedido (solo difieren en
 * espacios de pegado), pero "ped-1" y "PED-1" son pedidos DISTINTOS --
 * nunca se fuerza a mayusculas aca. Usada SOLO como clave de comparacion
 * (decision C1, mas abajo) -- el `pedido` guardado/mostrado de cada fila
 * (ver construirFilaOtif) ya es ese mismo valor recortado, sin ninguna
 * transformacion adicional.
 */
function normalizarClavePedido(valor: string): string {
  return valor.trim();
}

// Resultado de validar UNA fila de red (unknown) contra la forma que
// necesitan, respectivamente, el motor de calculo (fechas Date, pedido ya
// recortado) y la UI de previsualizacion (strings tal cual los mando el
// cliente, para mostrar "asi interpretamos tu fila" -- ver
// `filasInterpretadas` en previsualizarObservacionOtif).
interface FilaOtifValidada {
  motor: FilaOtif;
  entrada: FilaOtifEntrada;
}

// Objeto simple (nunca null, nunca un array) -- el unico shape donde tiene
// sentido buscar las propiedades de una fila. Devuelve `false` para
// cualquier otra cosa (null, numero, string, boolean, array, undefined)
// sin arriesgar una excepcion al acceder a una propiedad despues.
function esObjetoFilaCandidato(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * CORREGIDO 2026-10-10 (Alex, segunda revision): recibe la fila como
 * `unknown` -- nunca se asume que el payload de red ya tiene la forma de
 * FilaOtifEntrada (ese cast vivia antes en las rutas via `as any`, un
 * `any` que no tenia nada que ver con Prisma y que dejaba a esta funcion
 * confiando ciegamente en datos de un cliente HTTP). Cada propiedad se
 * valida por tipo ANTES de usarla; una fila con forma incorrecta (no es un
 * objeto, es null, es un array, le falta un campo, un campo tiene el tipo
 * equivocado) devuelve null -- nunca lanza, nunca deja pasar un valor a
 * medio validar. previsualizarObservacionOtif() trata cualquier null de
 * aca como DATOS_INVALIDOS, igual que antes.
 */
function construirFilaOtif(filaCruda: unknown): FilaOtifValidada | null {
  if (!esObjetoFilaCandidato(filaCruda)) return null;

  if (typeof filaCruda.pedido !== "string") return null;
  const pedidoOriginal = filaCruda.pedido;
  const pedido = pedidoOriginal.trim();
  if (pedido.length === 0 || pedido.length > MAX_LONGITUD_PEDIDO) return null;

  if (typeof filaCruda.fechaPrometida !== "string") return null;
  const fechaPrometidaTexto = filaCruda.fechaPrometida;
  const fechaPrometida = parsearFechaCalendarioEstricta(fechaPrometidaTexto);
  if (!fechaPrometida) return null;

  // `fechaReal` es nullable PERO, si esta presente, tiene que ser un
  // string -- un campo ausente (undefined, propiedad faltante en el JSON)
  // NO se trata como "equivalente a null": es una fila con forma invalida
  // y rechaza la carga completa como DATOS_INVALIDOS (distinto del caso ya
  // cubierto por calcularOtif(), donde el cliente SI manda `fechaReal:
  // null` explicito para un pedido todavia no cerrado).
  const fechaRealCruda = filaCruda.fechaReal;
  if (fechaRealCruda !== null && typeof fechaRealCruda !== "string") return null;
  let fechaReal: Date | null = null;
  let fechaRealTexto: string | null = null;
  if (fechaRealCruda !== null) {
    fechaReal = parsearFechaCalendarioEstricta(fechaRealCruda);
    if (!fechaReal) return null;
    fechaRealTexto = fechaRealCruda;
  }

  // Numeros finitos (nunca NaN/Infinity -- Alex, 2026-10-10) Y dominio de
  // negocio: una cantidad negativa no es un "pedido sin cerrar todavia"
  // (eso ya lo excluye calcularOtif() con cantidadPedida<=0, sin tocar
  // ese archivo -- motor ya construido y probado), es un dato corrupto
  // que nunca deberia llegar al motor. cantidadEntregada > cantidadPedida
  // (sobre-entrega) SI es valida -- calcularOtif() ya la trata como
  // "completo", criterio de negocio existente, no se restringe aca.
  const cantidadPedidaCruda = filaCruda.cantidadPedida;
  if (typeof cantidadPedidaCruda !== "number" || !Number.isFinite(cantidadPedidaCruda) || cantidadPedidaCruda < 0) {
    return null;
  }

  // Mismo criterio que fechaReal: `cantidadEntregada` ausente (undefined)
  // no es "equivalente a null", es forma invalida -> DATOS_INVALIDOS.
  const cantidadEntregadaCruda = filaCruda.cantidadEntregada;
  if (cantidadEntregadaCruda !== null && typeof cantidadEntregadaCruda !== "number") return null;
  let cantidadEntregada: number | null = null;
  if (cantidadEntregadaCruda !== null) {
    if (!Number.isFinite(cantidadEntregadaCruda) || cantidadEntregadaCruda < 0) return null;
    cantidadEntregada = cantidadEntregadaCruda;
  }

  return {
    motor: { pedido, fechaPrometida, fechaReal, cantidadPedida: cantidadPedidaCruda, cantidadEntregada },
    entrada: {
      pedido: pedidoOriginal,
      fechaPrometida: fechaPrometidaTexto,
      fechaReal: fechaRealTexto,
      cantidadPedida: cantidadPedidaCruda,
      cantidadEntregada,
    },
  };
}

/**
 * Valida y calcula una observacion OTIF a partir del payload del cliente
 * -- NUNCA persiste (RF del addendum, Seccion 4: "previsualizar nunca
 * escribe en la base"). Reutilizada tal cual por confirmarObservacionOtif()
 * (persistir.ts) para recalcular server-side antes de guardar: el numero
 * que termina persistido siempre paso por esta misma funcion en esa misma
 * peticion, nunca se acepta un `valor` enviado por el cliente.
 *
 * Manual: un dato invalido (denominador<=0, numerador<0,
 * numerador>denominador, cualquiera de los dos no finito) rechaza la
 * peticion completa (DATOS_INVALIDOS) -- a diferencia del pegado, aca es
 * la unica observacion, no hay "fila que excluir". numerador==denominador
 * es valido (OTIF 100%). El modo manual NO tiene filas/pedidos
 * individuales, asi que ninguna de las validaciones de pertenencia al
 * periodo o duplicados de abajo le aplica (Alex, 2026-10-10).
 *
 * Pegado: calcularOtif() decide fila por fila que se excluye por datos de
 * negocio incompletos (RF-K3, ej. sin fechaReal todavia) -- esa fila
 * nunca hace fallar la peticion completa, solo se refleja en
 * advertencias/cobertura del resultado. En cambio, CUALQUIERA de estos
 * problemas rechaza la carga COMPLETA, sin excluir silenciosamente ni
 * calcular un resultado parcial (decisiones de Alex, 2026-10-10 -- a
 * diferencia de un dato de negocio incompleto, son indicios de que la
 * tabla pegada no es la correcta para este periodo/cadena):
 *   1. Formato ilegible en cualquier fila (fecha no AAAA-MM-DD valida,
 *      numero no finito o negativo, `pedido` vacio o demasiado largo) --
 *      igual que siempre, DATOS_INVALIDOS.
 *   2. Mas de MAX_FILAS_PEGADO_OTIF filas -- DEMASIADAS_FILAS.
 *   3. Un `pedido` repetido dentro del mismo payload, DESPUES de aplicar
 *      el saneamiento aprobado -- SOLO trim, SENSIBLE a mayusculas/
 *      minusculas (decision C1, 2026-10-10: " PED-1 " y "PED-1" son el
 *      mismo pedido, "ped-1" y "PED-1" son distintos) -- nunca se
 *      consolidan cantidades ni se conserva silenciosamente la primera o
 *      la ultima aparicion -- PEDIDOS_DUPLICADOS, identificando los
 *      pedidos afectados.
 *   4. Una fila cuya `fechaPrometida` cae fuera de [periodoInicio,
 *      periodoFin] -- limites INCLUSIVOS (decision A1/B2) --
 *      FILAS_FUERA_DE_PERIODO, identificando los pedidos afectados.
 * Ninguno de los dos errores de arriba incluye datos sensibles: solo el
 * `pedido` (identificador de negocio que el propio usuario pego), nunca
 * fechas ni cantidades individuales.
 */
export function previsualizarObservacionOtif(entrada: EntradaDeclaracionOtif): ResultadoPrevisualizarOtif {
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
    // entregas a tiempo que pedidos totales del periodo (Alex 2026-10-10,
    // correccion sobre la validacion inicial que solo chequeaba
    // denominador>0 y numerador>=0).
    if (entrada.numerador > entrada.denominador) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }

    // Una sola fila sintetica {numerador, denominador}, ya validada
    // arriba -- reutiliza calcularRatio() (cobertura/advertencias/
    // ruleVersion del motor) en vez de construir el ResultadoCalculoKpi a
    // mano para este caso agregado.
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

  if (entrada.filas.length > MAX_FILAS_PEGADO_OTIF) {
    return { ok: false, error: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_OTIF, recibidas: entrada.filas.length };
  }

  const filasOtif: FilaOtif[] = [];
  const filasValidadas: FilaOtifEntrada[] = [];
  for (const filaCruda of entrada.filas) {
    const filaConstruida = construirFilaOtif(filaCruda);
    if (!filaConstruida) {
      // Fecha/numero/pedido ilegible, o la fila ni siquiera tiene la forma
      // de un objeto (null, un numero, un string, un array -- ver
      // esObjetoFilaCandidato) -- esto es un error de FORMATO del payload
      // (no un dato de negocio incompleto, que calcularOtif() ya sabe
      // excluir solo): rechaza la peticion completa, mismo criterio que
      // "DATOS_INVALIDOS" del modo manual. NUNCA lanza una excepcion.
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    filasOtif.push(filaConstruida.motor);
    filasValidadas.push(filaConstruida.entrada);
  }

  // C1: pedido duplicado (tras saneamiento -- SOLO trim, sensible a
  // mayusculas/minusculas, Alex 2026-10-10) rechaza TODA la carga.
  const clavesVistas = new Map<string, number>();
  for (const fila of filasOtif) {
    const clave = normalizarClavePedido(fila.pedido);
    clavesVistas.set(clave, (clavesVistas.get(clave) ?? 0) + 1);
  }
  const clavesDuplicadas = new Set(
    Array.from(clavesVistas.entries())
      .filter(([, veces]) => veces > 1)
      .map(([clave]) => clave),
  );
  if (clavesDuplicadas.size > 0) {
    const pedidosAfectados = Array.from(
      new Set(filasOtif.filter((f) => clavesDuplicadas.has(normalizarClavePedido(f.pedido))).map((f) => f.pedido)),
    );
    return { ok: false, error: "PEDIDOS_DUPLICADOS", pedidos: pedidosAfectados };
  }

  // A1/B2: fechaPrometida fuera de [periodoInicio, periodoFin] (limites
  // INCLUSIVOS) rechaza TODA la carga.
  const pedidosFueraDePeriodo = Array.from(
    new Set(
      filasOtif
        .filter((f) => f.fechaPrometida.getTime() < periodo.inicio.getTime() || f.fechaPrometida.getTime() > periodo.fin.getTime())
        .map((f) => f.pedido),
    ),
  );
  if (pedidosFueraDePeriodo.length > 0) {
    return { ok: false, error: "FILAS_FUERA_DE_PERIODO", pedidos: pedidosFueraDePeriodo };
  }

  const resultado = calcularOtif(filasOtif);
  // Usa las filas YA VALIDADAS (filasValidadas), nunca entrada.filas
  // directo -- ahora que entrada.filas es unknown[], el array crudo no
  // tiene garantizada la forma de FilaOtifEntrada que esta muestra le
  // promete a la UI.
  return { ok: true, resultado, filasInterpretadas: filasValidadas.slice(0, FILAS_DE_MUESTRA) };
}
