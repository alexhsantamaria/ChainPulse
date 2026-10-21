// Infraestructura -- carga de datos (Prisma, tenant-scoped) para I5-01.
// PURO de logica de negocio (eso vive en engine/queries/otifCaida.ts);
// este archivo SOLO sabe como conseguir las dos ObservacionKpi de OTIF
// que el motor necesita, vía tenantClient() (RNF1 capa 1 + capa 2).
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import { ejecutarOtifCaida, type ObservacionOtifParaConsulta } from "@/engine/queries/otifCaida";
import type { RespuestaConsulta } from "@/domain/queries/tipos";

async function obtenerDefinicionKpiOtif(cliente: TenantPrismaClient) {
  // DefinicionKpi es catalogo de plataforma sin empresaId (fuera de
  // TENANT_SCOPED_MODELS) -- se consulta con el cliente normal, mismo
  // criterio que persistir.ts de OTIF (declaracion), via $parent para no
  // requerir un segundo import de `prisma` aca.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  return (cliente as any).definicionKpi.findFirst({
    where: { codigo: "OTIF", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });
}

function aObservacion(fila: {
  valor: number | null;
  numerador: number | null;
  denominador: number | null;
  periodoInicio: Date;
  periodoFin: Date;
  ruleVersion: string;
} | null): ObservacionOtifParaConsulta | null {
  if (!fila) return null;
  return {
    valor: fila.valor,
    numerador: fila.numerador,
    denominador: fila.denominador,
    periodoInicio: fila.periodoInicio,
    periodoFin: fila.periodoFin,
    ruleVersion: fila.ruleVersion,
  };
}

/**
 * I5-01 -- carga la observacion OTIF del periodo exacto consultado y la
 * observacion OTIF mas reciente cuyo periodoFin sea anterior al inicio
 * del periodo consultado (definicion explicita de "periodo anterior":
 * la ultima declarada antes del periodo consultado, sin asumir que las
 * cadenas declaran periodos contiguos sin huecos).
 */
export async function cargarYEjecutarOtifCaida(
  cliente: TenantPrismaClient,
  cadenaId: string,
  periodo: { inicio: Date; fin: Date },
): Promise<RespuestaConsulta> {
  const definicionKpi = await obtenerDefinicionKpiOtif(cliente);
  if (!definicionKpi) {
    return {
      ok: false,
      catalogoId: "OTIF_CAIDA",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: "No puedo responder todavía: el catálogo de KPIs no tiene publicada la definición de OTIF.",
      camposFaltantes: ["definición de KPI OTIF publicada"],
      comoIngresarlos: "Contacta al administrador de la plataforma -- esto no debería ocurrir en un entorno ya sembrado.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const actualFila = await (cliente as any).observacionKpi.findFirst({
    where: { cadenaId, definicionKpiId: definicionKpi.id, periodoInicio: periodo.inicio, periodoFin: periodo.fin },
    orderBy: { createdAt: "desc" },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const anteriorFila = await (cliente as any).observacionKpi.findFirst({
    where: { cadenaId, definicionKpiId: definicionKpi.id, periodoFin: { lt: periodo.inicio } },
    orderBy: { periodoFin: "desc" },
  });

  return ejecutarOtifCaida({
    actual: aObservacion(actualFila),
    anterior: aObservacion(anteriorFila),
    periodoConsultado: periodo,
  });
}
