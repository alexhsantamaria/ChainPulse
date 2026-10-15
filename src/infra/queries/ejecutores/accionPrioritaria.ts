// Infraestructura -- I5-05. Carga los HallazgoCadena vigentes de la
// cadena (todas las filas de hallazgos_cadena son "vigentes" por
// construccion -- persistirHallazgosCadena.ts borra la fila cuando una
// dimension deja de ser DIFERENCIA, ver el comentario del modelo en
// schema.prisma -- asi que no hace falta un filtro adicional de estado).
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import { ejecutarAccionPrioritaria, type HallazgoCadenaParaConsulta } from "@/engine/queries/accionPrioritaria";
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { MAX_FILAS_CONSULTA } from "@/domain/limitesConsultas";

export async function cargarYEjecutarAccionPrioritaria(
  cliente: TenantPrismaClient,
  cadenaId: string,
): Promise<RespuestaConsulta> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const filas = await (cliente as any).hallazgoCadena.findMany({
    where: { cadenaId },
    take: MAX_FILAS_CONSULTA,
    select: { id: true, dimension: true, resultado: true, createdAt: true },
  });

  const hallazgos: HallazgoCadenaParaConsulta[] = filas.map((f: { id: string; dimension: string; resultado: string; createdAt: Date }) => ({
    id: f.id,
    dimension: f.dimension,
    resultado: f.resultado as HallazgoCadenaParaConsulta["resultado"],
    createdAt: f.createdAt,
  }));

  return ejecutarAccionPrioritaria({ hallazgos });
}
