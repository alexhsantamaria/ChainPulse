// Infraestructura (PURA -- sin Prisma) -- validacion y calculo
// compartidos por previsualizar y confirmar una ObservacionOtifProveedor,
// Incremento 5 PR3 (Alex, 2026-11-18, correcciones obligatorias sobre el
// diseno original). Mismo criterio de separacion que
// src/infra/kpis/otif/declarar.ts (puro, sin Prisma -- la orquestacion
// que SI toca Prisma vive en persistir.ts, que importa este archivo,
// nunca al reves).
//
// Nivel 1 (modo "manual"): UNA observacion agregada para UN proveedor
// (Alex, punto 9) -- igual que el modo manual de OTIF, sin filas
// individuales.
// Nivel 2 (modo "pegado"): tabla de MULTIPLES filas, que puede mezclar
// VARIOS proveedores en la misma tabla (Alex, punto 10) -- se agrupan por
// proveedorAliasClave (src/domain/proveedorAlias.ts) y se calcula una
// observacion agregada POR GRUPO con calcularOtifProveedor() (motor ya
// construido en el piloto I4-07, hasta ahora sin ningun uso real).
//
// Reutiliza DELIBERADAMENTE parsearFechaCalendarioEstricta() de
// otif/declarar.ts en vez de reimplementar el parseo de fechas
// date-only -- Alex, punto 13 ("sin copiar errores de fechas date-only"):
// la unica forma de no repetir un error ya corregido ahi es no
// reescribir esa logica.
import { calcularOtifProveedor, type FilaOtifProveedor } from "@/engine/kpis/otifProveedor";
import { calcularRatio } from "@/engine/kpis/compartido";
import type { ResultadoCalculoKpi } from "@/engine/kpis/constantes";
import { parsearFechaCalendarioEstricta } from "@/infra/kpis/otif/declarar";
import { MAX_FILAS_PEGADO_OTIF_PROVEEDOR, MAX_LONGITUD_PROVEEDOR_ALIAS } from "@/domain/limitesDeclaracionOtifProveedor";
import { MAX_LONGITUD_PEDIDO } from "@/domain/limitesDeclaracionOtif";
import { normalizarAliasProveedor, compararClavesProveedor, type AliasProveedorNormalizado } from "@/domain/proveedorAlias";

// Mismo rotulo que ObservacionOtifProveedor.fuente en prisma/schema.prisma.
export type ModoDeclaracionOtifProveedor = "manual" | "pegado";

export interface FilaOtifProveedorEntrada {
  proveedorAlias: string;
  pedido: string;
  fechaPromesa: string; // ISO date, AAAA-MM-DD estricto
  fechaRecepcion: string | null; // ISO date, AAAA-MM-DD estricto
  cantidadPedida: number;
  cantidadRecibida: number | null;
}

export type EntradaDeclaracionOtifProveedor =
  | {
      modo: "manual";
      cadenaId: string;
      periodoInicio: string; // ISO date, AAAA-MM-DD estricto
      periodoFin: string; // ISO date, AAAA-MM-DD estricto
      proveedorAlias: string;
      numerador: number;
      denominador: number;
    }
  | {
      modo: "pegado";
      cadenaId: string;
      periodoInicio: string; // ISO date, AAAA-MM-DD estricto
      periodoFin: string; // ISO date, AAAA-MM-DD estricto
      // Payload de RED tal cual llega (JSON.parse) -- nunca validado
      // todavia, mismo criterio que EntradaDeclaracionOtif.filas (otif/
      // declarar.ts, correccion de Alex 2026-10-10): `unknown[]`, nunca
      // tipado como si ya tuviera la forma esperada.
      filas: unknown[];
    };

