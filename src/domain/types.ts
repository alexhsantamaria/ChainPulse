// Tipos de dominio puros — sin Prisma, sin Next (ADR-0002, punto 1: motor
// como funcion pura en engine/, con domain/ como su vocabulario). Estos
// tipos son el limite entre el motor y la infraestructura: infra/ mapea
// desde/hacia los modelos de Prisma; engine/ nunca importa @prisma/client.

export type GradoDependencia = "BAJA" | "MEDIA" | "ALTA" | "CRITICA";
export type DuracionCategorica = "CORTO" | "MEDIO" | "LARGO";
export type NivelImpacto = "BAJO" | "MEDIO" | "ALTO" | "CRITICO";
export type EstadoDato = "DECLARADO" | "INFERIDO" | "VERIFICADO";
export type DimensionDiagnostico = "SALUD" | "CRITICIDAD" | "DEPENDENCIA" | "RIESGO";

// RF6 — una respuesta cruda de cuestionario para una conexion.
export interface RespuestaLikert {
  valor: number | null; // 1-5; null si noSabe o noAplica
  noSabe: boolean;
  noAplica: boolean;
}

// RF3 — los datos estaticos de criticidad/dependencia de una conexion,
// confirmados una sola vez (no en cada ciclo).
export interface DatosCriticidad {
  gradoDependencia: GradoDependencia;
  impactoPromesaCliente: NivelImpacto;
  tieneAlternativa: boolean;
  tiempoTolerable: DuracionCategorica;
  tiempoRecuperacion: DuracionCategorica;
}

// Entrada de una conexion completa (RF3) para un ciclo: sus datos
// estaticos mas las respuestas crudas de este ciclo y el historial de
// salud de ciclos anteriores (para el calculo de riesgo).
export interface ConexionParaCiclo {
  conexionId: string;
  datosCriticidad: DatosCriticidad;
  respuestas: RespuestaLikert[];
  /** Salud (0-100) de ciclos anteriores, mas antiguo primero. No incluye el ciclo actual. */
  historicoSalud: number[];
}

// RF6 — resultado del calculo de salud de una conexion en un ciclo.
export interface ResultadoSalud {
  /** 0-100, o null si no hay ninguna respuesta valida (todas noSabe/noAplica). */
  salud: number | null;
  /** Respuestas con valor 1-5 usadas para el promedio. */
  respuestasValidas: number;
  respuestasNoSabe: number;
  respuestasNoAplica: number;
  /** respuestasValidas / (total - noAplica); null si el denominador es 0. */
  coberturaConfianza: number | null;
}

// RF7 — los cuatro valores de una conexion en un ciclo, ya calculados.
export interface ValoresConexion {
  conexionId: string;
  salud: number; // 0-100
  criticidad: number; // 0-100
  gradoDependencia: GradoDependencia;
  riesgo: number; // 0-100
}

// RF7 — resultado del conjunto no dominado (frontera de Pareto).
export interface EslabonesMasDebilesResultado {
  conjuntoNoDominado: ValoresConexion[]; // ya ordenado para lectura
  esAmbiguo: boolean; // true si hay mas de un miembro
}

// RF16 — entrada minima para el indice de integracion: conexiones
// completas con su salud y criticidad ya calculadas, y si tienen
// alternativa declarada (RF3).
export interface ConexionParaIndice {
  salud: number;
  criticidad: number;
  tieneAlternativa: boolean;
}

export interface ResultadoIndiceIntegracion {
  indiceIntegracion: number; // 0-100
  totalConexiones: number;
  conexionesAceptables: number;
  puntosUnicosFalla: number;
}
