// Infraestructura de cliente — envoltorio tipado sobre los 5 endpoints
// publicos de la evaluacion expres v2 (src/app/api/public/evaluations/**).
// Cada funcion devuelve un resultado discriminado por "ok" en vez de
// lanzar, para que las paginas puedan mostrar el codigo de error real que
// ya define cada ruta (LIMITE_TASA_EXCEDIDO, DATOS_INVALIDOS, etc.) sin
// try/catch repetido en cada componente.
import type {
  ContextoEvaluacion,
  DatosDesbloqueo,
  HallazgoDetalle,
  HallazgoMacro,
  PreguntaPublica,
} from "./tipos";

export interface RespuestaApiError {
  ok: false;
  error: string;
  status: number;
  preguntasFaltantes?: string[];
}

type ResultadoApi<T> = { ok: true; datos: T } | RespuestaApiError;

async function leerJson(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.json();
  } catch {
    return null;
  }
}

function esErrorApi(cuerpo: unknown): cuerpo is { ok: false; error: string; preguntasFaltantes?: string[] } {
  return typeof cuerpo === "object" && cuerpo !== null && (cuerpo as { ok?: unknown }).ok === false;
}

async function pedir<T>(input: string, init: RequestInit): Promise<ResultadoApi<T>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(input, init);
  } catch {
    return { ok: false, error: "SIN_CONEXION", status: 0 };
  }
  const cuerpo = await leerJson(respuesta);
  if (!respuesta.ok || esErrorApi(cuerpo)) {
    return {
      ok: false,
      error: esErrorApi(cuerpo) ? cuerpo.error : "ERROR_INTERNO",
      status: respuesta.status,
      preguntasFaltantes: esErrorApi(cuerpo) ? cuerpo.preguntasFaltantes : undefined,
    };
  }
  return { ok: true, datos: cuerpo as T };
}

const encabezadosJson = { "Content-Type": "application/json" };

export interface RespuestaCrearEvaluacion {
  ok: true;
  evaluacionExpresV2Id: string;
  preguntas: PreguntaPublica[];
}

export function crearEvaluacion(contexto: ContextoEvaluacion) {
  return pedir<RespuestaCrearEvaluacion>("/api/public/evaluations", {
    method: "POST",
    headers: encabezadosJson,
    body: JSON.stringify(contexto),
  });
}

export interface RespuestaPregunta {
  codigoPregunta: string;
  opcionValor?: string;
  noSabe?: boolean;
  contextoLibre?: string;
}

export interface RespuestaEnviarRespuesta {
  ok: true;
  codigoPregunta: string;
}

export function enviarRespuesta(evaluacionId: string, respuesta: RespuestaPregunta) {
  return pedir<RespuestaEnviarRespuesta>(`/api/public/evaluations/${evaluacionId}/answers`, {
    method: "POST",
    headers: encabezadosJson,
    body: JSON.stringify(respuesta),
  });
}

export interface RespuestaCompletarEvaluacion {
  ok: true;
  yaCompletada: boolean;
  hallazgos: HallazgoMacro[];
}

export function completarEvaluacion(evaluacionId: string) {
  return pedir<RespuestaCompletarEvaluacion>(`/api/public/evaluations/${evaluacionId}/complete`, {
    method: "POST",
    headers: encabezadosJson,
  });
}

export interface RespuestaResultado {
  ok: true;
  detalleDesbloqueado: boolean;
  hallazgos: HallazgoMacro[] | HallazgoDetalle[];
}

export function obtenerResultado(evaluacionId: string) {
  return pedir<RespuestaResultado>(`/api/public/evaluations/${evaluacionId}/result`, {
    method: "GET",
  });
}

export interface RespuestaDesbloqueo {
  ok: true;
  yaDesbloqueado?: boolean;
  detalleDesbloqueado: boolean;
}

export function desbloquearDetalle(evaluacionId: string, datos: DatosDesbloqueo) {
  return pedir<RespuestaDesbloqueo>(`/api/public/evaluations/${evaluacionId}/unlock`, {
    method: "POST",
    headers: encabezadosJson,
    body: JSON.stringify(datos),
  });
}
