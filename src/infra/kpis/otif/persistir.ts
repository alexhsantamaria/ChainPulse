// Infraestructura -- orquestacion de confirmarObservacionOtif(): toca
// Prisma (tenantClient + prisma base), a diferencia de declarar.ts
// (puro). Separado en su propio archivo por el mismo motivo que
// tenantScope.ts se separo de tenantClient.ts (ver el comentario de
// cabecera de declarar.ts) -- asi declarar.test.ts (unitarias, sin DB)
// puede importar previsualizarObservacionOtif() sin arrastrar la
// construccion del PrismaClient real.
import { EstadoDato } from "@prisma/client";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import { previsualizarObservacionOtif, parsearFechaCalendarioEstricta, type EntradaDeclaracionOtif, type FalloValidacionOtif } from "./declarar";
import type { ResultadoCalculoKpi } from "@/engine/kpis/constantes";

export interface ContextoConfirmarOtif {
  empresaId: string;
}

export type ResultadoConfirmarOtif =
  | { ok: true; resultado: ResultadoCalculoKpi; observacionId: string }
  | ({ ok: false } & FalloValidacionOtif)
  | { ok: false; error: "CADENA_INEXISTENTE" }
  | { ok: false; error: "DEFINICION_KPI_NO_DISPONIBLE" };

/**
 * Recalcula server-side (nunca confia en un `valor` enviado por el
 * cliente -- addendum Seccion 4) y hace upsert de la ObservacionKpi por
 * la clave unica ya existente en el schema
 * (@@unique([cadenaId, definicionKpiId, periodoInicio, periodoFin,
 * fuente])) -- RF-K2: confirmar el mismo periodo dos veces actualiza la
 * MISMA fila (idempotencia por diseño del upsert, no por una
 * verificacion manual aparte). `ruleVersion` siempre sale de
 * ResultadoCalculoKpi.ruleVersion (el motor, src/engine/kpis/constantes.ts),
 * nunca de un literal en este archivo -- si el motor sube de version, las
 * filas nuevas lo reflejan solas sin tocar este codigo.
 *
 * tenantClient(empresaId) ya envuelve la operacion en una transaccion que
 * fija app.tenant_id (RNF1 capa 1) -- RLS (capa 2) protege ademas del
 * lado de la base. cadenaId se resuelve DENTRO de ese cliente con scope
 * de tenant: una cadena de otra empresa nunca puede dar CADENA_INEXISTENTE
 * distinto de "no existe para este tenant" (no filtra informacion de
 * otros tenants).
 */
export async function confirmarObservacionOtif(
  entrada: EntradaDeclaracionOtif,
  contexto: ContextoConfirmarOtif,
): Promise<ResultadoConfirmarOtif> {
  const validacion = previsualizarObservacionOtif(entrada);
  if (!validacion.ok) {
    // Devuelve el objeto de fallo COMPLETO (no solo `.error`) -- puede
    // traer detalle estructurado (ej. `pedidos` de PEDIDOS_DUPLICADOS/
    // FILAS_FUERA_DE_PERIODO, o `limite`/`recibidas` de DEMASIADAS_FILAS,
    // Alex 2026-10-10) que la ruta de confirmar debe poder reenviar tal
    // cual al cliente, igual que ya hace previsualizar/route.ts.
    return validacion;
  }

  const cliente = tenantClient(contexto.empresaId);

  const cadena = await cliente.cadena.findUnique({ where: { id: entrada.cadenaId } });
  if (!cadena) {
    return { ok: false, error: "CADENA_INEXISTENTE" };
  }

  const definicionKpi = await prisma.definicionKpi.findFirst({
    where: { codigo: "OTIF", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });
  if (!definicionKpi) {
    // No deberia pasar (prisma/seedDefinicionesKpi.ts ya publica OTIF) --
    // mismo criterio que la ruta de subida de Cobertura: fallar con un
    // mensaje claro en vez de un 500 opaco.
    logError("infra/kpis/otif/persistir", new Error("DefinicionKpi OTIF no encontrada o no publicada"));
    return { ok: false, error: "DEFINICION_KPI_NO_DISPONIBLE" };
  }

  const fuente = entrada.modo === "manual" ? "manual" : "pegado";
  // Mismo parser ESTRICTO que ya valido estas mismas fechas arriba (via
  // previsualizarObservacionOtif()) -- nunca un `new Date(string)`
  // directo, mas laxo, que podria interpretar un formato distinto al que
  // ya se valido (Alex 2026-10-10).
  const periodoInicio = parsearFechaCalendarioEstricta(entrada.periodoInicio);
  const periodoFin = parsearFechaCalendarioEstricta(entrada.periodoFin);
  if (!periodoInicio || !periodoFin) {
    // No deberia pasar -- ya se valido arriba con el mismo parser. Si de
    // todos modos fallara aca seria un error de programacion (ambos
    // deberian estar siempre en sincronia), no un dato de usuario; se
    // trata como DATOS_INVALIDOS en vez de persistir con una fecha
    // invalida.
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
