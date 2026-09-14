// Infraestructura — lee los resultados persistidos de un ciclo (RF7/RF9)
// y deriva la recomendacion priorizada del eslabon mas debil (RF8).
//
// ResultadoCiclo/ResultadoConexion no estan en TENANT_SCOPED_MODELS (ver
// tenantClient.ts) -- se leen con un set_config manual, filtrando ademas
// CicloPulso por empresaId de forma explicita (defensa en profundidad,
// mismo criterio que el resto de infra/, aunque RLS ya lo bloquearia).
//
// La recomendacion de RF8 NO se persiste (ver comentario de
// src/engine/recomendacion.ts) -- se calcula aca, cada vez que se leen
// los resultados, a partir de los valores ya inmutables de
// ResultadoConexion (salud, gradoDependenciaSnapshot,
// criticidadSnapshot.tieneAlternativa).
//
// RF9 (4 valores + tendencia): la criticidad tampoco se persiste como
// columna propia -- ResultadoConexion.criticidadSnapshot ya guarda el
// DatosCriticidad completo tal como estaba al cerrar el ciclo (RNF6), asi
// que se recalcula aca con la misma funcion pura del motor
// (calcularCriticidad), igual criterio que la recomendacion de RF8: si
// las reglas cambian mas adelante, un ciclo ya cerrado mostraria la
// criticidad recalculada con las reglas nuevas, no la que se uso para
// elegir el eslabon mas debil en su momento -- mismo trade-off aceptado,
// documentado una sola vez aca.
//
// RF9 (tendencia) + ruleVersion: la tendencia de salud SOLO encadena
// resultados con el mismo ruleVersion que el resultado actual de esa
// conexion -- si el motor se recalibra (Seccion 12 de requirements.md ya
// lo anticipa como algo esperado, no hipotetico), una version vieja del
// calculo no es directamente comparable con la nueva. Sin este filtro, un
// cambio de reglas se veria como un salto real de salud en el grafico,
// sin ningun aviso. El efecto practico de un cambio de version es que la
// tendencia "se corta" y vuelve a crecer desde cero con la version nueva,
// nunca que mezcla ambas.
import { prisma } from "../prisma/client";
import { generarRecomendacion, type Recomendacion } from "@/engine/recomendacion";
import { calcularCriticidad } from "@/engine/criticidad";
import type { GradoDependencia, DatosCriticidad } from "@/domain/types";

// RF9 -- tendencia de salud: cuantos ciclos anteriores (incluido el
// actual) se muestran por conexion. Recorte de presentacion nada mas,
// no cambia ningun calculo (RNF3: mantiene la consulta chica).
const TENDENCIA_MAX_CICLOS = 5;

export interface ResultadoConexionLeido {
  id: string;
  conexionId: string;
  salud: number;
  criticidad: number;
  riesgo: number;
  gradoDependenciaSnapshot: string;
  origenNombre: string;
  destinoNombre: string;
  /** Solo presente para las conexiones del conjunto de eslabones mas debiles (RF8). */
  recomendacion: Recomendacion | null;
  /** Salud de esta conexion en los ultimos ciclos, orden cronologico ascendente, el actual incluido al final (RF9). */
  tendenciaSalud: number[];
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

    const idsMasDebiles = new Set<string>(resultadoCiclo?.eslabonesMasDebilesIds ?? []);

    // RF9 -- tendencia de salud: una sola consulta para todas las
    // conexiones de este ciclo (no una por conexion), agrupada en JS.
    // Igual criterio de "consulta batch, no N+1" que el resto de infra/.
    const conexionIds = resultadosConexionRaw.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (r: any) => r.conexionId as string,
    );
    const historicoRaw =
      conexionIds.length > 0
        ? await tx.resultadoConexion.findMany({
            where: { conexionId: { in: conexionIds } },
            orderBy: { createdAt: "asc" },
            select: { conexionId: true, salud: true, ruleVersion: true },
          })
        : [];
    interface PuntoHistorico {
      salud: number;
      ruleVersion: string;
    }
    const historicoPorConexion = new Map<string, PuntoHistorico[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    historicoRaw.forEach((r: any) => {
      const lista = historicoPorConexion.get(r.conexionId as string) ?? [];
      lista.push({ salud: r.salud as number, ruleVersion: r.ruleVersion as string });
      historicoPorConexion.set(r.conexionId as string, lista);
    });

    const resultadosConexion: ResultadoConexionLeido[] = resultadosConexionRaw.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (r: any) => {
        const conexionId = r.conexionId as string;
        const gradoDependenciaSnapshot = r.gradoDependenciaSnapshot as GradoDependencia;
        const salud = r.salud as number;
        // criticidadSnapshot es Json (ver prisma/schema.prisma) -- el
        // snapshot completo de DatosCriticidad tal como se guardo al
        // cerrar el ciclo (src/infra/ciclos/cerrarCiclo.ts).
        const datosCriticidad = r.criticidadSnapshot as DatosCriticidad;
        const tieneAlternativa = Boolean(datosCriticidad?.tieneAlternativa);
        const criticidad = calcularCriticidad(datosCriticidad);
        const ruleVersion = r.ruleVersion as string;
        const historico = historicoPorConexion.get(conexionId) ?? [{ salud, ruleVersion }];
        const tendenciaSalud = historico
          .filter((punto) => punto.ruleVersion === ruleVersion)
          .map((punto) => punto.salud)
          .slice(-TENDENCIA_MAX_CICLOS);

        return {
          id: r.id as string,
          conexionId,
          salud,
          criticidad,
          riesgo: r.riesgo as number,
          gradoDependenciaSnapshot,
          origenNombre: r.conexion.origen.nombre as string,
          destinoNombre: r.conexion.destino.nombre as string,
          recomendacion: idsMasDebiles.has(conexionId)
            ? generarRecomendacion({ gradoDependencia: gradoDependenciaSnapshot, salud, tieneAlternativa })
            : null,
          tendenciaSalud,
        };
      },
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
