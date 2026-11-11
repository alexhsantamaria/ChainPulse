// Infraestructura -- historico de ObservacionKpi (OTIF/Fill Rate),
// extraido de DetalleObservacionKpi.tsx (correccion de ronda de
// revision, ver el reporte de entrega, "bloqueantes corregidos", punto
// 1) para que la MISMA consulta (y el mismo limite) sirvan tanto a la
// pagina de detalle (que la usa para construir "Analisis y decision")
// como a derivarOrigenActual.ts (que la necesita para derivar
// `ruleVersionOrigen`/`prioridadOrigen` en el servidor, sin confiar en
// lo que declare el body del POST). Relocacion pura -- mismo codigo,
// mismas consultas, ningun cambio de comportamiento; DetalleObservacionKpi.tsx
// ahora importa esta funcion en vez de definirla localmente.
import type { TenantPrismaClient } from "../prisma/tenantClient";
import type { PuntoObservacionKpi } from "./analisisDecision";

// Tope de periodos anteriores a traer para la tendencia -- mismo
// criterio que LIMITE_FILAS_TABLA en cobertura/importaciones/[id]/
// page.tsx: un numero fijo, documentado, no "todo el historico".
export const LIMITE_HISTORICO_OBSERVACION_KPI = 12;

/** Historico de periodos ANTERIORES al actual, misma cadena+definicionKpi
 * -- orden cronologico ascendente (lo que espera generarAnalisisObservacionKpi()).
 * Se mantiene "ingenua" (deja que el error se propague) -- cada
 * llamador decide su propio try/catch (la pagina para no tirar abajo el
 * resto del detalle; derivarOrigenActual.ts para no esconder un fallo
 * de lectura detras de un rechazo de "sin recomendacion"). */
export async function cargarHistoricoObservacionesKpi(
  client: TenantPrismaClient,
  cadenaId: string,
  definicionKpiId: string,
  periodoInicioActual: Date,
): Promise<PuntoObservacionKpi[]> {
  const historico = await client.observacionKpi.findMany({
    where: { cadenaId, definicionKpiId, periodoInicio: { lt: periodoInicioActual } },
    orderBy: { periodoInicio: "desc" },
    take: LIMITE_HISTORICO_OBSERVACION_KPI,
    select: { id: true, periodoInicio: true, periodoFin: true, valor: true, numerador: true, denominador: true, ruleVersion: true },
  });
  return [...historico].reverse();
}
