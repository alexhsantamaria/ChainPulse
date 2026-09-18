// Infraestructura publica — resuelve las Respuesta+PreguntaVersion
// persistidas de una EvaluacionExpresV2 contra el contrato que espera el
// motor v2 (RespuestaPreguntaV2, src/domain/types.ts). Funcion pura sobre
// los datos ya leidos de Prisma (no toma el cliente) -- la propia ruta
// hace el findMany/include; esto solo mapea forma, sin tocar la base.
import type { DimensionDiagnosticoV2, RespuestaPreguntaV2 } from "@/domain/types";
import { parsearOpciones, resolverOrdenPorValor } from "./opciones";

export interface PreguntaVersionDb {
  id: string;
  codigo: string;
  dimension: DimensionDiagnosticoV2;
  esNoPuntuable: boolean;
  opciones: unknown;
}

export interface RespuestaDb {
  id: string;
  preguntaVersionId: string;
  opcionSeleccionada: string | null;
  noSabe: boolean;
}

export interface ResultadoConstruirRespuestasV2 {
  respuestasV2: RespuestaPreguntaV2[];
  /** codigoPregunta ("Q1".."Q7") -> id real de Respuesta, para HallazgoExpresTraza. */
  respuestaIdPorCodigo: Record<string, string>;
  /** Codigos de preguntas puntuables (esNoPuntuable=false) sin ninguna Respuesta todavia. */
  preguntasFaltantes: string[];
}

/**
 * `preguntasVersion` debe ser TODAS las preguntas de la CuestionarioVersion
 * vigente (puntuables y no puntuables); `respuestas` las ya guardadas de
 * esta evaluacion. Nunca lanza por datos faltantes -- los reporta en
 * `preguntasFaltantes` para que la ruta decida el codigo de error HTTP;
 * si lanza, es por datos ya persistidos con una forma invalida (bug real,
 * no una entrada de usuario).
 */
export function construirRespuestasV2(
  preguntasVersion: readonly PreguntaVersionDb[],
  respuestas: readonly RespuestaDb[],
): ResultadoConstruirRespuestasV2 {
  const respuestaPorPreguntaVersionId = new Map(respuestas.map((r) => [r.preguntaVersionId, r]));

  const respuestasV2: RespuestaPreguntaV2[] = [];
  const respuestaIdPorCodigo: Record<string, string> = {};
  const preguntasFaltantes: string[] = [];

  for (const pregunta of preguntasVersion) {
    const respuesta = respuestaPorPreguntaVersionId.get(pregunta.id);
    if (!respuesta) {
      if (!pregunta.esNoPuntuable) preguntasFaltantes.push(pregunta.codigo);
      continue;
    }

    let indiceOpcion = 0;
    if (respuesta.opcionSeleccionada !== null) {
      const opciones = parsearOpciones(pregunta.opciones, `PreguntaVersion ${pregunta.codigo}`);
      const orden = resolverOrdenPorValor(opciones, respuesta.opcionSeleccionada);
      if (orden === undefined) {
        throw new Error(
          `Respuesta ${respuesta.id} referencia una opcion "${respuesta.opcionSeleccionada}" que no existe en PreguntaVersion ${pregunta.codigo}.`,
        );
      }
      indiceOpcion = orden;
    }
    // Si opcionSeleccionada es null (caso tipico de noSabe=true), el
    // motor v2 nunca lee indiceOpcion para esa respuesta (ver
    // dimensionSimple.ts/alineacion.ts) -- 0 es un valor seguro, nunca
    // interpretado como una opcion real.

    respuestasV2.push({
      codigoPregunta: pregunta.codigo,
      dimension: pregunta.esNoPuntuable ? null : pregunta.dimension,
      esNoPuntuable: pregunta.esNoPuntuable,
      indiceOpcion,
      noSabe: respuesta.noSabe,
    });
    respuestaIdPorCodigo[pregunta.codigo] = respuesta.id;
  }

  return { respuestasV2, respuestaIdPorCodigo, preguntasFaltantes };
}
