// Pruebas — procesarCaracterEntradaOculta()/estadoInicialEntradaOculta()
// (cuarta ronda de revision, a pedido de Alex, tras una prueba real en
// Windows: la flecha izquierda durante la entrada oculta dejaba "[" y
// "D" como caracteres sueltos en la contraseña, con un asterisco cada
// uno). Estas pruebas cubren flechas completas en un solo procesamiento
// y la MISMA secuencia repartida entre llamadas separadas (simulando
// que ESC, "[" y el byte final lleguen en eventos "data" distintos),
// ademas de Home/End/SS3 y el comportamiento normal (texto, backspace,
// Enter, Ctrl-C/Ctrl-D) que debia seguir intacto.
import { describe, expect, it } from "vitest";
import {
  estadoInicialEntradaOculta,
  procesarCaracterEntradaOculta,
  type EstadoEntradaOculta,
} from "../entradaOcultaProcesador";

// Helper -- procesa una cadena completa, caracter por caracter, como si
// llegara entera en un solo evento "data", y devuelve el estado final
// mas la lista de resultados (uno por caracter).
function procesarCadena(estadoInicial: EstadoEntradaOculta, texto: string) {
  let estado = estadoInicial;
  const resultados = [];
  for (const char of texto) {
    const paso = procesarCaracterEntradaOculta(estado, char);
    estado = paso.estado;
    resultados.push(paso.resultado);
  }
  return { estado, resultados };
}

describe("procesarCaracterEntradaOculta -- comportamiento normal (no debe cambiar)", () => {
  it("texto imprimible normal -- se acumula, un CARACTER_AGREGADO por caracter", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "abc");
    expect(estado.valor).toBe("abc");
    expect(resultados).toEqual([
      { tipo: "CARACTER_AGREGADO" },
      { tipo: "CARACTER_AGREGADO" },
      { tipo: "CARACTER_AGREGADO" },
    ]);
  });

  it("backspace borra el ultimo caracter -- BORRADO", () => {
    const { estado: tras_abc } = procesarCadena(estadoInicialEntradaOculta(), "abc");
    const paso = procesarCaracterEntradaOculta(tras_abc, "\u007f");
    expect(paso.estado.valor).toBe("ab");
    expect(paso.resultado).toEqual({ tipo: "BORRADO" });
  });

  it("backspace con la contraseña vacia -- IGNORADO, no rompe nada", () => {
    const paso = procesarCaracterEntradaOculta(estadoInicialEntradaOculta(), "\u007f");
    expect(paso.estado.valor).toBe("");
    expect(paso.resultado).toEqual({ tipo: "IGNORADO" });
  });

  it("Enter (\\n o \\r) -- RESOLVER, el valor acumulado no cambia", () => {
    const { estado: tras_abc } = procesarCadena(estadoInicialEntradaOculta(), "abc");
    const paso = procesarCaracterEntradaOculta(tras_abc, "\n");
    expect(paso.resultado).toEqual({ tipo: "RESOLVER" });
    expect(paso.estado.valor).toBe("abc");
  });

  it("Ctrl-C -- CANCELAR con motivo CANCELADO_CTRL_C", () => {
    const paso = procesarCaracterEntradaOculta(estadoInicialEntradaOculta(), "\u0003");
    expect(paso.resultado).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_C" });
  });

  it("Ctrl-D -- CANCELAR con motivo CANCELADO_CTRL_D (distinto de Ctrl-C)", () => {
    const paso = procesarCaracterEntradaOculta(estadoInicialEntradaOculta(), "\u0004");
    expect(paso.resultado).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_D" });
  });

  it("un caracter de control pegado junto con texto (p. ej. \\u0001) -- IGNORADO, nunca se agrega", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "a\u0001b");
    expect(estado.valor).toBe("ab");
    expect(resultados.map((r) => r.tipo)).toEqual(["CARACTER_AGREGADO", "IGNORADO", "CARACTER_AGREGADO"]);
  });
});

