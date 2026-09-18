// Pruebas — mapeo de Respuesta+PreguntaVersion persistidas al contrato
// del motor v2 (RespuestaPreguntaV2).
import { describe, expect, it } from "vitest";
import { construirRespuestasV2, type PreguntaVersionDb, type RespuestaDb } from "../construirRespuestasV2";

const OPCIONES_Q1 = [
  { valor: "disponibilidad", texto: "Disponibilidad", orden: 0 },
  { valor: "rapidez", texto: "Rapidez", orden: 1 },
];

function pregunta(overrides: Partial<PreguntaVersionDb> = {}): PreguntaVersionDb {
  return {
    id: "pv-q1",
    codigo: "Q1",
    dimension: "ALINEACION",
    esNoPuntuable: false,
    opciones: OPCIONES_Q1,
    ...overrides,
  };
}

describe("construirRespuestasV2", () => {
  it("resuelve opcionSeleccionada al indiceOpcion correcto via el valor de la opcion", () => {
    const preguntas = [pregunta()];
    const respuestas: RespuestaDb[] = [
      { id: "r1", preguntaVersionId: "pv-q1", opcionSeleccionada: "rapidez", noSabe: false },
    ];
    const resultado = construirRespuestasV2(preguntas, respuestas);
    expect(resultado.respuestasV2).toEqual([
      { codigoPregunta: "Q1", dimension: "ALINEACION", esNoPuntuable: false, indiceOpcion: 1, noSabe: false },
    ]);
    expect(resultado.respuestaIdPorCodigo).toEqual({ Q1: "r1" });
    expect(resultado.preguntasFaltantes).toEqual([]);
  });

  it("usa indiceOpcion 0 de forma segura cuando opcionSeleccionada es null (noSabe)", () => {
    const preguntas = [pregunta()];
    const respuestas: RespuestaDb[] = [
      { id: "r1", preguntaVersionId: "pv-q1", opcionSeleccionada: null, noSabe: true },
    ];
    const resultado = construirRespuestasV2(preguntas, respuestas);
    expect(resultado.respuestasV2[0]).toMatchObject({ indiceOpcion: 0, noSabe: true });
  });

  it("reporta en preguntasFaltantes las preguntas puntuables sin Respuesta, sin lanzar", () => {
    const preguntas = [pregunta({ id: "pv-q1", codigo: "Q1" }), pregunta({ id: "pv-q2", codigo: "Q2" })];
    const respuestas: RespuestaDb[] = [
      { id: "r1", preguntaVersionId: "pv-q1", opcionSeleccionada: "rapidez", noSabe: false },
    ];
    const resultado = construirRespuestasV2(preguntas, respuestas);
    expect(resultado.preguntasFaltantes).toEqual(["Q2"]);
    expect(resultado.respuestasV2).toHaveLength(1);
  });

  it("nunca marca como faltante una pregunta esNoPuntuable sin respuesta", () => {
    const preguntas = [pregunta({ id: "pv-q5f", codigo: "Q5-fuente", esNoPuntuable: true, opciones: [] })];
    const resultado = construirRespuestasV2(preguntas, []);
    expect(resultado.preguntasFaltantes).toEqual([]);
    expect(resultado.respuestasV2).toEqual([]);
  });

  it("dimension es null en el RespuestaPreguntaV2 de una pregunta esNoPuntuable, aunque la fila tenga una dimension asignada", () => {
    const preguntas = [
      pregunta({ id: "pv-q5f", codigo: "Q5-fuente", esNoPuntuable: true, dimension: "INTEGRACION", opciones: [] }),
    ];
    const respuestas: RespuestaDb[] = [
      { id: "r1", preguntaVersionId: "pv-q5f", opcionSeleccionada: null, noSabe: false },
    ];
    const resultado = construirRespuestasV2(preguntas, respuestas);
    expect(resultado.respuestasV2[0]?.dimension).toBeNull();
  });

  it("lanza si la Respuesta persistida referencia una opcion que ya no existe en PreguntaVersion.opciones (dato corrupto)", () => {
    const preguntas = [pregunta()];
    const respuestas: RespuestaDb[] = [
      { id: "r1", preguntaVersionId: "pv-q1", opcionSeleccionada: "opcion-fantasma", noSabe: false },
    ];
    expect(() => construirRespuestasV2(preguntas, respuestas)).toThrow(/opcion-fantasma/);
  });
});
