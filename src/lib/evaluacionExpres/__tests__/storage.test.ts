// Pruebas — guardado local (sessionStorage inyectable) del progreso del
// cuestionario. Usa un almacen falso en memoria, no jsdom/window real
// (vitest.config.ts corre en environment "node" -- ver lecciones-aprendidas.md
// sobre preferir helpers puros con dependencias inyectables).
import { describe, expect, it } from "vitest";
import { guardarProgreso, guardarRespuestaLocal, leerProgreso, limpiarProgreso } from "../storage";
import type { PreguntaPublica } from "../tipos";

function crearAlmacenFalso() {
  const datos = new Map<string, string>();
  return {
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => {
      datos.set(clave, valor);
    },
    removeItem: (clave: string) => {
      datos.delete(clave);
    },
  };
}

const PREGUNTAS: PreguntaPublica[] = [
  { codigo: "Q1", orden: 1, texto: "¿?", opciones: [{ valor: "a", texto: "A", orden: 0 }], esNoPuntuable: false },
];

describe("guardarProgreso / leerProgreso", () => {
  it("guarda y relee el mismo progreso", () => {
    const almacen = crearAlmacenFalso();
    guardarProgreso("eval-1", { preguntas: PREGUNTAS, respuestas: {} }, almacen);
    expect(leerProgreso("eval-1", almacen)).toEqual({ preguntas: PREGUNTAS, respuestas: {} });
  });

  it("devuelve null si no hay nada guardado para ese id", () => {
    const almacen = crearAlmacenFalso();
    expect(leerProgreso("eval-inexistente", almacen)).toBeNull();
  });

  it("devuelve null si el contenido guardado esta corrupto", () => {
    const almacen = crearAlmacenFalso();
    almacen.setItem("chainpulse:evaluacion-expres:eval-1", "{ esto no es json valido");
    expect(leerProgreso("eval-1", almacen)).toBeNull();
  });

  it("no revienta si el almacen lanza (modo privado, cuota, etc.)", () => {
    const almacenQueFalla = {
      getItem: () => {
        throw new Error("no disponible");
      },
      setItem: () => {
        throw new Error("no disponible");
      },
      removeItem: () => {
        throw new Error("no disponible");
      },
    };
    expect(() =>
      guardarProgreso("eval-1", { preguntas: PREGUNTAS, respuestas: {} }, almacenQueFalla),
    ).not.toThrow();
    expect(leerProgreso("eval-1", almacenQueFalla)).toBeNull();
  });
});

describe("guardarRespuestaLocal", () => {
  it("agrega una respuesta al progreso ya guardado", () => {
    const almacen = crearAlmacenFalso();
    guardarProgreso("eval-1", { preguntas: PREGUNTAS, respuestas: {} }, almacen);
    guardarRespuestaLocal("eval-1", "Q1", { opcionValor: "a" }, almacen);
    expect(leerProgreso("eval-1", almacen)?.respuestas).toEqual({ Q1: { opcionValor: "a" } });
  });

  it("no hace nada si todavia no hay progreso guardado para ese id", () => {
    const almacen = crearAlmacenFalso();
    guardarRespuestaLocal("eval-1", "Q1", { opcionValor: "a" }, almacen);
    expect(leerProgreso("eval-1", almacen)).toBeNull();
  });
});

describe("limpiarProgreso", () => {
  it("borra el progreso guardado", () => {
    const almacen = crearAlmacenFalso();
    guardarProgreso("eval-1", { preguntas: PREGUNTAS, respuestas: {} }, almacen);
    limpiarProgreso("eval-1", almacen);
    expect(leerProgreso("eval-1", almacen)).toBeNull();
  });
});