describe("procesarCaracterEntradaOculta -- flechas (bug reportado por Alex en Windows)", () => {
  it("flecha izquierda completa (ESC [ D) en un solo procesamiento -- nada se agrega, todo IGNORADO", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "\u001b[D");
    expect(estado.valor).toBe("");
    expect(resultados).toEqual([{ tipo: "IGNORADO" }, { tipo: "IGNORADO" }, { tipo: "IGNORADO" }]);
  });

  it("las cuatro flechas (ESC [ A/B/C/D) -- ninguna se agrega a la contraseña", () => {
    for (const letra of ["A", "B", "C", "D"]) {
      const { estado } = procesarCadena(estadoInicialEntradaOculta(), `\u001b[${letra}`);
      expect(estado.valor).toBe("");
    }
  });

  it("texto, flecha izquierda, mas texto -- la flecha no deja NINGUN rastro en el valor final", () => {
    const { estado } = procesarCadena(estadoInicialEntradaOculta(), "ab\u001b[Dcd");
    expect(estado.valor).toBe("abcd");
  });

  it("secuencia fragmentada entre llamadas (ESC, luego \"[\", luego \"D\" por separado) -- igual que si llegara entera", () => {
    let estado = estadoInicialEntradaOculta();
    let paso = procesarCaracterEntradaOculta(estado, "\u001b");
    estado = paso.estado;
    expect(paso.resultado).toEqual({ tipo: "IGNORADO" });
    expect(estado.enEscape).toBe(true);

    paso = procesarCaracterEntradaOculta(estado, "[");
    estado = paso.estado;
    expect(paso.resultado).toEqual({ tipo: "IGNORADO" });

    paso = procesarCaracterEntradaOculta(estado, "D");
    estado = paso.estado;
    expect(paso.resultado).toEqual({ tipo: "IGNORADO" });
    expect(estado.enEscape).toBe(false);
    expect(estado.valor).toBe("");
  });

  it("secuencia fragmentada rodeada de texto normal en llamadas separadas -- el valor final no incluye nada de la secuencia", () => {
    let estado = estadoInicialEntradaOculta();
    const pasos = ["a", "\u001b", "[", "D", "b"];
    for (const char of pasos) {
      estado = procesarCaracterEntradaOculta(estado, char).estado;
    }
    expect(estado.valor).toBe("ab");
  });

  it("Home/End con parametro numerico (ESC [ 1 ~ y ESC [ 4 ~) -- tambien se descartan por completo", () => {
    const home = procesarCadena(estadoInicialEntradaOculta(), "\u001b[1~");
    expect(home.estado.valor).toBe("");
    const end = procesarCadena(estadoInicialEntradaOculta(), "\u001b[4~");
    expect(end.estado.valor).toBe("");
  });

  it("flecha con modificador (ESC [ 1 ; 5 D, Ctrl+flecha izquierda) -- se descarta por completo", () => {
    const { estado } = procesarCadena(estadoInicialEntradaOculta(), "\u001b[1;5D");
    expect(estado.valor).toBe("");
  });

  it("secuencia SS3 (ESC O D, codificacion alternativa de flecha en algunas terminales) -- tambien se descarta", () => {
    const { estado } = procesarCadena(estadoInicialEntradaOculta(), "\u001bOD");
    expect(estado.valor).toBe("");
  });

  it("ESC suelto seguido de texto normal (no es una secuencia reconocida) -- el texto posterior SI se agrega, no se come caracteres de mas", () => {
    const { estado } = procesarCadena(estadoInicialEntradaOculta(), "\u001bhola");
    expect(estado.valor).toBe("hola");
  });

  it("ESC suelto seguido de Enter -- el Enter se procesa normalmente (RESOLVER), no queda comido por el modo escape", () => {
    let estado = estadoInicialEntradaOculta();
    estado = procesarCaracterEntradaOculta(estado, "a").estado;
    estado = procesarCaracterEntradaOculta(estado, "\u001b").estado;
    const paso = procesarCaracterEntradaOculta(estado, "\n");
    expect(paso.resultado).toEqual({ tipo: "RESOLVER" });
    expect(paso.estado.valor).toBe("a");
  });

  it("secuencia de escape sin byte final que nunca llega (ruido/garbage) -- se descarta sola al superar el limite, sin bloquear la entrada normal despues", () => {
    let estado = estadoInicialEntradaOculta();
    estado = procesarCaracterEntradaOculta(estado, "\u001b").estado;
    estado = procesarCaracterEntradaOculta(estado, "[").estado;
    // 16 bytes de parametro (digitos), ninguno es un byte final CSI --
    // alcanza exactamente LIMITE_ESCAPE y el buffer se descarta en ese
    // mismo caracter, sin dejar ningun digito suelto despues.
    let ultimoResultado;
    for (let i = 0; i < 16; i++) {
      const paso = procesarCaracterEntradaOculta(estado, "9");
      estado = paso.estado;
      ultimoResultado = paso.resultado;
    }
    expect(ultimoResultado).toEqual({ tipo: "IGNORADO" });
    expect(estado.enEscape).toBe(false);
    expect(estado.valor).toBe("");
    // La entrada normal debe seguir funcionando despues del descarte.
    const final = procesarCaracterEntradaOculta(estado, "z");
    expect(final.resultado).toEqual({ tipo: "CARACTER_AGREGADO" });
    expect(final.estado.valor).toBe("z");
  });

  it("muchas flechas seguidas, fragmentadas de distintas formas -- el valor final es exactamente el texto real tipeado", () => {
    let estado = estadoInicialEntradaOculta();
    const entradaSimulada: string[] = [
      "h", "o", "l", "a",
      "\u001b", "[", "D", // flecha izquierda, entera
      "\u001b[C", // flecha derecha, de un solo golpe (como un chunk pegado)
      "1", "2", "3",
    ];
    for (const trozo of entradaSimulada) {
      for (const char of trozo) {
        estado = procesarCaracterEntradaOculta(estado, char).estado;
      }
    }
    expect(estado.valor).toBe("hola123");
  });
});

