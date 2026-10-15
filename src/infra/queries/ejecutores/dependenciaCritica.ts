// Infraestructura -- I5-03. Carga las ConexionCadena de la cadena (ya
// filtradas por tenant via tenantClient) con sus nodos de origen/destino
// para el nombre, y delega el calculo al motor puro.
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import { ejecutarDependenciaCritica, type ConexionParaDependenciaCritica } from "@/engine/queries/dependenciaCritica";
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { MAX_FILAS_CONSULTA } from "@/domain/limitesConsultas";

export async function cargarYEjecutarDependenciaCritica(
  cliente: TenantPrismaClient,
  cadenaId: string,
): Promise<RespuestaConsulta> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const filas = await (cliente as any).conexionCadena.findMany({
    where: { cadenaId },
    take: MAX_FILAS_CONSULTA,
    select: {
      id: true,
      impactoFalla: true,
      tieneAlternativa: true,
      alternativaProbada: true,
      origenNodo: { select: { nombre: true } },
      destinoNodo: { select: { nombre: true } },
    },
  });

  const conexiones: ConexionParaDependenciaCritica[] = filas.map(
    (f: { id: string; impactoFalla: string | null; tieneAlternativa: boolean | null; alternativaProbada: boolean | null; origenNodo: { nombre: string }; destinoNodo: { nombre: string } }) => ({
      id: f.id,
      origenNombre: f.origenNodo.nombre,
      destinoNombre: f.destinoNodo.nombre,
      impactoFalla: f.impactoFalla as ConexionParaDependenciaCritica["impactoFalla"],
      tieneAlternativa: f.tieneAlternativa,
      alternativaProbada: f.alternativaProbada,
    }),
  );

  return ejecutarDependenciaCritica({ conexiones });
}
