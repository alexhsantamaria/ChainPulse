// Infraestructura -- I5-06. "El corte" es periodo.inicio de la consulta
// (ver la nota de cabecera de engine/queries/cambiosUltimoPulso.ts: no
// existe un concepto formal de "ciclo" para Cadena).
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import { ejecutarCambiosUltimoPulso, type HallazgoCadenaParaCambios } from "@/engine/queries/cambiosUltimoPulso";
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { MAX_FILAS_CONSULTA } from "@/domain/limitesConsultas";

export async function cargarYEjecutarCambiosUltimoPulso(
  cliente: TenantPrismaClient,
  cadenaId: string,
  corte: Date,
): Promise<RespuestaConsulta> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const filasAntes = await (cliente as any).hallazgoCadena.findMany({
    where: { cadenaId, createdAt: { lt: corte } },
    take: MAX_FILAS_CONSULTA,
    select: { id: true, dimension: true, resultado: true, createdAt: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const filasDesde = await (cliente as any).hallazgoCadena.findMany({
    where: { cadenaId, createdAt: { gte: corte } },
    take: MAX_FILAS_CONSULTA,
    select: { id: true, dimension: true, resultado: true, createdAt: true },
  });

  const aTipo = (f: { id: string; dimension: string; resultado: string; createdAt: Date }): HallazgoCadenaParaCambios => ({
    id: f.id,
    dimension: f.dimension,
    resultado: f.resultado,
    createdAt: f.createdAt,
  });

  return ejecutarCambiosUltimoPulso({
    antesDelCorte: filasAntes.map(aTipo),
    desdeElCorte: filasDesde.map(aTipo),
    corte,
  });
}
