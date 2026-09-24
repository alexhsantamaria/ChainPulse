import { describe, expect, it } from "vitest";
import {
  compararDimensionesCadena,
  compararDimensionesConexion,
  type RespuestaCadenaParaComparar,
} from "../compararCadena";

function base(
  overrides: Partial<RespuestaCadenaParaComparar> = {},
): RespuestaCadenaParaComparar {
  return {
    prioridadElegida: null,
    nodoCriticoId: null,
    conocimientoEntradasSalidas: null,
    momentoInformacion: null,
    fuenteDatos: null,
    tieneAlternativa: null,
    alternativaProbada: null,
    ...overrides,
  };
}

function porDimension(
  resultados: ReturnType<typeof compararDimensionesCadena>,
  dimension: string,
) {
  const encontrado = resultados.find((r) => r.dimension === dimension);
  if (!encontrado)
    throw new Error(
      `No se encontro la dimension ${dimension} en los resultados`,
    );
  return encontrado;
}

describe("compararDimensionesCadena", () => {
  it("SIN_RESPUESTA_SUFICIENTE con menos de 2 opiniones", () => {
    const resultados = compararDimensionesCadena([
      base({ prioridadElegida: "RAPIDEZ" }),
    ]);
    expect(porDimension(resultados, "PRIORIDAD_ELEGIDA").resultado).toBe(
      "SIN_RESPUESTA_SUFICIENTE",
    );
  });

  it("SIN_RESPUESTA_SUFICIENTE cuando nadie respondio esa pregunta", () => {
    const resultados = compararDimensionesCadena([base(), base()]);
    expect(porDimension(resultados, "PRIORIDAD_ELEGIDA").resultado).toBe(
      "SIN_RESPUESTA_SUFICIENTE",
    );
  });

  it("ACUERDO cuando todos eligen la misma prioridad", () => {
    const resultados = compararDimensionesCadena([
      base({ prioridadElegida: "RAPIDEZ" }),
      base({ prioridadElegida: "RAPIDEZ" }),
      base({ prioridadElegida: null }), // no cuenta, "prefiero no responder"
    ]);
    expect(porDimension(resultados, "PRIORIDAD_ELEGIDA").resultado).toBe(
      "ACUERDO",
    );
  });

  it("DIFERENCIA cuando eligen prioridades distintas -- categorica, sin estado parcial", () => {
    const resultados = compararDimensionesCadena([
      base({ prioridadElegida: "RAPIDEZ" }),
      base({ prioridadElegida: "CALIDAD_CONSISTENCIA" }),
    ]);
    expect(porDimension(resultados, "PRIORIDAD_ELEGIDA").resultado).toBe(
      "DIFERENCIA",
    );
  });

  it("NODO_CRITICO -- DIFERENCIA cuando eligen nodos distintos", () => {
    const resultados = compararDimensionesCadena([
      base({ nodoCriticoId: "nodo-a" }),
      base({ nodoCriticoId: "nodo-b" }),
    ]);
    expect(porDimension(resultados, "NODO_CRITICO").resultado).toBe(
      "DIFERENCIA",
    );
  });

  it("NODO_CRITICO -- ACUERDO cuando eligen el mismo nodo", () => {
    const resultados = compararDimensionesCadena([
      base({ nodoCriticoId: "nodo-a" }),
      base({ nodoCriticoId: "nodo-a" }),
      base({ nodoCriticoId: "nodo-a" }),
    ]);
    expect(porDimension(resultados, "NODO_CRITICO").resultado).toBe("ACUERDO");
  });

  it("contextoSnapshot cuenta los valores sin identificar quien respondio", () => {
    const resultados = compararDimensionesCadena([
      base({ prioridadElegida: "RAPIDEZ" }),
      base({ prioridadElegida: "RAPIDEZ" }),
      base({ prioridadElegida: "CALIDAD_CONSISTENCIA" }),
    ]);
    const hallazgo = porDimension(resultados, "PRIORIDAD_ELEGIDA");
    expect(hallazgo.contextoSnapshot).toEqual({
      valoresDistintos: ["RAPIDEZ", "CALIDAD_CONSISTENCIA"],
      conteos: { RAPIDEZ: 2, CALIDAD_CONSISTENCIA: 1 },
      totalRespuestas: 3,
    });
  });
});

