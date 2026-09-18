// Pruebas — helpers puros sobre PreguntaVersion.opciones (Json en Prisma).
import { describe, expect, it } from "vitest";
import { esOpcionPregunta, parsearOpciones, resolverOrdenPorValor } from "../opciones";

const OPCIONES_VALIDAS = [
  { valor: "disponibilidad", texto: "Disponibilidad", orden: 0 },
  { valor: "rapidez", texto: "Rapidez", orden: 1 },
  { valor: "no-definido", texto: "No esta claramente definido", orden: 7 },
];

describe("esOpcionPregunta", () => {
  it("acepta un objeto con valor/texto/orden en las formas correctas", () => {
    expect(esOpcionPregunta({ valor: "a", texto: "A", orden: 0 })).toBe(true);
  });

  it("rechaza null, arrays y objetos con campos faltantes o de tipo incorrecto", () => {
    expect(esOpcionPregunta(null)).toBe(false);
    expect(esOpcionPregunta([])).toBe(false);
    expect(esOpcionPregunta({ valor: "a", texto: "A" })).toBe(false);
    expect(esOpcionPregunta({ valor: "a", texto: "A", orden: "0" })).toBe(false);
    expect(esOpcionPregunta("a")).toBe(false);
  });
});

describe("parsearOpciones", () => {
  it("devuelve el array tal cual si todos los elementos son opciones validas", () => {
    expect(parsearOpciones(OPCIONES_VALIDAS, "PreguntaVersion Q1")).toEqual(OPCIONES_VALIDAS);
  });

  it("lanza con un mensaje que incluye el contexto si no es un array", () => {
    expect(() => parsearOpciones({ no: "es un array" }, "PreguntaVersion Q1")).toThrow(/PreguntaVersion Q1/);
  });

  it("lanza si algun elemento del array no tiene la forma de OpcionPregunta", () => {
    const opcionesCorruptas = [...OPCIONES_VALIDAS, { valor: "x" }];
    expect(() => parsearOpciones(opcionesCorruptas, "PreguntaVersion Q1")).toThrow(/forma invalida/);
  });
});

describe("resolverOrdenPorValor", () => {
  it("devuelve el orden (0-based) de la opcion cuyo valor coincide", () => {
    expect(resolverOrdenPorValor(OPCIONES_VALIDAS, "rapidez")).toBe(1);
  });

  it("devuelve el orden correcto aunque no coincida con la posicion en el array", () => {
    expect(resolverOrdenPorValor(OPCIONES_VALIDAS, "no-definido")).toBe(7);
  });

  it("devuelve undefined si el valor no existe entre las opciones", () => {
    expect(resolverOrdenPorValor(OPCIONES_VALIDAS, "inexistente")).toBeUndefined();
  });
});
