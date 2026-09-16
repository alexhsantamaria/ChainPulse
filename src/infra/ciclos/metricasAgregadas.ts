// Infraestructura — lee las metricas minimas de RNF9 para un tenant:
// duracion de cuestionario (RF6/RNF2) y recomendaciones (RF8) marcadas
// como ejecutadas. No es un sistema de analitica de producto completo
// (Seccion 12 de requirements.md) -- son las dos consultas agregadas
// simples que RNF9 pide, nada mas.
import { tenantTransaction } from "../prisma/tenantTransaction";
import { calcularMetricasCuestionario, type MetricasCuestionario } from "./metricasCuestionario";

export interface MetricasAgregadas {
  cuestionario: MetricasCuestionario;
  recomendaciones: {
    /** Cuantas veces una conexion entro al conjunto de eslabones mas debiles (RF7) en algun ciclo cerrado -- una misma conexion puede contarse varias veces si fue "mas debil" en mas de un ciclo. */
    totalIdentificadas: number;
    totalEjecutadas: number;
  };
}

export async function obtenerMetricasAgregadas(empresaId: string): Promise<MetricasAgregadas> {
  // R5-11 -- helper estandar en vez de set_config manual (ver registro.ts).
  return tenantTransaction(empresaId, async (tx) => {
    const [metricasRaw, resultadosCiclo, totalEjecutadas] = await Promise.all([
      tx.metricaCuestionario.findMany({ select: { duracionSegundos: true } }),
      tx.resultadoCiclo.findMany({ select: { eslabonesMasDebilesIds: true } }),
      tx.recomendacionEjecutada.count(),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    const duraciones = metricasRaw.map((m: any) => m.duracionSegundos as number);
    const totalIdentificadas = resultadosCiclo.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      (acumulado: number, r: any) => acumulado + (r.eslabonesMasDebilesIds as string[]).length,
      0,
    );

    return {
      cuestionario: calcularMetricasCuestionario(duraciones),
      recomendaciones: { totalIdentificadas, totalEjecutadas: totalEjecutadas as number },
    };
  });
}