describe("procesarCaracterEntradaOculta -- Ctrl-C/Ctrl-D/Enter deben funcionar aunque la secuencia de escape este incompleta (regresion detectada por Alex sobre la v6)", () => {
  it("Ctrl-C tras ESC [ (bufferEscape ya tiene \"[\") -- CANCELAR, no queda nada atrapado en el buffer", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "\u001b[\u0003");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_C" });
    expect(estado.valor).toBe("");
    expect(estado.enEscape).toBe(false);
    expect(estado.bufferEscape).toBe("");
  });

  it("Ctrl-C tras ESC [ 1 ; (parametros intermedios ya acumulados) -- CANCELAR igual", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "\u001b[1;\u0003");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_C" });
    expect(estado.valor).toBe("");
  });

  it("Ctrl-C tras ESC O (SS3) -- CANCELAR igual", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "\u001bO\u0003");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_C" });
    expect(estado.valor).toBe("");
  });

  it("Ctrl-D tras ESC [ -- CANCELAR con motivo CANCELADO_CTRL_D, no queda atrapado", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "\u001b[\u0004");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_D" });
    expect(estado.valor).toBe("");
  });

  it("Ctrl-D tras ESC [ 1 ; -- CANCELAR igual", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "\u001b[1;\u0004");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_D" });
    expect(estado.valor).toBe("");
  });

  it("Ctrl-D tras ESC O -- CANCELAR igual", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "\u001bO\u0004");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_D" });
    expect(estado.valor).toBe("");
  });

  it("Enter tras ESC [ -- RESOLVER, descarta el escape incompleto sin agregar sus bytes al valor acumulado", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "ab\u001b[\n");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "RESOLVER" });
    expect(estado.valor).toBe("ab");
    expect(estado.enEscape).toBe(false);
    expect(estado.bufferEscape).toBe("");
  });

  it("Enter tras ESC [ 1 ; -- RESOLVER igual, el valor final no incluye ningun byte de la secuencia", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "ab\u001b[1;\n");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "RESOLVER" });
    expect(estado.valor).toBe("ab");
  });

  it("Enter tras ESC O -- RESOLVER igual", () => {
    const { estado, resultados } = procesarCadena(estadoInicialEntradaOculta(), "ab\u001bO\n");
    expect(resultados[resultados.length - 1]).toEqual({ tipo: "RESOLVER" });
    expect(estado.valor).toBe("ab");
  });

  it("Ctrl-C tras ESC [ 1 ; recibido en eventos separados (fragmentado) -- cancela igual que si llegara entero", () => {
    let estado = estadoInicialEntradaOculta();
    for (const char of ["a", "\u001b", "[", "1", ";"]) {
      estado = procesarCaracterEntradaOculta(estado, char).estado;
    }
    expect(estado.enEscape).toBe(true);
    expect(estado.bufferEscape).toBe("[1;");
    const paso = procesarCaracterEntradaOculta(estado, "\u0003");
    expect(paso.resultado).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_C" });
    expect(paso.estado.valor).toBe("a");
  });

  it("Ctrl-D tras ESC O recibido en eventos separados (fragmentado) -- cancela igual que si llegara entero", () => {
    let estado = estadoInicialEntradaOculta();
    for (const char of ["a", "\u001b", "O"]) {
      estado = procesarCaracterEntradaOculta(estado, char).estado;
    }
    expect(estado.enEscape).toBe(true);
    expect(estado.bufferEscape).toBe("O");
    const paso = procesarCaracterEntradaOculta(estado, "\u0004");
    expect(paso.resultado).toEqual({ tipo: "CANCELAR", motivo: "CANCELADO_CTRL_D" });
    expect(paso.estado.valor).toBe("a");
  });

  it("Enter tras ESC [ recibido en eventos separados (fragmentado) -- resuelve con lo ya tipeado, sin bytes del escape", () => {
    let estado = estadoInicialEntradaOculta();
    for (const char of ["a", "b", "\u001b", "["]) {
      estado = procesarCaracterEntradaOculta(estado, char).estado;
    }
    expect(estado.enEscape).toBe(true);
    expect(estado.bufferEscape).toBe("[");
    const paso = procesarCaracterEntradaOculta(estado, "\n");
    expect(paso.resultado).toEqual({ tipo: "RESOLVER" });
    expect(paso.estado.valor).toBe("ab");
    expect(paso.estado.enEscape).toBe(false);
    expect(paso.estado.bufferEscape).toBe("");
  });

  it("tras cancelar/resolver dentro de un escape incompleto, la entrada normal posterior sigue funcionando (no queda estado residual)", () => {
    let estado = estadoInicialEntradaOculta();
    estado = procesarCadena(estado, "\u001b[1;\u0003").estado;
    const paso = procesarCaracterEntradaOculta(estado, "z");
    expect(paso.resultado).toEqual({ tipo: "CARACTER_AGREGADO" });
  });
});
