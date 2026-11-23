// Infraestructura (PURA -- sin Prisma) -- adapta un PuntoObservacionKpi
// (OTIF/Fill Rate) al contrato normalizado PuntoHistoricoKpi. Segundo
// corte de PR-A, ver diseno-pr-a-segundo-corte-contrato-historico-2026-11-23.md.
//
// NO reemplaza generarAnalisisObservacionKpi() -- esta función es
// puramente de RESHAPING de tipo, para quien necesite leer histórico de
// forma genérica (p.ej. un futuro componente de evolución reciente
// compartido); la recomendación/prioridad real de OTIF/Fill Rate sigue
// viniendo exclusivamente de analisisDecision.ts, sin ningún cambio.
import { clasificarValorObservacionKpi } from "../estadoVisualizacion";
import type { PuntoObservacionKpi } from "../analisisDecision";
import type { PuntoHistoricoKpi } from "./contrato";

export function adaptarPuntoObservacionKpi(punto: PuntoObservacionKpi): PuntoHistoricoKpi {
  return {
    id: punto.id,
    periodoInicio: punto.periodoInicio,
    periodoFin: punto.periodoFin,
    valor: punto.valor,
    // Misma clasificación canónica que ya usa la UI para este mismo
    // valor (estadoVisualizacion.ts) -- reutilizada, nunca reimplementada.
    estado: clasificarValorObservacionKpi(punto.valor),
    fuente: "OBSERVACION_KPI",
    ruleVersion: punto.ruleVersion,
  };
}
