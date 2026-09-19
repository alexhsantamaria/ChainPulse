// Infraestructura publica — persiste los 5 DiagnosticFinding del motor v2
// como HallazgoExpres + HallazgoExpresTraza (RF22, gate macro/detalle:
// esto corre UNA sola vez, desde POST .../complete -- nunca se vuelve a
// llamar para la misma evaluacion, ver la ruta).
//
// Desajuste conocido de tipos (documentado en el Proyecto,
// chainpulse/pendientes-tecnicos-incremento2.md, decision confirmada por
// Alex 2026-09-18): HallazgoExpres.evidenciaFaltante es String? en el
// schema, pero DiagnosticFinding.missingEvidence es string[]. Workaround
// sin migracion: se unen con " | "; cadena vacia -> null. Pendiente real:
// migrar el campo a String[] en Windows y quitar este join.
import type { Prisma } from "@prisma/client";
import type { DiagnosticFinding } from "@/domain/types";

export interface ContextoEvaluacion {
  pais: string;
  region: string | null;
  sector: string | null;
  subsector: string | null;
  rangoTamano: string | null;
  rolParticipante: string | null;
}

/**
 * Unico campo que el pipeline de Investigacion (Incremento 6) lee — solo
 * variables no identificables (comentario de HallazgoExpres en
 * prisma/schema.prisma). Nunca un id de Respuesta aqui, van en
 * HallazgoExpresTraza.
 */
function construirContextoSnapshot(finding: DiagnosticFinding, contexto: ContextoEvaluacion) {
  return {
    dimension: finding.dimension,
    pais: contexto.pais,
    region: contexto.region,
    sector: contexto.sector,
    subsector: contexto.subsector,
    rangoTamano: contexto.rangoTamano,
    rolParticipante: contexto.rolParticipante,
    preguntaCodigos: finding.sourceQuestionIds,
    ruleVersion: finding.ruleVersion,
  };
}

export async function persistirHallazgos(
  tx: Prisma.TransactionClient,
  evaluacionExpresV2Id: string,
  findings: readonly DiagnosticFinding[],
  respuestaIdPorCodigo: Record<string, string>,
  contexto: ContextoEvaluacion,
) {
  const creados = [];
  for (const finding of findings) {
    const hallazgo = await tx.hallazgoExpres.create({
      data: {
        evaluacionExpresV2Id,
        dimension: finding.dimension,
        estadoCategoria: finding.status,
        enunciado: finding.statement,
        estadoEvidencia: finding.evidenceState,
        coberturaConfianza: finding.confidenceCoverage,
        evidenciaFaltante: finding.missingEvidence.length > 0 ? finding.missingEvidence.join(" | ") : null,
        siguienteVerificacion: finding.nextCheck,
        ruleVersion: finding.ruleVersion,
        contextoSnapshot: construirContextoSnapshot(finding, contexto) as unknown as Prisma.InputJsonValue,
      },
    });

    const respuestaIds = finding.sourceQuestionIds
      .map((codigo) => respuestaIdPorCodigo[codigo])
      .filter((id): id is string => id !== undefined);

    await tx.hallazgoExpresTraza.create({
      data: { hallazgoExpresId: hallazgo.id, respuestaIds },
    });

    creados.push(hallazgo);
  }
  return creados;
}