describe("compararDimensionesConexion -- dimensiones ordinales", () => {
  it("MOMENTO_INFORMACION -- ACUERDO_PARCIAL entre posiciones adyacentes", () => {
    const resultados = compararDimensionesConexion([
      base({ momentoInformacion: "CORTO" }),
      base({ momentoInformacion: "MEDIO" }),
    ]);
    expect(porDimension(resultados, "MOMENTO_INFORMACION").resultado).toBe(
      "ACUERDO_PARCIAL",
    );
  });

  it("MOMENTO_INFORMACION -- DIFERENCIA entre los dos extremos", () => {
    const resultados = compararDimensionesConexion([
      base({ momentoInformacion: "CORTO" }),
      base({ momentoInformacion: "LARGO" }),
    ]);
    expect(porDimension(resultados, "MOMENTO_INFORMACION").resultado).toBe(
      "DIFERENCIA",
    );
  });

  it("MOMENTO_INFORMACION -- ACUERDO cuando coinciden", () => {
    const resultados = compararDimensionesConexion([
      base({ momentoInformacion: "MEDIO" }),
      base({ momentoInformacion: "MEDIO" }),
    ]);
    expect(porDimension(resultados, "MOMENTO_INFORMACION").resultado).toBe(
      "ACUERDO",
    );
  });

  it("CONOCIMIENTO_ENTRADAS_SALIDAS -- NO_SABE se excluye, no cuenta como opinion real", () => {
    const resultados = compararDimensionesConexion([
      base({ conocimientoEntradasSalidas: "DEFINIDO_Y_USADO" }),
      base({ conocimientoEntradasSalidas: "NO_SABE" }),
    ]);
    // Solo queda 1 opinion real (DEFINIDO_Y_USADO) -- no alcanza para comparar.
    expect(
      porDimension(resultados, "CONOCIMIENTO_ENTRADAS_SALIDAS").resultado,
    ).toBe("SIN_RESPUESTA_SUFICIENTE");
  });

  it("CONOCIMIENTO_ENTRADAS_SALIDAS -- DIFERENCIA entre extremos reales de la escala", () => {
    const resultados = compararDimensionesConexion([
      base({ conocimientoEntradasSalidas: "DEFINIDO_Y_USADO" }),
      base({ conocimientoEntradasSalidas: "NO_CLARO" }),
    ]);
    expect(
      porDimension(resultados, "CONOCIMIENTO_ENTRADAS_SALIDAS").resultado,
    ).toBe("DIFERENCIA");
  });

  it("CONOCIMIENTO_ENTRADAS_SALIDAS -- ACUERDO_PARCIAL entre posiciones adyacentes", () => {
    const resultados = compararDimensionesConexion([
      base({ conocimientoEntradasSalidas: "DEFINIDO_Y_USADO" }),
      base({ conocimientoEntradasSalidas: "CLARO_PARA_ALGUNAS_AREAS" }),
    ]);
    expect(
      porDimension(resultados, "CONOCIMIENTO_ENTRADAS_SALIDAS").resultado,
    ).toBe("ACUERDO_PARCIAL");
  });

  it("FUENTE_DATOS -- categorica, DIFERENCIA sin estado parcial", () => {
    const resultados = compararDimensionesConexion([
      base({ fuenteDatos: "SAP_ERP" }),
      base({ fuenteDatos: "EXCEL" }),
    ]);
    expect(porDimension(resultados, "FUENTE_DATOS").resultado).toBe(
      "DIFERENCIA",
    );
  });
});

describe("compararDimensionesConexion -- ALTERNATIVA_DISPONIBLE", () => {
  it("DIFERENCIA cuando unos dicen que hay alternativa y otros que no", () => {
    const resultados = compararDimensionesConexion([
      base({ tieneAlternativa: true }),
      base({ tieneAlternativa: false }),
    ]);
    expect(porDimension(resultados, "ALTERNATIVA_DISPONIBLE").resultado).toBe(
      "DIFERENCIA",
    );
  });

  it("ACUERDO cuando todos coinciden en que NO hay alternativa", () => {
    const resultados = compararDimensionesConexion([
      base({ tieneAlternativa: false }),
      base({ tieneAlternativa: false }),
    ]);
    expect(porDimension(resultados, "ALTERNATIVA_DISPONIBLE").resultado).toBe(
      "ACUERDO",
    );
  });

  it("ACUERDO cuando coinciden en que SI hay alternativa y en que fue probada", () => {
    const resultados = compararDimensionesConexion([
      base({ tieneAlternativa: true, alternativaProbada: true }),
      base({ tieneAlternativa: true, alternativaProbada: true }),
    ]);
    expect(porDimension(resultados, "ALTERNATIVA_DISPONIBLE").resultado).toBe(
      "ACUERDO",
    );
  });

  it("ACUERDO_PARCIAL cuando coinciden en que hay alternativa pero difieren en si fue probada", () => {
    const resultados = compararDimensionesConexion([
      base({ tieneAlternativa: true, alternativaProbada: true }),
      base({ tieneAlternativa: true, alternativaProbada: false }),
    ]);
    expect(porDimension(resultados, "ALTERNATIVA_DISPONIBLE").resultado).toBe(
      "ACUERDO_PARCIAL",
    );
  });

  it("ACUERDO cuando coinciden en que hay alternativa y nadie sabe si fue probada", () => {
    const resultados = compararDimensionesConexion([
      base({ tieneAlternativa: true, alternativaProbada: null }),
      base({ tieneAlternativa: true, alternativaProbada: null }),
    ]);
    expect(porDimension(resultados, "ALTERNATIVA_DISPONIBLE").resultado).toBe(
      "ACUERDO",
    );
  });

  it("SIN_RESPUESTA_SUFICIENTE con menos de 2 opiniones sobre tieneAlternativa", () => {
    const resultados = compararDimensionesConexion([
      base({ tieneAlternativa: true }),
    ]);
    expect(porDimension(resultados, "ALTERNATIVA_DISPONIBLE").resultado).toBe(
      "SIN_RESPUESTA_SUFICIENTE",
    );
  });
});
