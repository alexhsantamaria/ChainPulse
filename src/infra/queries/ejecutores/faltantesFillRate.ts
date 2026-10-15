// Infraestructura -- I5-04. Carga (si existe) la ObservacionKpi de Fill
// Rate del periodo exacto consultado.
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import { ejecutarFaltantesFillRate } from "@/engine/queries/faltantesFillRate";
import type { RespuestaConsulta } from "@/domain/queries/tipos";

export async function cargarYEjecutarFaltantesFillRate(
  cliente: TenantPrismaClient,
  cadenaId: string,
  periodo: { inicio: Date; fin: Date },
): Promise<RespuestaConsulta> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const definicionKpi = await (cliente as any).definicionKpi.findFirst({
    where: { codigo: "FILL_RATE", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });

  if (!definicionKpi) {
    return ejecutarFaltantesFillRate({ observacionExiste: false, valor: null, ruleVersion: "consultas-v1", periodoConsultado: periodo });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const observacion = await (cliente as any).observacionKpi.findFirst({
    where: { cadenaId, definicionKpiId: definicionKpi.id, periodoInicio: periodo.inicio, periodoFin: periodo.fin },
    orderBy: { createdAt: "desc" },
  });

  return ejecutarFaltantesFillRate({
    observacionExiste: observacion !== null,
    valor: observacion?.valor ?? null,
    ruleVersion: observacion?.ruleVersion ?? "consultas-v1",
    periodoConsultado: periodo,
  });
}
