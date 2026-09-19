// Infraestructura de cliente — etiquetas en español para los valores
// categoricos que devuelven los endpoints publicos (los enums del
// dominio, DimensionDiagnosticoV2/EstadoEvidenciaV2, viajan en
// ingles/mayusculas; "statement"/"nextCheck" ya llegan en español desde
// el motor v2, asi que esto solo traduce lo que llega como codigo).
import type { DimensionDiagnosticoV2, EstadoEvidenciaV2 } from "./tipos";

export const ETIQUETA_DIMENSION: Record<DimensionDiagnosticoV2, string> = {
  ALINEACION: "Alineación",
  COORDINACION: "Coordinación",
  INTEGRACION: "Integración",
  EVIDENCIA: "Evidencia",
  RESILIENCIA: "Resiliencia",
};

export const ETIQUETA_ESTADO_EVIDENCIA: Record<EstadoEvidenciaV2, string> = {
  DECLARADO: "Declarado",
  CONFIRMADO_POR_OTROS: "Confirmado por otros",
  VERIFICADO_CON_DATOS: "Verificado con datos",
};

export function etiquetaDimension(dimension: DimensionDiagnosticoV2): string {
  return ETIQUETA_DIMENSION[dimension];
}

export function etiquetaEstadoEvidencia(estado: EstadoEvidenciaV2): string {
  return ETIQUETA_ESTADO_EVIDENCIA[estado];
}

// Aparte del mapa (no como ETIQUETA_ERROR_API.ERROR_INTERNO): con
// noUncheckedIndexedAccess, hasta el acceso por clave literal a un
// Record<string, string> se tipa "string | undefined", asi que el
// fallback necesita ser un valor con tipo "string" garantizado.
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo en un momento.";

const ETIQUETA_ERROR_API: Record<string, string> = {
  LIMITE_TASA_EXCEDIDO: "Demasiados intentos en poco tiempo. Espera un momento y vuelve a intentar.",
  DATOS_INVALIDOS: "Algunos datos no son válidos. Revísalos e intenta de nuevo.",
  CUESTIONARIO_NO_DISPONIBLE: "La evaluación no está disponible en este momento. Intenta más tarde.",
  EVALUACION_INEXISTENTE: "No encontramos esta evaluación en este dispositivo o enlace.",
  EVALUACION_NO_COMPLETADA: "Todavía faltan preguntas por responder.",
  EVALUACION_YA_COMPLETADA: "Esta evaluación ya fue completada.",
  PREGUNTA_INEXISTENTE: "Esa pregunta no pertenece a esta evaluación.",
  CONTEXTO_LIBRE_REQUERIDO: "Selecciona una opción para continuar.",
  OPCION_VALOR_REQUERIDO: "Selecciona una opción para continuar.",
  OPCION_INVALIDA: "Esa opción ya no es válida. Recarga la pregunta.",
  PREGUNTAS_INCOMPLETAS: "Todavía faltan preguntas por responder.",
  SIN_CONEXION: "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.",
  ERROR_INTERNO: MENSAJE_ERROR_GENERICO,
};

export function mensajeError(codigo: string): string {
  return ETIQUETA_ERROR_API[codigo] ?? MENSAJE_ERROR_GENERICO;
}
