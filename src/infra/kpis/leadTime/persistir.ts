// Infraestructura -- orquestacion de confirmarObservacionLeadTime(): toca
// Prisma (tenantClient + prisma base), a diferencia de declarar.ts
// (puro). Mismo patron y mismo motivo de separacion que
// src/infra/kpis/otif/persistir.ts (ver su comentario de cabecera).
import { EstadoDato } from "@prisma/client";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import {
  previsualizarObservacionLeadTime,
  parsearFechaCalendarioEstricta,
  type EntradaDeclaracionLeadTime,
  type FalloValidacionLeadTime,
} from "./declarar";
import type { ResultadoCalculoKpi } from "@/engine/kpis/constantes";

export interface ContextoConfirmarLeadTime {
  empresaId: string;
}

export type ResultadoConfirmarLeadTime =
  | { ok: true; resultado: ResultadoCalculoKpi; observacionId: string }
  | ({ ok: false } & FalloValidacionLeadTime)
  | { ok: false; error: "CADENA_INEXISTENTE" }
  | { ok: false; error: "DEFINICION_KPI_NO_DISPONIBLE" };

/**
 * Recalcula server-side (nunca confia en un `valor` enviado por el
 * cliente) y hace upsert de la ObservacionKpi por la clave unica ya
 * existente en el schema (@@unique([cadenaId, definicionKpiId,
 * periodoInicio, periodoFin, fuente])) -- mismo RF-K2 de idempotencia que
 * OTIF: confirmar el mismo periodo dos veces actualiza la MISMA fila.
 * `ruleVersion` siempre sale de ResultadoCalculoKpi.ruleVersion (el
 * motor), nunca de un literal en este archivo.
 *
 * tenantClient(empresaId) ya envuelve la operacion en una transaccion que
 * fija app.tenant_id (RNF1 capa 1) -- RLS (capa 2) protege ademas del
 * lado de la base. cadenaId se resuelve DENTRO de ese cliente con scope
 * de tenant, mismo criterio que confirmarObservacionOtif().
 *
 * Esta funcion persiste exactamente lo que devolvio
 * previsualizarObservacionLeadTime() -- incluida CUALQUIER fila marcada
 * con la advertencia heuristica de posible duplicado (decision
 * 2026-11-27): la advertencia nunca bloquea la confirmacion ni excluye
 * ninguna fila del calculo persistido.
 */
export async function confirmarObservacionLeadTime(
  entrada: EntradaDeclaracionLeadTime,
  contexto: ContextoConfirmarLeadTime,
): Promise<ResultadoConfirmarLeadTime> {
  const validacion = previsualizarObservacionLeadTime(entrada);
  if (!validacion.ok) {
    return validacion;
  }

  const cliente = tenantClient(contexto.empresaId);

  const cadena = await cliente.cadena.findUnique({ where: { id: entrada.cadenaId } });
  if (!cadena) {
    return { ok: false, error: "CADENA_INEXISTENTE" };
  }

  const definicionKpi = await prisma.definicionKpi.findFirst({
    where: { codigo: "LEAD_TIME", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });
  if (!definicionKpi) {
    // prisma/seedDefinicionesKpi.ts ya declara la entrada LEAD_TIME --
    // si todavia no llego a estado PUBLICADA en este entorno, fallar con
    // un mensaje claro en vez de un 500 opaco (mismo criterio que OTIF).
    logError("infra/kpis/leadTime/persistir", new Error("DefinicionKpi LEAD_TIME no encontrada o no publicada"));
    return { ok: false, error: "DEFINICION_KPI_NO_DISPONIBLE" };
  }

  const fuente = entrada.modo === "manual" ? "manual" : "pegado";
  // Mismo parser ESTRICTO que ya valido estas mismas fechas arriba (via
  // previsualizarObservacionLeadTime()) -- nunca un `new Date(string)`
  // directo, mas laxo.
  const periodoInicio = parsearFechaCalendarioEstricta(entrada.periodoInicio);
  const periodoFin = parsearFechaCalendarioEstricta(entrada.periodoFin);
  if (!periodoInicio || !periodoFin) {
    // No deberia pasar -- ya se valido arriba con el mismo parser. Error
    // de programacion, no de usuario; se trata como DATOS_INVALIDOS en
    // vez de persistir con una fecha invalida.
    return { ok: false, error: "DATOS_INVALIDOS" };
  }
  const { resultado } = validacion;

  const datosObservacion = {
    valor: resultado.valor,
    numerador: resultado.numerador,
    denominador: resultado.denominador,
    estado: EstadoDato.DECLARADO,
    ruleVersion: resultado.ruleVersion,
  };

  const observacion = await cliente.observacionKpi.upsert({
    where: {
      cadenaId_definicionKpiId_periodoInicio_periodoFin_fuente: {
        cadenaId: entrada.cadenaId,
        definicionKpiId: definicionKpi.id,
        periodoInicio,
        periodoFin,
        fuente,
      },
    },
    create: {
      empresaId: contexto.empresaId,
      cadenaId: entrada.cadenaId,
      definicionKpiId: definicionKpi.id,
      periodoInicio,
      periodoFin,
      fuente,
      ...datosObservacion,
    },
    update: datosObservacion,
  });

  return { ok: true, resultado, observacionId: observacion.id };
}
