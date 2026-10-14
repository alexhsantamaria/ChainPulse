// Infraestructura -- orquestacion de confirmarObservacionFillRate(): toca
// Prisma (tenantClient + prisma base), a diferencia de declarar.ts
// (puro). Separado en su propio archivo por el mismo motivo que
// persistir.ts/declarar.ts ya estan separados en OTIF: asi
// declarar.test.ts (unitarias, sin DB) puede importar
// previsualizarObservacionFillRate() sin arrastrar la construccion del
// PrismaClient real.
import { EstadoDato } from "@prisma/client";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import {
  previsualizarObservacionFillRate,
  parsearFechaCalendarioEstricta,
  type EntradaDeclaracionFillRate,
  type FalloValidacionFillRate,
} from "./declarar";
import type { ResultadoCalculoKpi } from "@/engine/kpis/constantes";

export interface ContextoConfirmarFillRate {
  empresaId: string;
}

export type ResultadoConfirmarFillRate =
  | { ok: true; resultado: ResultadoCalculoKpi; observacionId: string }
  | ({ ok: false } & FalloValidacionFillRate)
  | { ok: false; error: "CADENA_INEXISTENTE" }
  | { ok: false; error: "DEFINICION_KPI_NO_DISPONIBLE" };

/**
 * Recalcula server-side (nunca confia en un `valor` enviado por el
 * cliente) y hace upsert de la ObservacionKpi por la clave unica ya
 * existente en el schema (@@unique([cadenaId, definicionKpiId,
 * periodoInicio, periodoFin, fuente])) -- confirmar el mismo periodo dos
 * veces actualiza la MISMA fila (idempotencia por diseño del upsert).
 * `ruleVersion` siempre sale de ResultadoCalculoKpi.ruleVersion (el
 * motor, src/engine/kpis/constantes.ts), nunca de un literal en este
 * archivo -- si el motor sube de version, las filas nuevas lo reflejan
 * solas. Mismo patron exacto que confirmarObservacionOtif()
 * (src/infra/kpis/otif/persistir.ts), con `definicionKpi.codigo =
 * "FILL_RATE"` en vez de "OTIF".
 *
 * tenantClient(empresaId) ya envuelve la operacion en una transaccion que
 * fija app.tenant_id (RNF1 capa 1) -- RLS (capa 2) protege ademas del
 * lado de la base. cadenaId se resuelve DENTRO de ese cliente con scope
 * de tenant: una cadena de otra empresa nunca puede dar CADENA_INEXISTENTE
 * distinto de "no existe para este tenant" (no filtra informacion de
 * otros tenants).
 */
export async function confirmarObservacionFillRate(
  entrada: EntradaDeclaracionFillRate,
  contexto: ContextoConfirmarFillRate,
): Promise<ResultadoConfirmarFillRate> {
  const validacion = previsualizarObservacionFillRate(entrada);
  if (!validacion.ok) {
    return validacion;
  }

  const cliente = tenantClient(contexto.empresaId);

  const cadena = await cliente.cadena.findUnique({ where: { id: entrada.cadenaId } });
  if (!cadena) {
    return { ok: false, error: "CADENA_INEXISTENTE" };
  }

  const definicionKpi = await prisma.definicionKpi.findFirst({
    where: { codigo: "FILL_RATE", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });
  if (!definicionKpi) {
    // No deberia pasar (prisma/seedDefinicionesKpi.ts ya publica
    // FILL_RATE, confirmado aplicado contra Neon real) -- mismo criterio
    // que OTIF: fallar con un mensaje claro en vez de un 500 opaco.
    logError("infra/kpis/fillRate/persistir", new Error("DefinicionKpi FILL_RATE no encontrada o no publicada"));
    return { ok: false, error: "DEFINICION_KPI_NO_DISPONIBLE" };
  }

  const fuente = entrada.modo === "manual" ? "manual" : "pegado";
  // Mismo parser ESTRICTO que ya valido estas mismas fechas arriba (via
  // previsualizarObservacionFillRate()) -- nunca un `new Date(string)`
  // directo, mas laxo.
  const periodoInicio = parsearFechaCalendarioEstricta(entrada.periodoInicio);
  const periodoFin = parsearFechaCalendarioEstricta(entrada.periodoFin);
  if (!periodoInicio || !periodoFin) {
    // No deberia pasar -- ya se valido arriba con el mismo parser. Si de
    // todos modos fallara aca seria un error de programacion, no un dato
    // de usuario.
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