export type FalloValidacionOtifProveedor =
  | { error: "DATOS_INVALIDOS" }
  | { error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" }
  | { error: "DEMASIADAS_FILAS"; limite: number; recibidas: number }
  | { error: "PEDIDOS_DUPLICADOS"; filas: Array<{ proveedorAlias: string; pedido: string }> }
  | { error: "FILAS_FUERA_DE_PERIODO"; filas: Array<{ proveedorAlias: string; pedido: string }> }
  // Nuevo respecto de OTIF normal (Alex, punto 10: "rechazar alias
  // conflictivos") -- dentro de la MISMA tabla pegada, dos filas cuyo
  // alias normaliza a la misma proveedorAliasClave pero con un `visible`
  // distinto (casing/espacios inconsistentes para "el mismo" proveedor):
  // se rechaza la carga completa en vez de elegir arbitrariamente cual
  // de las dos variantes se persiste.
  | { error: "ALIAS_PROVEEDOR_CONFLICTIVOS"; conflictos: Array<{ proveedorAliasClave: string; variantes: string[] }> };

/** Una observacion ya calculada para UN proveedor -- unidad devuelta por
 * previsualizarObservacionOtifProveedor() tanto en modo manual (siempre 1
 * elemento) como en modo pegado (1 elemento POR proveedor distinto en la
 * tabla, Alex punto 10). persistir.ts itera este arreglo dentro de una
 * sola transaccion (punto 11: confirmacion atomica, todo o nada). */
export interface ObservacionOtifProveedorCalculada {
  proveedorAlias: string; // visible, ya normalizado (recortado + espacios colapsados)
  proveedorAliasClave: string; // canonico, para identidad
  resultado: ResultadoCalculoKpi;
}

export type ResultadoPrevisualizarOtifProveedor =
  | { ok: true; resultados: ObservacionOtifProveedorCalculada[]; filasInterpretadas?: FilaOtifProveedorEntrada[] }
  | ({ ok: false } & FalloValidacionOtifProveedor);

const FILAS_DE_MUESTRA = 10;

function periodoValido(periodoInicio: string, periodoFin: string): { inicio: Date; fin: Date } | null {
  const inicio = parsearFechaCalendarioEstricta(periodoInicio);
  const fin = parsearFechaCalendarioEstricta(periodoFin);
  if (!inicio || !fin) return null;
  if (inicio.getTime() > fin.getTime()) return null;
  return { inicio, fin };
}

// Mismo criterio que normalizarClavePedido (otif/declarar.ts, decision
// C1 de Alex 2026-10-10): SOLO trim, SENSIBLE a mayusculas/minusculas --
// " PED-1 " y "PED-1" son el mismo pedido, "ped-1" y "PED-1" son
// distintos. Deliberadamente DISTINTA de normalizarAliasProveedor()
// (que SI colapsa espacios internos y SI aplica case folding) -- un
// `pedido` es un identificador de negocio externo que el usuario pego
// tal cual, un `proveedorAlias` es el nombre que NOSOTROS usamos para
// agrupar, con reglas de identidad propias.
function normalizarClavePedido(valor: string): string {
  return valor.trim();
}

function esObjetoFilaCandidato(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

interface FilaOtifProveedorValidada {
  proveedorAliasVisible: string;
  proveedorAliasClave: string;
  pedido: string;
  motor: FilaOtifProveedor;
  entrada: FilaOtifProveedorEntrada;
}

/** Misma disciplina que construirFilaOtif() (otif/declarar.ts, Alex
 * 2026-10-10 segunda revision): la fila cruda es `unknown`, cada
 * propiedad se valida por tipo ANTES de leerla, nunca lanza, nunca deja
 * pasar un valor a medio validar. Cualquier forma incorrecta devuelve
 * `null` -- el llamador lo trata como DATOS_INVALIDOS para la carga
 * COMPLETA. */
function construirFilaOtifProveedor(filaCruda: unknown): FilaOtifProveedorValidada | null {
  if (!esObjetoFilaCandidato(filaCruda)) return null;

  if (typeof filaCruda.proveedorAlias !== "string") return null;
  const aliasNormalizado: AliasProveedorNormalizado | null = normalizarAliasProveedor(filaCruda.proveedorAlias);
  if (!aliasNormalizado) return null;
  if (aliasNormalizado.visible.length > MAX_LONGITUD_PROVEEDOR_ALIAS) return null;

  if (typeof filaCruda.pedido !== "string") return null;
  const pedidoOriginal = filaCruda.pedido;
  const pedido = pedidoOriginal.trim();
  if (pedido.length === 0 || pedido.length > MAX_LONGITUD_PEDIDO) return null;

  if (typeof filaCruda.fechaPromesa !== "string") return null;
  const fechaPromesaTexto = filaCruda.fechaPromesa;
  const fechaPromesa = parsearFechaCalendarioEstricta(fechaPromesaTexto);
  if (!fechaPromesa) return null;

  const fechaRecepcionCruda = filaCruda.fechaRecepcion;
  if (fechaRecepcionCruda !== null && typeof fechaRecepcionCruda !== "string") return null;
  let fechaRecepcion: Date | null = null;
  let fechaRecepcionTexto: string | null = null;
  if (fechaRecepcionCruda !== null) {
    fechaRecepcion = parsearFechaCalendarioEstricta(fechaRecepcionCruda);
    if (!fechaRecepcion) return null;
    fechaRecepcionTexto = fechaRecepcionCruda;
  }

  const cantidadPedidaCruda = filaCruda.cantidadPedida;
  if (typeof cantidadPedidaCruda !== "number" || !Number.isFinite(cantidadPedidaCruda) || cantidadPedidaCruda < 0) {
    return null;
  }

  const cantidadRecibidaCruda = filaCruda.cantidadRecibida;
  if (cantidadRecibidaCruda !== null && typeof cantidadRecibidaCruda !== "number") return null;
  let cantidadRecibida: number | null = null;
  if (cantidadRecibidaCruda !== null) {
    if (!Number.isFinite(cantidadRecibidaCruda) || cantidadRecibidaCruda < 0) return null;
    cantidadRecibida = cantidadRecibidaCruda;
  }

  return {
    proveedorAliasVisible: aliasNormalizado.visible,
    proveedorAliasClave: aliasNormalizado.clave,
    pedido,
    motor: {
      proveedorAlias: aliasNormalizado.visible,
      fechaPromesa,
      fechaRecepcion,
      cantidadPedida: cantidadPedidaCruda,
      cantidadRecibida,
    },
    entrada: {
      proveedorAlias: filaCruda.proveedorAlias,
      pedido: pedidoOriginal,
      fechaPromesa: fechaPromesaTexto,
      fechaRecepcion: fechaRecepcionTexto,
      cantidadPedida: cantidadPedidaCruda,
      cantidadRecibida,
    },
  };
}

/**
 * Valida y calcula una o mas observaciones de OTIF Proveedor a partir del
 * payload del cliente -- NUNCA persiste (mismo criterio que
 * previsualizarObservacionOtif()). Reutilizada tal cual por
 * confirmarObservacionOtifProveedor() (persistir.ts) para recalcular
 * server-side antes de guardar -- el servidor SIEMPRE recalcula
 * numerador/denominador/valor, nunca confia en lo que el cliente vio en
 * la previsualizacion (Alex, punto 12).
 */
export function previsualizarObservacionOtifProveedor(
  entrada: EntradaDeclaracionOtifProveedor,
): ResultadoPrevisualizarOtifProveedor {
  if (!entrada.cadenaId) {
    return { ok: false, error: "DATOS_INVALIDOS" };
  }
  const periodo = periodoValido(entrada.periodoInicio, entrada.periodoFin);
  if (!periodo) {
    return { ok: false, error: "DATOS_INVALIDOS" };
  }

  if (entrada.modo === "manual") {
    if (typeof entrada.proveedorAlias !== "string") {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    const alias = normalizarAliasProveedor(entrada.proveedorAlias);
    if (!alias || alias.visible.length > MAX_LONGITUD_PROVEEDOR_ALIAS) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    if (!Number.isFinite(entrada.denominador) || !(entrada.denominador > 0)) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    if (!Number.isFinite(entrada.numerador) || entrada.numerador < 0) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    if (entrada.numerador > entrada.denominador) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }

    const resultado = calcularRatio(
      [{ numerador: entrada.numerador, denominador: entrada.denominador }],
      (fila) => fila,
      "fila manual invalida",
    );
    return {
      ok: true,
      resultados: [{ proveedorAlias: alias.visible, proveedorAliasClave: alias.clave, resultado }],
    };
  }

  // modo "pegado"
  if (!Array.isArray(entrada.filas) || entrada.filas.length === 0) {
    return { ok: false, error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" };
  }

  if (entrada.filas.length > MAX_FILAS_PEGADO_OTIF_PROVEEDOR) {
    return {
      ok: false,
      error: "DEMASIADAS_FILAS",
      limite: MAX_FILAS_PEGADO_OTIF_PROVEEDOR,
      recibidas: entrada.filas.length,
    };
  }

  const filasValidadas: FilaOtifProveedorValidada[] = [];
  for (const filaCruda of entrada.filas) {
    const filaConstruida = construirFilaOtifProveedor(filaCruda);
    if (!filaConstruida) {
      return { ok: false, error: "DATOS_INVALIDOS" };
    }
    filasValidadas.push(filaConstruida);
  }

  // Alias conflictivos (Alex, punto 10): misma proveedorAliasClave, mas
  // de un `visible` distinto dentro de la MISMA tabla pegada.
  const visiblesPorClave = new Map<string, Set<string>>();
  for (const fila of filasValidadas) {
    const set = visiblesPorClave.get(fila.proveedorAliasClave) ?? new Set<string>();
    set.add(fila.proveedorAliasVisible);
    visiblesPorClave.set(fila.proveedorAliasClave, set);
  }
  const conflictos = Array.from(visiblesPorClave.entries())
    .filter(([, variantes]) => variantes.size > 1)
    .map(([proveedorAliasClave, variantes]) => ({ proveedorAliasClave, variantes: Array.from(variantes) }));
  if (conflictos.length > 0) {
    return { ok: false, error: "ALIAS_PROVEEDOR_CONFLICTIVOS", conflictos };
  }

  // Pedidos duplicados -- DENTRO del mismo proveedor (el mismo `pedido`
  // puede coincidir legitimamente entre DOS proveedores distintos, nunca
  // dos veces dentro del mismo proveedor+tabla).
  const clavesVistas = new Map<string, number>();
  for (const fila of filasValidadas) {
    const clave = `${fila.proveedorAliasClave}\u0000${normalizarClavePedido(fila.pedido)}`;
    clavesVistas.set(clave, (clavesVistas.get(clave) ?? 0) + 1);
  }
  const duplicadas = new Set(
    Array.from(clavesVistas.entries())
      .filter(([, veces]) => veces > 1)
      .map(([clave]) => clave),
  );
  if (duplicadas.size > 0) {
    const filasAfectadas = Array.from(
      new Map(
        filasValidadas
          .filter((f) => duplicadas.has(`${f.proveedorAliasClave}\u0000${normalizarClavePedido(f.pedido)}`))
          .map((f) => [`${f.proveedorAliasClave}\u0000${normalizarClavePedido(f.pedido)}`, { proveedorAlias: f.proveedorAliasVisible, pedido: f.entrada.pedido }]),
      ).values(),
    );
    return { ok: false, error: "PEDIDOS_DUPLICADOS", filas: filasAfectadas };
  }

  // Filas fuera de periodo -- limites INCLUSIVOS, mismo criterio A1/B2
  // que OTIF.
  const filasFueraDePeriodo = filasValidadas.filter(
    (f) => f.motor.fechaPromesa.getTime() < periodo.inicio.getTime() || f.motor.fechaPromesa.getTime() > periodo.fin.getTime(),
  );
  if (filasFueraDePeriodo.length > 0) {
    const filasAfectadas = Array.from(
      new Map(filasFueraDePeriodo.map((f) => [`${f.proveedorAliasClave}\u0000${f.pedido}`, { proveedorAlias: f.proveedorAliasVisible, pedido: f.entrada.pedido }])).values(),
    );
    return { ok: false, error: "FILAS_FUERA_DE_PERIODO", filas: filasAfectadas };
  }

  // Agrupar por proveedorAliasClave y calcular UNA observacion agregada
  // por grupo (Alex, punto 10) -- orden de grupos deterministico
  // (ascendente por clave), mismo criterio de no depender del orden de
  // llegada que el motor de ranking (ver engine/queries/otifProveedorRetrasos.ts).
  const grupos = new Map<string, { visible: string; filas: FilaOtifProveedor[] }>();
  for (const fila of filasValidadas) {
    const grupo = grupos.get(fila.proveedorAliasClave) ?? { visible: fila.proveedorAliasVisible, filas: [] };
    grupo.filas.push(fila.motor);
    grupos.set(fila.proveedorAliasClave, grupo);
  }

  const resultados: ObservacionOtifProveedorCalculada[] = Array.from(grupos.entries())
    .sort((a, b) => compararClavesProveedor(a[0], b[0]))
    .map(([proveedorAliasClave, grupo]) => ({
      proveedorAlias: grupo.visible,
      proveedorAliasClave,
      resultado: calcularOtifProveedor(grupo.filas),
    }));

  const filasInterpretadas = filasValidadas.slice(0, FILAS_DE_MUESTRA).map((f) => f.entrada);
  return { ok: true, resultados, filasInterpretadas };
}
