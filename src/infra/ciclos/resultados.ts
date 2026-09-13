// Infraestructura — lee los resultados persistidos de un ciclo (RF7/RF9).
//
// ResultadoCiclo/ResultadoConexion no estan en TENANT_SCOPED_MODELS (ver
// tenantClient.ts) -- se leen con un set_config manual, filtrando ademas
// CicloPulso por empresaId de forma explicita (defensa en profundidad,
// mismo criterio que el resto de infra/, aunque RLS ya lo bloquearia).
import { prisma } from "../prisma/client";

export interface ResultadoConexionLeido {
  id: string;
  conexionId: string;
  salud: number;
  riesgo: number;
  gradoDependenciaSnapshot: string;
  origenNombre: string;
  destinoNombre: string;
}

export interface ResultadosCiclo {
  ciclo: {
    id: string;
    estado: string;
    abiertoEn: Date;
    cerradoEn: Date | null;
    coberturaRespuesta: number | null;
  };
  resultadoCiclo: { indiceIntegracion: number; eslabonesMasDebilesIds: string[] } | null;
  resultadosConexion: ResultadoConexionLeido[];
}

export async function obtenerResultadosCiclo(
  empresaId: string,
  cicloPulsoId: string,
): Promise<ResultadosCiclo | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;

    const ciclo = await tx.cicloPulso.findFirst({ where: { id: cicloPulsoId, empresaId } });
    if (!ciclo) {
      return null;
    }

    const [resultadoCiclo, resultadosConexionRaw] = await Promise.all([
      tx.resultadoCiclo.findUnique({ where: { cicloPulsoId } }),
      tx.resultadoConexion.findMany({
        where: { cicloPulsoId },
        include: { conexion: { include: { origen: true, destino: true } } },
      }),
    ]);

    const resultadosConexion: ResultadoConexionLeido[] = resultadosConexionRaw.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (r: any) => ({
        id: r.id as string,
        conexionId: r.conexionId as string,
        salud: r.salud as number,
        riesgo: r.riesgo as number,
        gradoDependenciaSnapshot: r.gradoDependenciaSnapshot as string,
        origenNombre: r.conexion.origen.nombre as string,
        destinoNombre: r.conexion.destino.nombre as string,
      }),
    );

    return {
      ciclo: {
        id: ciclo.id as string,
        estado: ciclo.estado as string,
        abiertoEn: ciclo.abiertoEn as Date,
        cerradoEn: ciclo.cerradoEn as Date | null,
        coberturaRespuesta: ciclo.coberturaRespuesta as number | null,
      },
      resultadoCiclo: resultadoCiclo
        ? {
            indiceIntegracion: resultadoCiclo.indiceIntegracion as number,
            eslabonesMasDebilesIds: resultadoCiclo.eslabonesMasDebilesIds as string[],
          }
        : null,
      resultadosConexion,
    };
  });
}
