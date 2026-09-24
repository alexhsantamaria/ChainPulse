// Motor -- compara las respuestas de varios participantes de una Cadena o
// ConexionCadena en las 6 dimensiones de RF38, sin identificar quien dijo
// que (RF39: "nunca... determinacion automatica de que participante tiene
// razon"). Funcion pura: recibe solo los valores ya extraidos de
// RespuestaCadena (nunca el modelo de Prisma completo ni el email), mismo
// criterio de pureza que el resto de src/engine/.
//
// LEE ESTO ANTES DE CAMBIAR LOS UMBRALES: RF38/RF39 (requirements.md
// Seccion 14.5) definen los 4 ESTADOS posibles (acuerdo/acuerdo parcial/
// diferencia/sin respuesta suficiente) pero no un algoritmo exacto para
// decidir cuando una discrepancia es "parcial" en vez de "diferencia" --
// las reglas de abajo son una interpretacion razonable, documentada
// explicitamente para que Alex las pueda ajustar, no un valor ya validado
// con datos reales (mismo espiritu de "hipotesis de calibracion" que ya
// usan RF15/RF16/RF17 en el motor v1, engine/constantes.ts).
//
// Regla general (las 6 dimensiones parten de aca):
// 1. Se ignoran las respuestas en null ("Prefiero no responder" en el
//    formulario) -- no cuentan como opinion.
// 2. Menos de 2 opiniones validas -> SIN_RESPUESTA_SUFICIENTE (RF38 dice
//    literalmente "cuando dos o mas participantes responden", asi que con
//    0 o 1 no hay nada que comparar).
// 3. Todas las opiniones iguales -> ACUERDO.
// 4. Opiniones distintas:
//    - Dimensiones puramente categoricas (PRIORIDAD_ELEGIDA, FUENTE_DATOS,
//      NODO_CRITICO) no tienen una nocion no-arbitraria de "cerca"/"lejos"
//      entre dos valores (ej. "Rapidez" vs "Calidad" no son mas o menos
//      cercanas que "Rapidez" vs "Precio") -> cualquier distincion es
//      DIFERENCIA, nunca ACUERDO_PARCIAL.
//    - Dimensiones ordinales (MOMENTO_INFORMACION: Corto/Medio/Largo;
//      CONOCIMIENTO_ENTRADAS_SALIDAS: escala de madurez de Q3 V2) miden la
//      distancia entre las posiciones -- adyacentes (distancia 1) es
//      ACUERDO_PARCIAL, mas lejos (distancia >=2) es DIFERENCIA.
//    - ALTERNATIVA_DISPONIBLE tiene su propia logica (ver
//      compararAlternativaDisponible): el desacuerdo real es si existe o
//      no una alternativa; si todos coinciden en que existe, si fue
//      probada es un matiz que como mucho baja a ACUERDO_PARCIAL, nunca
//      sube a DIFERENCIA por si solo.

export type DimensionComparacionCadena =
  | "PRIORIDAD_ELEGIDA"
  | "CONOCIMIENTO_ENTRADAS_SALIDAS"
  | "MOMENTO_INFORMACION"
  | "FUENTE_DATOS"
  | "NODO_CRITICO"
  | "ALTERNATIVA_DISPONIBLE";

export type ResultadoComparacionCadena =
  "ACUERDO" | "ACUERDO_PARCIAL" | "DIFERENCIA" | "SIN_RESPUESTA_SUFICIENTE";

export interface ContextoSnapshotComparacion {
  valoresDistintos: string[];
  conteos: Record<string, number>;
  totalRespuestas: number;
}

export interface ResultadoDimensionCadena {
  dimension: DimensionComparacionCadena;
  resultado: ResultadoComparacionCadena;
  contextoSnapshot: ContextoSnapshotComparacion;
}

