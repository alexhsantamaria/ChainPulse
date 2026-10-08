// Infraestructura — procesador puro de caracteres para la entrada
// oculta de scripts/restablecerPasswordCuentaPrueba.ts (leerPasswordOculta()).
// Modulo deliberadamente SIN dependencias de runtime (mismo motivo que
// etiquetaErrorSegura.ts/entradaOcultaError.ts: evitar que
// --probar-entrada arrastre, ni siquiera transitivamente, la
// construccion de PrismaClient). Solo importa un TYPE de
// entradaOcultaError.ts, que TypeScript borra por completo al compilar
// -- no agrega ningun import real en tiempo de ejecucion.
//
// Corregido a pedido de Alex (cuarta ronda de revision, prueba real en
// Windows): antes, leerPasswordOculta() ignoraba el byte ESC (`\u001b`,
// codigo 27, menor que espacio) pero NO sabia que ESC puede ser el
// primer byte de una secuencia de escape ANSI mas larga -- las teclas de
// navegacion (flechas, Home/End, etc.) en una terminal real envian ESC
// seguido de mas bytes (p. ej. flecha izquierda = ESC [ D). Esos bytes
// siguientes ("[", "D", etc.) son todos imprimibles por si solos, asi
// que caian en la rama "default" y se agregaban a la contraseña como si
// el usuario los hubiera tipeado, con un asterisco cada uno -- "dos
// asteriscos adicionales" al presionar una flecha, y contenido en la
// contraseña que el usuario nunca escribio.
//
// Esta funcion separa esa logica de interpretacion de caracteres (pura,
// sin E/S) del loop de leerPasswordOculta() (que si hace E/S: escribe en
// stdout, resuelve o rechaza la promesa) para poder probarla con
// secuencias completas Y fragmentadas entre llamadas, sin necesitar una
// terminal real ni un pseudo-terminal.
//
// Correccion adicional (quinta ronda, revision de Alex sobre esta misma
// version): la primera version de este archivo delegaba Ctrl-C/Ctrl-D/
// Enter al mismo chequeo de "byte final de la secuencia" que arrows/
// Home/End, por lo que si llegaban DESPUES de "[" u "O" (bufferEscape ya
// no vacio) quedaban atrapados dentro del buffer de escape en vez de
// cancelar o confirmar -- Ctrl-C/Ctrl-D no llegaban a CANCELAR y Enter
// podia quedar absorbido sin resolver. Ahora esos tres controles se
// revisan ANTES de evaluarse como posibles bytes de la secuencia,
// cualquiera sea el contenido de bufferEscape, y siempre descartan el
// escape incompleto sin agregar ninguno de sus bytes a `valor`.
export interface EstadoEntradaOculta {
  readonly valor: string;
  readonly enEscape: boolean;
  readonly bufferEscape: string;
}

export function estadoInicialEntradaOculta(): EstadoEntradaOculta {
  return { valor: "", enEscape: false, bufferEscape: "" };
}

export type ResultadoCaracter =
  | { tipo: "CARACTER_AGREGADO" } // -- imprimir "*"
  | { tipo: "BORRADO" } // -- imprimir "\b \b"
  | { tipo: "IGNORADO" } // -- no imprimir nada (control, parte de una secuencia de escape, etc.)
  | { tipo: "RESOLVER" } // -- Enter: imprimir "\n" y resolver con el `valor` del estado devuelto
  | { tipo: "CANCELAR"; motivo: "CANCELADO_CTRL_C" | "CANCELADO_CTRL_D" }; // -- imprimir "\n" y rechazar

// Limite de seguridad: ninguna secuencia de navegacion real supera esta
// longitud (incluso con modificadores, p. ej. "\x1b[1;5D"). Si se supera
// sin encontrar un byte final reconocido, se descarta todo el buffer en
// vez de quedar bloqueado esperando para siempre -- mas seguro perder
// bytes de ruido que arriesgarse a que terminen en la contraseña.
const LIMITE_ESCAPE = 16;

/**
 * Procesa UN caracter contra el estado actual y devuelve el nuevo
 * estado mas el resultado (que' hacer). Pura -- no escribe en stdout, no
 * resuelve ni rechaza nada por si misma; eso lo hace el llamador segun
 * el `tipo` de ResultadoCaracter. Se puede invocar repetidamente, una
 * vez por caracter, incluso si una secuencia de escape llega repartida
 * entre varios eventos "data" (cada llamada recibe el estado devuelto
 * por la anterior) -- el estado (`enEscape`/`bufferEscape`) es lo que
 * permite reconstruir la secuencia sin importar donde se corten los
 * chunks.
 */
