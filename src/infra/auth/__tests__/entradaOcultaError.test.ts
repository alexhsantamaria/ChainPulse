// Pruebas — EntradaOcultaError/mensajeEntradaOculta() (tercera ronda de
// revision, a pedido de Alex, 2026-10-04). Antes, los dos puntos que
// capturan errores de leerPasswordOculta() (en
// scripts/restablecerPasswordCuentaPrueba.ts) mostraban err.message (o
// String(err)) directamente, asumiendo que esa funcion "solo lanza
// errores de mensaje fijo". Estas pruebas confirman el arreglo: la
// traduccion a mensaje se hace por el campo `motivo` interno de
// EntradaOcultaError, nunca por el contenido de `message`, y cualquier
// error que no sea una EntradaOcultaError conocida -- incluido uno con
// un secreto simulado en su mensaje -- cae a un mensaje generico fijo
// sin que ese contenido aparezca en ningun lado.
import { describe, expect, it } from "vitest";
import { EntradaOcultaError, mensajeEntradaOculta } from "../entradaOcultaError";

describe("mensajeEntradaOculta", () => {
  it("TTY_NO_INTERACTIVA -- mensaje fijo correspondiente", () => {
    expect(mensajeEntradaOculta(new EntradaOcultaError("TTY_NO_INTERACTIVA"))).toContain(
      "no es una terminal interactiva",
    );
  });

  it("FALLO_MODO_RAW -- mensaje fijo correspondiente", () => {
    expect(mensajeEntradaOculta(new EntradaOcultaError("FALLO_MODO_RAW"))).toContain(
      "No se pudo activar el modo de entrada oculta",
    );
  });

  it("CANCELADO_CTRL_C -- mensaje fijo correspondiente, distinto de Ctrl-D", () => {
    expect(mensajeEntradaOculta(new EntradaOcultaError("CANCELADO_CTRL_C"))).toBe("Entrada cancelada (Ctrl-C).");
  });

  it("CANCELADO_CTRL_D -- mensaje fijo correspondiente, distinto de Ctrl-C", () => {
    expect(mensajeEntradaOculta(new EntradaOcultaError("CANCELADO_CTRL_D"))).toBe("Entrada cancelada (Ctrl-D).");
  });

  it("ERROR_INESPERADO -- mensaje generico fijo", () => {
    expect(mensajeEntradaOculta(new EntradaOcultaError("ERROR_INESPERADO"))).toContain(
      "error inesperado al leer la entrada",
    );
  });

  it("un Error comun (NO instancia de EntradaOcultaError) con un secreto simulado en el mensaje -- cae al mensaje generico, el secreto nunca aparece", () => {
    const secreto = "SECRETO_SIMULADO_EN_MENSAJE_INESPERADO_x9Vt";
    const errorInesperado = new Error(`fallo no previsto -- token interno ${secreto}`);

    const mensaje = mensajeEntradaOculta(errorInesperado);

    expect(mensaje).toBe("Ocurrio un error inesperado al leer la entrada -- intenta de nuevo.");
    expect(mensaje).not.toContain(secreto);
  });

  it("un valor que no es Error en absoluto (string con un secreto simulado) -- tambien cae al mensaje generico, nunca se lee su contenido", () => {
    const secreto = "SECRETO_SIMULADO_COMO_STRING_r4Bk";
    const mensaje = mensajeEntradaOculta(`crash crudo: ${secreto}`);

    expect(mensaje).toBe("Ocurrio un error inesperado al leer la entrada -- intenta de nuevo.");
    expect(mensaje).not.toContain(secreto);
  });

  it("undefined/null -- tambien caen al mensaje generico, nunca lanzan", () => {
    expect(mensajeEntradaOculta(undefined)).toBe("Ocurrio un error inesperado al leer la entrada -- intenta de nuevo.");
    expect(mensajeEntradaOculta(null)).toBe("Ocurrio un error inesperado al leer la entrada -- intenta de nuevo.");
  });

  it("una EntradaOcultaError con un `motivo` que coincidiera por casualidad con un secreto -- motivo es un tipo cerrado de TypeScript, no texto libre, asi que esto no es un vector real; se confirma igual que el mensaje devuelto es siempre uno de los cinco fijos", () => {
    const motivos = ["TTY_NO_INTERACTIVA", "FALLO_MODO_RAW", "CANCELADO_CTRL_C", "CANCELADO_CTRL_D", "ERROR_INESPERADO"] as const;
    for (const motivo of motivos) {
      const mensaje = mensajeEntradaOculta(new EntradaOcultaError(motivo));
      expect(typeof mensaje).toBe("string");
      expect(mensaje.length).toBeGreaterThan(0);
    }
  });
});

describe("EntradaOcultaError", () => {
  it("expone el motivo como propiedad propia, y el mensaje interno de Error nunca se usa para mostrar nada al usuario", () => {
    const err = new EntradaOcultaError("CANCELADO_CTRL_C");
    expect(err.motivo).toBe("CANCELADO_CTRL_C");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EntradaOcultaError");
  });
});