// Forma minima que necesita este motor -- nunca el modelo de Prisma
// completo (sin id/email/fechas): quien llama (persistirHallazgosCadena)
// es responsable de proyectar RespuestaCadena a esta forma.
export interface RespuestaCadenaParaComparar {
  prioridadElegida: string | null;
  nodoCriticoId: string | null;
  conocimientoEntradasSalidas: string | null;
  momentoInformacion: string | null;
  fuenteDatos: string | null;
  tieneAlternativa: boolean | null;
  alternativaProbada: boolean | null;
}

// Mismo orden que los enums de schema.prisma -- peor a mejor / mas corto a
// mas largo, para que el indice en el array sea directamente la posicion
// ordinal.
const ORDEN_MOMENTO = ["CORTO", "MEDIO", "LARGO"] as const;
const ORDEN_CONOCIMIENTO = [
  "NO_CLARO",
  "DEPENDE_DE_PERSONAS",
  "CLARO_PARA_ALGUNAS_AREAS",
  "DEFINIDO_Y_USADO",
] as const;

function construirSnapshot(
  valores: readonly string[],
): ContextoSnapshotComparacion {
  const conteos: Record<string, number> = {};
  for (const valor of valores) conteos[valor] = (conteos[valor] ?? 0) + 1;
  return {
    valoresDistintos: [...new Set(valores)],
    conteos,
    totalRespuestas: valores.length,
  };
}

function valoresNoNulos<K extends keyof RespuestaCadenaParaComparar>(
  respuestas: readonly RespuestaCadenaParaComparar[],
  campo: K,
): string[] {
  return respuestas
    .map((r) => r[campo])
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .map((v) => String(v));
}

function compararCategorico(valores: readonly string[]): {
  resultado: ResultadoComparacionCadena;
  contextoSnapshot: ContextoSnapshotComparacion;
} {
  const contextoSnapshot = construirSnapshot(valores);
  if (valores.length < 2)
    return { resultado: "SIN_RESPUESTA_SUFICIENTE", contextoSnapshot };
  return {
    resultado: new Set(valores).size === 1 ? "ACUERDO" : "DIFERENCIA",
    contextoSnapshot,
  };
}

function compararOrdinal(
  valores: readonly string[],
  orden: readonly string[],
): {
  resultado: ResultadoComparacionCadena;
  contextoSnapshot: ContextoSnapshotComparacion;
} {
  const contextoSnapshot = construirSnapshot(valores);
  if (valores.length < 2)
    return { resultado: "SIN_RESPUESTA_SUFICIENTE", contextoSnapshot };

  const distintos = [...new Set(valores)];
  if (distintos.length === 1) return { resultado: "ACUERDO", contextoSnapshot };

  const posiciones = distintos.map((valor) => {
    const indice = orden.indexOf(valor);
    if (indice === -1) {
      throw new Error(
        `compararOrdinal: valor "${valor}" no esta en el orden declarado (${orden.join(", ")})`,
      );
    }
    return indice;
  });
  const distancia = Math.max(...posiciones) - Math.min(...posiciones);
  return {
    resultado: distancia <= 1 ? "ACUERDO_PARCIAL" : "DIFERENCIA",
    contextoSnapshot,
  };
}

// CONOCIMIENTO_ENTRADAS_SALIDAS -- "NO_SABE" no es un extremo de la escala
// de madurez, es la persona diciendo que no tiene una opinion real (mismo
// principio que engine/v2/dimensionSimple.ts trata `noSabe`: no
// sustantivo). Se excluye del calculo ordinal igual que un null -- si solo
// queda 0 o 1 opinion real, cae a SIN_RESPUESTA_SUFICIENTE por el mismo
// camino que cualquier otra dimension con pocas respuestas.
function compararConocimiento(
  respuestas: readonly RespuestaCadenaParaComparar[],
) {
  const valores = valoresNoNulos(
    respuestas,
    "conocimientoEntradasSalidas",
  ).filter((v) => v !== "NO_SABE");
  return compararOrdinal(valores, ORDEN_CONOCIMIENTO);
}