export function procesarCaracterEntradaOculta(
  estado: EstadoEntradaOculta,
  char: string,
): { estado: EstadoEntradaOculta; resultado: ResultadoCaracter } {
  if (estado.enEscape) {
    if (estado.bufferEscape.length === 0) {
      // Primer byte despues de ESC -- "[" (CSI, flechas/Home/End/etc.)
      // u "O" (SS3, usado por algunas terminales para flechas/F1-F4)
      // inician una secuencia reconocida; cualquier otro byte significa
      // que ESC no era el inicio de una secuencia de navegacion (p. ej.
      // un Alt+tecla en algunas terminales, o un ESC suelto seguido de
      // texto normal). En ese caso NO se descarta a ciegas: se sale del
      // modo escape y este MISMO caracter se procesa de nuevo con las
      // reglas normales (podria ser Enter, Ctrl-C/D, backspace o un
      // caracter imprimible comun que el usuario tipeo justo despues).
      if (char === "[" || char === "O") {
        return {
          estado: { ...estado, bufferEscape: char },
          resultado: { tipo: "IGNORADO" },
        };
      }
      return procesarCaracterEntradaOculta({ ...estado, enEscape: false, bufferEscape: "" }, char);
    }

    // Controles universales (cancelar, confirmar): deben funcionar sin
    // importar que tan avanzada este la secuencia de escape -- incluso
    // con "[" u "O" ya recibido como primer byte, o con parametros
    // intermedios acumulados (p. ej. tras "\x1b[1;"). Si no se revisan
    // aqui, antes de evaluarlos como posibles bytes finales/parametros
    // de la secuencia, quedan atrapados dentro del buffer de escape y
    // Ctrl-C/Ctrl-D no cancelan ni Enter confirma (regresion detectada
    // por Alex en prueba real). Se descarta el escape incompleto --
    // ninguno de sus bytes se agrega a `valor` -- y se resuelve el
    // control con lo ya acumulado.
    if (char === "\u0003") {
      return {
        estado: { ...estado, enEscape: false, bufferEscape: "" },
        resultado: { tipo: "CANCELAR", motivo: "CANCELADO_CTRL_C" },
      };
    }
    if (char === "\u0004") {
      return {
        estado: { ...estado, enEscape: false, bufferEscape: "" },
        resultado: { tipo: "CANCELAR", motivo: "CANCELADO_CTRL_D" },
      };
    }
    if (char === "\n" || char === "\r") {
      return {
        estado: { ...estado, enEscape: false, bufferEscape: "" },
        resultado: { tipo: "RESOLVER" },
      };
    }

    const nuevoBuffer = estado.bufferEscape + char;
    const codigo = char.codePointAt(0) ?? 0;
    // CSI (ECMA-48): tras "[", bytes de parametro/intermedios, y un byte
    // FINAL en el rango 0x40-0x7E ("@" a "~") que cierra la secuencia --
    // cubre flechas (A/B/C/D), Home/End ("H"/"F"), y variantes con
    // parametros numericos y modificadores (p. ej. "\x1b[3~",
    // "\x1b[1;5D").
    const esFinalCSI = estado.bufferEscape[0] === "[" && codigo >= 0x40 && codigo <= 0x7e;
    // SS3: "O" seguido de exactamente un byte mas cierra la secuencia.
    const esFinalSS3 = estado.bufferEscape[0] === "O" && nuevoBuffer.length >= 2;
    const seAgotoElLimite = nuevoBuffer.length > LIMITE_ESCAPE;
    if (esFinalCSI || esFinalSS3 || seAgotoElLimite) {
      return {
        estado: { ...estado, enEscape: false, bufferEscape: "" },
        resultado: { tipo: "IGNORADO" },
      };
    }
    return {
      estado: { ...estado, bufferEscape: nuevoBuffer },
      resultado: { tipo: "IGNORADO" },
    };
  }

  switch (char) {
    case "\u001b": // ESC -- posible inicio de una secuencia de navegacion
      return {
        estado: { ...estado, enEscape: true, bufferEscape: "" },
        resultado: { tipo: "IGNORADO" },
      };
    case "\n":
    case "\r":
      return { estado, resultado: { tipo: "RESOLVER" } };
    case "\u0003": // Ctrl-C
      return { estado, resultado: { tipo: "CANCELAR", motivo: "CANCELADO_CTRL_C" } };
    case "\u0004": // Ctrl-D -- cancela, NO envia (igual que Ctrl-C)
      return { estado, resultado: { tipo: "CANCELAR", motivo: "CANCELADO_CTRL_D" } };
    case "\u007f": // Backspace (la mayoria de terminales)
    case "\b":
      if (estado.valor.length > 0) {
        return {
          estado: { ...estado, valor: estado.valor.slice(0, -1) },
          resultado: { tipo: "BORRADO" },
        };
      }
      return { estado, resultado: { tipo: "IGNORADO" } };
    default:
      // Solo se acumulan caracteres imprimibles -- cualquier otro
      // caracter de control (codigo menor a espacio) que pudiera venir
      // pegado junto con texto normal se ignora en silencio, nunca se
      // agrega a la contraseña.
      if (char >= " ") {
        return {
          estado: { ...estado, valor: estado.valor + char },
          resultado: { tipo: "CARACTER_AGREGADO" },
        };
      }
      return { estado, resultado: { tipo: "IGNORADO" } };
  }
}
