// Tipos compartidos — contratos de los 5 endpoints publicos de la
// evaluacion expres v2 (ver requirements.md y
// src/app/api/public/evaluations/**). Vive en src/lib porque lo consume
// codigo de cliente (paginas "use client"); no importa nada de Prisma ni
// de infra/ para poder correr en el navegador.

export interface OpcionPreguntaPublica {
  valor: string;
  texto: string;
  orden: number;
}

export interface PreguntaPublica {
  codigo: string;
  orden: number;
  texto: string;
  opciones: OpcionPreguntaPublica[];
  esNoPuntuable: boolean;
}

export interface ContextoEvaluacion {
  pais?: string;
  region?: string;
  sector?: string;
  subsector?: string;
  rangoTamano?: string;
  rolParticipante?: string;
  productoServicio: string;
  tipoOperacion: string;
  periodoInicio?: string;
  periodoFin?: string;
}

export type DimensionDiagnosticoV2 =
  | "ALINEACION"
  | "COORDINACION"
  | "INTEGRACION"
  | "EVIDENCIA"
  | "RESILIENCIA";

export type EstadoEvidenciaV2 = "DECLARADO" | "CONFIRMADO_POR_OTROS" | "VERIFICADO_CON_DATOS";

export interface HallazgoMacro {
  dimension: DimensionDiagnosticoV2;
  status: string;
  statement: string;
}

export interface HallazgoDetalle extends HallazgoMacro {
  evidenceState: EstadoEvidenciaV2;
  confidenceCoverage: number;
  missingEvidence: string[];
  nextCheck: string | null;
}

export interface DatosDesbloqueo {
  correo: string;
  nombreCompleto: string;
  empresaNombre: string;
  telefono?: string;
  consentimientoDiagnostico: true;
  consentimientoInvestigacion: boolean;
}