// ALTERNATIVA_DISPONIBLE -- dos campos relacionados (tieneAlternativa,
// alternativaProbada solo tiene sentido si tieneAlternativa=true). El
// desacuerdo de fondo de esta dimension es si existe o no una alternativa;
// si todos coinciden en que si existe, la falta de acuerdo sobre si fue
// probada es un matiz menor (ACUERDO_PARCIAL como mucho), nunca escala a
// DIFERENCIA por si sola -- la pregunta central ("hay alternativa")
// siguen respondiendola igual.
function compararAlternativaDisponible(
  respuestas: readonly RespuestaCadenaParaComparar[],
): {
  resultado: ResultadoComparacionCadena;
  contextoSnapshot: ContextoSnapshotComparacion;
} {
  const tieneAlternativa = respuestas
    .map((r) => r.tieneAlternativa)
    .filter((v): v is boolean => v !== null);

  if (tieneAlternativa.length < 2) {
    return {
      resultado: "SIN_RESPUESTA_SUFICIENTE",
      contextoSnapshot: construirSnapshot(tieneAlternativa.map(String)),
    };
  }

  const distintosTieneAlternativa = new Set(tieneAlternativa);
  if (distintosTieneAlternativa.size > 1) {
    return {
      resultado: "DIFERENCIA",
      contextoSnapshot: construirSnapshot(tieneAlternativa.map(String)),
    };
  }

  if (distintosTieneAlternativa.has(false)) {
    // Todos de acuerdo en que NO hay alternativa -- alternativaProbada no aplica.
    return {
      resultado: "ACUERDO",
      contextoSnapshot: construirSnapshot(tieneAlternativa.map(String)),
    };
  }

  // Todos de acuerdo en que SI hay alternativa -- ver si tambien coinciden en si fue probada.
  const probadas = respuestas
    .filter((r) => r.tieneAlternativa === true)
    .map((r) => r.alternativaProbada)
    .filter((v): v is boolean => v !== null);

  if (probadas.length < 2) {
    // Coinciden en la pregunta central de la dimension (hay alternativa);
    // sin suficiente dato sobre si fue probada no hay nada que degrade eso.
    return {
      resultado: "ACUERDO",
      contextoSnapshot: construirSnapshot(probadas.map(String)),
    };
  }

  const distintasProbadas = new Set(probadas);
  return {
    resultado: distintasProbadas.size === 1 ? "ACUERDO" : "ACUERDO_PARCIAL",
    contextoSnapshot: construirSnapshot(probadas.map(String)),
  };
}

// RF37/RF38 -- las 2 dimensiones que solo tienen sentido para el alcance
// "cadena completa" (conexionCadenaId null en RespuestaCadena).
export function compararDimensionesCadena(
  respuestas: readonly RespuestaCadenaParaComparar[],
): ResultadoDimensionCadena[] {
  return [
    {
      dimension: "PRIORIDAD_ELEGIDA",
      ...compararCategorico(valoresNoNulos(respuestas, "prioridadElegida")),
    },
    {
      dimension: "NODO_CRITICO",
      ...compararCategorico(valoresNoNulos(respuestas, "nodoCriticoId")),
    },
  ];
}

// RF37/RF38 -- las 4 dimensiones que solo tienen sentido para el alcance
// "conexion puntual" (conexionCadenaId presente en RespuestaCadena).
export function compararDimensionesConexion(
  respuestas: readonly RespuestaCadenaParaComparar[],
): ResultadoDimensionCadena[] {
  return [
    {
      dimension: "CONOCIMIENTO_ENTRADAS_SALIDAS",
      ...compararConocimiento(respuestas),
    },
    {
      dimension: "MOMENTO_INFORMACION",
      ...compararOrdinal(
        valoresNoNulos(respuestas, "momentoInformacion"),
        ORDEN_MOMENTO,
      ),
    },
    {
      dimension: "FUENTE_DATOS",
      ...compararCategorico(valoresNoNulos(respuestas, "fuenteDatos")),
    },
    {
      dimension: "ALTERNATIVA_DISPONIBLE",
      ...compararAlternativaDisponible(respuestas),
    },
  ];
}
