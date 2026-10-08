// Script de mantenimiento -- restablece la contraseña de UNA cuenta
// puntual, sin depender del envío de correo (Resend sigue en modo
// sandbox -- ver diagnostico-eliminacion-cuenta-prueba.md Sección 10,
// Alternativa B). Autorizado por Alex el 2026-10-03, con estas
// condiciones explícitas que este script respeta (incluye la segunda
// ronda de revisión, mismo día):
//
//   1. ACOTADO -- usuarioId y empresaId están hardcodeados abajo, nunca
//      se aceptan por argumento. El email esperado YA NO esta
//      hardcodeado (Ronda 22, Alex, 2026-10-07): se lee de dos
//      variables de entorno que deben coincidir EXACTAMENTE entre si
//      (CUENTA_PRUEBA_EMAIL/CUENTA_PRUEBA_EMAIL_CONFIRMACION, ver mas
//      abajo) -- nunca un argumento de linea de comandos, nunca un
//      valor por defecto, nunca impreso. Para cualquier otra cuenta
//      hace falta, ademas de esas 2 variables, editar usuarioId/
//      empresaId a mano (y revisado de nuevo), nunca un parametro.
//   2. MODO DIAGNÓSTICO POR DEFECTO -- sin --ejecutar, solo verifica
//      (lee) y no pide ni escribe ninguna contraseña. Hace falta
//      --ejecutar de forma explícita para llegar al prompt y a la
//      escritura real.
//   3. VERIFICACIÓN DE ROL, LUEGO DEL USUARIO, ANTES DE PEDIR NADA --
//      primero verificarRolEfectivo() confirma que la conexión usa el
//      rol chainpulse_app (nunca otro) antes de hacer cualquier consulta
//      o escritura; después verificarUsuarioObjetivo() confirma que
//      USUARIO_ID pertenece a EMPRESA_ID (via RLS de tenantClient -- si
//      no, ni aparece) y que su email coincide EXACTAMENTE con el valor
//      de CUENTA_PRUEBA_EMAIL (ver punto 1). Esta comprobación es
//      independiente de la confirmación del punto 1 (compara contra la
//      fila REAL de la base, nunca confía ciegamente en la variable de
//      entorno) y corre, como antes, ANTES de pedir o escribir
//      cualquier contraseña. Cualquier discrepancia (rol, usuario/
//      empresa/email, o las dos variables de entorno entre si) aborta
//      sin pedir ni escribir nada. La misma lectura del usuario también
//      informa el estado de bloqueo por rate-limit (intentosFallidos/
//      bloqueadoHasta) -- ver punto 4.
//   4. CONTRASEÑA NUNCA EXPUESTA -- se pide dos veces por entrada oculta
//      (enmascarada con "*", compatible con PowerShell/Windows -- ver
//      leerPasswordOculta() abajo, sin dependencias nuevas: usa
//      node:readline + el modo raw de stdin, ya incluido en Node).
//      Maneja texto pegado (procesa cada caracter del chunk recibido,
//      no el chunk entero, para no dejar pasar un caracter de control
//      pegado junto con texto normal) y caracteres de control: Ctrl-C y
//      Ctrl-D CANCELAN (no escriben nada) -- ninguno de los dos envía lo
//      tipeado hasta ese momento. Nunca se acepta como argumento de
//      línea de comandos, nunca se escribe a un archivo, a una variable
//      de entorno ni a ningún log -- las únicas dos variables que la
//      contienen en texto plano se limpian (reasignadas a cadena vacía)
//      apenas se calcula el hash. Hay un modo --probar-entrada, SIN
//      conexión a la base y SIN ninguna escritura, para validar en
//      Windows (con texto ficticio) que el enmascarado, el pegado, el
//      borrado y la cancelación funcionan antes de usar esto en serio.
//   5. UN SOLO CAMPO, ESCRITURA ATÓMICA -- se actualiza ÚNICAMENTE
//      passwordHash, dentro de UNA transacción abierta por
//      tenantTransaction() (no tenantClient()): el UPDATE y la
//      verificación de "exactamente un usuario afectado" ocurren DENTRO
//      del callback de esa transacción (ver aplicarNuevaPasswordAtomico()
//      en restablecerPasswordMantenimiento.ts) -- si
//      updateMany().count !== 1, se lanza un error dentro del callback
//      y Prisma revierte la transacción antes de propagar el error;
//      nunca se asume éxito ni queda una escritura parcial. `where` va
//      acotado a id+empresaId+email y `data` contiene exclusivamente
//      `passwordHash` -- no se lee ni se imprime el hash anterior ni el
//      nuevo en ningún punto. `intentosFallidos` y `bloqueadoHasta` NO
//      se tocan -- si la cuenta está bloqueada por rate-limit en este
//      momento, sigue bloqueada después de este cambio.
//   6. SIN PRIVILEGIOS ELEVADOS, VERIFICADO EN TIEMPO DE EJECUCIÓN -- usa
//      tenantClient()/tenantTransaction() sobre DATABASE_URL (rol
//      chainpulse_app), igual que el resto de la app -- nunca
//      SEED_DATABASE_URL/neondb_owner. verificarRolEfectivo() confirma
//      esto ANTES de la primera consulta (ver punto 3) -- ante cualquier
//      otro rol, el script se detiene sin mostrar ninguna credencial
//      (solo el nombre del rol detectado, que no es un secreto). Si el
//      rol SÍ es chainpulse_app pero igual no tiene permiso para el
//      UPDATE, el error llega con SQLSTATE 42501 y se detiene igual, sin
//      reintentar con otro rol o credenciales.
//   7. NO TOCA MFA, SESIÓN NI OTRAS CUENTAS -- no se modifica mfaSecret,
//      mfaHabilitado, sessionVersion, email, empresaId ni ninguna otra
//      fila. Este cambio NO revoca ningún JWT ya emitido para esta
//      cuenta NI renueva el secreto MFA -- se imprime este recordatorio
//      al final de una ejecución exitosa.
//   8. NINGÚN ERROR CRUDO SE REGISTRA NI SE IMPRIME -- ni en este
//      script ni en el módulo que usa (ver el comentario de cabecera de
//      restablecerPasswordMantenimiento.ts). El manejador final de
//      errores no capturados de este script (abajo, al final del
//      archivo) tampoco imprime el error crudo -- usa la misma etiqueta
//      segura que el resto del mecanismo.
//   9. --probar-entrada NO TOCA PRISMA, NI SIQUIERA PARA CONSTRUIR EL
//      CLIENTE -- hashPassword() y las funciones de
//      restablecerPasswordMantenimiento.ts se cargan con `await
//      import(...)` DENTRO de main(), despues de confirmar que no es
//      --probar-entrada (ver mas abajo). Un import ESTATICO de ese
//      modulo (como en una version anterior de este archivo) se habria
//      ejecutado siempre, sin importar el flag, porque
//      restablecerPasswordMantenimiento.ts importa a su vez
//      "../prisma/client", que construye `new PrismaPg(...)` y
//      `new PrismaClient({ adapter })` en el momento de cargarse (nivel
//      de modulo, no dentro de ninguna funcion) -- aunque esa
//      construccion no abre por si misma una conexion real a Neon,
//      tampoco corresponde que --probar-entrada la dispare. El import
//      dinamico evita esto por completo: antes de llegar a esas lineas,
//      este archivo no cargo "../prisma/client" ni nada que lo importe.
//   10. NINGUN CATCH DE ESTE ARCHIVO LEE err.message NI String(err) --
//      leerPasswordOculta() lanza EXCLUSIVAMENTE EntradaOcultaError,
//      identificado por un campo `motivo` interno fijo (nunca por el
//      contenido del mensaje); los dos puntos que la capturan
//      (correrPruebaDeEntrada() y main()) traducen ese motivo a un
//      mensaje fijo via mensajeEntradaOculta() -- cualquier error que no
//      sea una EntradaOcultaError conocida (lo que no deberia pasar,
//      pero nunca se asume que no puede pasar) cae a un mensaje generico
//      fijo, sin leer nunca su contenido. Corregido a pedido de Alex
//      (tercera ronda de revision) -- antes se mostraba err.message
//      asumiendo que leerPasswordOculta() "solo lanza errores de mensaje
//      fijo", suposicion que el tipo no garantizaba. Ver
//      src/infra/auth/entradaOcultaError.ts.
//   11. LAS SECUENCIAS DE ESCAPE ANSI DE NAVEGACION (FLECHAS, HOME/END,
//      ETC.) NUNCA SE AGREGAN A LA CONTRASEÑA -- corregido a pedido de
//      Alex tras una prueba real en Windows: al presionar una flecha
//      durante la entrada oculta aparecian dos asteriscos adicionales y
//      la contraseña terminaba con caracteres no tipeados por el
//      usuario. La causa: ESC (byte 27) ya se ignoraba, pero los bytes
//      siguientes de la secuencia (p. ej. "[" y "D" para flecha
//      izquierda) son imprimibles por si solos y caian en la misma
//      rama que un caracter normal tipeado. Ahora leerPasswordOculta()
//      delega la interpretacion de cada caracter a
//      procesarCaracterEntradaOculta() (entradaOcultaProcesador.ts, sin
//      dependencias, testeado con secuencias completas Y fragmentadas
//      entre eventos "data"), que reconoce el inicio de una secuencia
//      (ESC seguido de "[" o "O") y descarta todos sus bytes hasta el
//      byte final, sin que ninguno llegue nunca a la contraseña ni se
//      imprima ningun asterisco de mas. Backspace, pegado y
//      cancelacion con Ctrl-C/Ctrl-D quedan exactamente igual que antes.
//
// NO EJECUTADO TODAVÍA CONTRA NINGUNA BASE REAL -- preparado para
// revisión, a la espera de que Alex corra esto en Windows (el único
// entorno con red real a Neon).
//
// Uso (requiere, para los dos primeros modos, las variables de entorno
// CUENTA_PRUEBA_EMAIL y CUENTA_PRUEBA_EMAIL_CONFIRMACION, ambas con el
// email exacto esperado -- ver punto 1 mas arriba; --probar-entrada no
// las necesita):
//   CUENTA_PRUEBA_EMAIL=... CUENTA_PRUEBA_EMAIL_CONFIRMACION=... npx tsx scripts/restablecerPasswordCuentaPrueba.ts                  -- solo diagnostica (no pide ni escribe nada)
//   CUENTA_PRUEBA_EMAIL=... CUENTA_PRUEBA_EMAIL_CONFIRMACION=... npx tsx scripts/restablecerPasswordCuentaPrueba.ts --ejecutar       -- pide la contraseña dos veces y, si todo coincide, la aplica
//   npx tsx scripts/restablecerPasswordCuentaPrueba.ts --probar-entrada -- SIN base, SIN escritura: solo prueba el enmascarado/pegado/borrado/cancelacion con texto ficticio
import "./_cargarEnv";
// IMPORTANTE -- por que NO se importan aca arriba (de forma estatica)
// hashPassword() ni las funciones de restablecerPasswordMantenimiento.ts:
// un import estatico se ejecuta SIEMPRE al cargar este archivo, sin
// importar que flag se use despues. restablecerPasswordMantenimiento.ts
// importa, a su vez, "../prisma/client", cuyo modulo construye
// `new PrismaPg(...)` y `new PrismaClient({ adapter })` en el momento de
// CARGARSE (codigo de nivel de modulo, no dentro de ninguna funcion) --
// si este archivo importara ese modulo arriba, --probar-entrada
// construiria un PrismaClient igual, aunque nunca llegue a usarlo. Para
// que --probar-entrada no toque Prisma en absoluto (ni siquiera
// construir el cliente, mucho menos abrir una conexion), esos imports se
// hacen con `await import(...)` DENTRO de main(), y solo en la rama que
// NO es --probar-entrada (ver mas abajo). etiquetaSegura() si se importa
// arriba porque vive en un modulo aparte sin ninguna dependencia de
// Prisma -- ver etiquetaErrorSegura.ts.
import { etiquetaSegura } from "../src/infra/auth/etiquetaErrorSegura";
// Corregido (tercera ronda de revision, a pedido de Alex): leerPasswordOculta()
// ya NO lanza Error con mensajes construidos en el momento -- lanza
// EntradaOcultaError, identificado por un `motivo` interno fijo, nunca por
// el contenido de `message`. mensajeEntradaOculta() (abajo, en los dos
// catch que usan esto) traduce ese motivo a un mensaje fijo sin tocar
// err.message ni String(err) en ningun caso -- ver el comentario de
// cabecera de entradaOcultaError.ts para el porque. Mismo modulo sin
// dependencias que etiquetaErrorSegura.ts -- tambien seguro para
// --probar-entrada.
import { EntradaOcultaError, mensajeEntradaOculta } from "../src/infra/auth/entradaOcultaError";
// Corregido (cuarta ronda de revision, a pedido de Alex -- prueba real en
// Windows): la interpretacion caracter-por-caracter (incluidas las
// secuencias de escape ANSI de las teclas de navegacion) se delega a este
// procesador puro, sin dependencias de runtime -- tambien seguro para
// --probar-entrada. Ver el comentario de cabecera de
// entradaOcultaProcesador.ts para el detalle del bug (flechas dejando
// basura en la contraseña) y la correccion.
import {
  estadoInicialEntradaOculta,
  procesarCaracterEntradaOculta,
} from "../src/infra/auth/entradaOcultaProcesador";

// Acotado a propósito -- ver el punto 1 del comentario de cabecera.
// Cuenta de prueba diagnosticada en diagnostico-eliminacion-cuenta-prueba.md.
const USUARIO_ID = "cmup5n415000ix0ufvnv2dk8n";
const EMPRESA_ID = "f7436257-54f4-4e1b-8cbd-f33a31bd76ac";

// RONDA 22 (Alex, 2026-10-07): el email esperado ya NO esta hardcodeado
// -- se lee de DOS variables de entorno independientes, que deben
// coincidir EXACTAMENTE entre si (mismo criterio que pedir la
// contraseña nueva dos veces, mas abajo: un typo en una sola variable
// aborta en vez de arriesgar una coincidencia espuria). Ninguna de las
// dos tiene valor por defecto -- si cualquiera falta, o no coinciden
// entre si, main() aborta en su primera linea, antes de importar ningun
// modulo que dependa de Prisma. Ninguna de las dos se imprime en ningun
// lugar de este archivo.
const CUENTA_PRUEBA_EMAIL = process.env.CUENTA_PRUEBA_EMAIL ?? "";
const CUENTA_PRUEBA_EMAIL_CONFIRMACION = process.env.CUENTA_PRUEBA_EMAIL_CONFIRMACION ?? "";

// Entrada oculta compatible con PowerShell/Windows -- sin dependencias
// nuevas (node:readline + modo raw de stdin, nativo de Node en cualquier
// plataforma, incluida la consola de Windows). Enmascara cada caracter
// con "*", soporta backspace, y procesa CADA CARACTER del chunk recibido
// por separado (no el chunk entero) -- un pegado (paste) puede llegar en
// un solo evento "data" con varios caracteres juntos, y tratar ese chunk
// como una sola unidad dejaba pasar sin reaccionar un caracter de
// control pegado en el medio (p. ej. un salto de linea). Ctrl-C y Ctrl-D
// CANCELAN los dos (ninguno envia lo tipeado hasta ese momento -- a
// diferencia de una version anterior de este archivo, donde Ctrl-D se
// comportaba como Enter; corregido a pedido de Alex para que ningun
// atajo de teclado pueda enviar una contraseña parcial por accidente).
// Las secuencias de escape ANSI de las teclas de navegacion (flechas,
// Home/End, etc. -- ESC seguido de mas bytes) NUNCA se agregan a la
// contraseña, incluso si llegan repartidas entre varios eventos "data"
// -- corregido a pedido de Alex tras una prueba real en Windows donde
// la flecha izquierda dejaba caracteres de la secuencia en la
// contraseña. La interpretacion caracter-por-caracter (que' es cada
// byte y que' hacer con el) vive en procesarCaracterEntradaOculta()
// (entradaOcultaProcesador.ts, sin dependencias, testeado por separado
// con secuencias completas y fragmentadas) -- este bloque solo hace la
// E/S real (escribir en stdout, resolver/rechazar la promesa) en
// respuesta al resultado que esa funcion devuelve.
// Garantiza que la terminal vuelve a su estado normal (modo raw
// desactivado) sin importar por cual via termina: resolucion normal,
// cancelacion, error dentro del manejador de datos, fallo al activar el
// modo raw, o incluso una salida abrupta del proceso mientras el prompt
// seguia activo.
function leerPasswordOculta(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      reject(new EntradaOcultaError("TTY_NO_INTERACTIVA"));
      return;
    }

    let restaurado = false;
    function restaurar() {
      if (restaurado) return;
      restaurado = true;
      try {
        stdin.setRawMode(false);
      } catch {
        // Si stdin ya no acepta setRawMode (p.ej. ya se cerro, o nunca
        // se pudo activar en primer lugar), no hay nada mas que hacer --
        // no se relanza.
      }
      stdin.pause();
      stdin.removeListener("data", onData);
      process.removeListener("exit", restaurarAlSalir);
    }
    // Red de seguridad de ultimo recurso: si el proceso termina por
    // cualquier via (excepcion no capturada en otro lado, process.exit
    // externo) mientras este prompt seguia activo, esto igual intenta
    // devolver la terminal a su estado normal antes de que el proceso
    // finalice. En la salida normal, restaurar() ya removio este
    // listener, asi que no queda acumulado entre los dos prompts
    // sucesivos (contraseña nueva + repetida).
    function restaurarAlSalir() {
      restaurar();
    }
    process.on("exit", restaurarAlSalir);

    // Intentar activar el modo raw ANTES de escribir el prompt -- si
    // falla (terminal sin soporte, entorno atipico), se restaura y se
    // rechaza con un mensaje fijo, sin haber mostrado nada confuso.
    try {
      stdin.setRawMode(true);
    } catch {
      restaurar();
      reject(new EntradaOcultaError("FALLO_MODO_RAW"));
      return;
    }

    stdout.write(prompt);
    stdin.resume();
    stdin.setEncoding("utf8");

    let estado = estadoInicialEntradaOculta();
    function onData(chunk: string) {
      try {
        for (const char of chunk) {
          const { estado: nuevoEstado, resultado } = procesarCaracterEntradaOculta(estado, char);
          estado = nuevoEstado;
          switch (resultado.tipo) {
            case "RESOLVER":
              restaurar();
              stdout.write("\n");
              resolve(estado.valor);
              return;
            case "CANCELAR":
              restaurar();
              stdout.write("\n");
              reject(new EntradaOcultaError(resultado.motivo));
              return;
            case "CARACTER_AGREGADO":
              stdout.write("*");
              break;
            case "BORRADO":
              stdout.write("\b \b");
              break;
            case "IGNORADO":
              // Caracter de control, o parte (intermedia o inicial) de
              // una secuencia de escape de navegacion -- nunca se
              // imprime nada ni se toca la contraseña.
              break;
          }
        }
      } catch {
        // Cualquier error inesperado dentro del manejador restaura la
        // terminal antes de propagar -- nunca se deja la terminal en
        // modo raw por una excepcion no prevista aca. A proposito se
        // descarta el error original (ni siquiera se lee su .message):
        // se reemplaza siempre por EntradaOcultaError("ERROR_INESPERADO"),
        // que mensajeEntradaOculta() traduce a un mensaje fijo generico --
        // ver entradaOcultaError.ts.
        restaurar();
        reject(new EntradaOcultaError("ERROR_INESPERADO"));
      }
    }
    stdin.on("data", onData);
  });
}

// Modo de prueba de entrada -- SIN conexion a la base, SIN ninguna
// escritura. Nuevo a pedido de Alex (segunda ronda de revision): sirve
// para validar, en Windows, con texto FICTICIO, que leerPasswordOculta()
// enmascara bien, acepta texto pegado, borra con backspace, y cancela
// con Ctrl-C/Ctrl-D -- antes de confiar en esto para la contraseña real.
async function correrPruebaDeEntrada(): Promise<void> {
  console.log("Modo prueba de entrada -- SIN conexion a la base, SIN ninguna escritura.");
  console.log("Sirve solo para validar, en esta terminal, el enmascarado/pegado/borrado/cancelacion.");
  console.log("Usa texto FICTICIO -- nunca ingreses la contraseña real de ninguna cuenta aca.");
  console.log("Probá: escribir texto normal, pegar texto, usar backspace, y cancelar con Ctrl-C o Ctrl-D.");
  console.log("");
  try {
    const texto1 = await leerPasswordOculta("Texto de prueba (ficticio): ");
    console.log(`OK -- se capturaron ${texto1.length} caracteres. (El contenido nunca se imprime ni se guarda, ni en este modo.)`);
    console.log("");
    const texto2 = await leerPasswordOculta("Repetí el texto de prueba: ");
    console.log(`OK -- se capturaron ${texto2.length} caracteres.`);
    console.log(
      texto1 === texto2
        ? "Los dos textos coinciden (mismo contenido y longitud)."
        : "Los dos textos NO coinciden -- probar de nuevo si no fue intencional.",
    );
  } catch (err) {
    // Corregido (tercera ronda): ya no se lee err.message -- se usa
    // mensajeEntradaOculta(), que distingue por el `motivo` interno de
    // EntradaOcultaError (nunca por el contenido del mensaje) y cae a un
    // mensaje generico fijo para cualquier otra cosa, sin asumir que
    // leerPasswordOculta() solo puede lanzar lo que hoy lanza.
    console.log(`Entrada interrumpida: ${mensajeEntradaOculta(err)}`);
  }
  console.log("");
  console.log("Fin del modo prueba de entrada. No se conecto a ninguna base, no se escribio nada, no se pidio la contraseña real.");
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar");
  const probarEntrada = process.argv.includes("--probar-entrada");

  if (probarEntrada) {
    await correrPruebaDeEntrada();
    return;
  }

  // RONDA 22 -- confirmacion explicita e independiente del email
  // esperado, ANTES de cualquier otra cosa (incluso antes de los
  // imports dinamicos de abajo): las dos variables de entorno deben
  // estar definidas y coincidir EXACTAMENTE. Nunca se imprime ninguna
  // de las dos, ni siquiera en el mensaje de error.
  if (!CUENTA_PRUEBA_EMAIL || !CUENTA_PRUEBA_EMAIL_CONFIRMACION) {
    console.error(
      "CUENTA_PRUEBA_EMAIL y CUENTA_PRUEBA_EMAIL_CONFIRMACION deben estar definidas (ninguna tiene valor por defecto) -- abortado antes de conectarse a nada. Ninguna de las dos se imprime.",
    );
    process.exitCode = 1;
    return;
  }
  if (CUENTA_PRUEBA_EMAIL !== CUENTA_PRUEBA_EMAIL_CONFIRMACION) {
    console.error(
      "CUENTA_PRUEBA_EMAIL y CUENTA_PRUEBA_EMAIL_CONFIRMACION no coinciden -- abortado antes de conectarse a nada. Ninguna de las dos se imprime.",
    );
    process.exitCode = 1;
    return;
  }

  // Recien ACA, habiendo confirmado que NO es --probar-entrada y que la
  // confirmacion del email de arriba paso, se cargan (import dinamico)
  // hashPassword() y las funciones que dependen de Prisma. Antes de
  // este punto, nada en este archivo tocó "../prisma/client" ni ningun
  // modulo que lo importe.
  const { hashPassword } = await import("../src/infra/auth/password");
  const {
    verificarUsuarioObjetivo,
    describirEstadoBloqueo,
    verificarRolEfectivo,
    validarPoliticaPassword,
    aplicarNuevaPasswordAtomico,
  } = await import("../src/infra/auth/restablecerPasswordMantenimiento");

  console.log(
    `Modo: ${ejecutar ? "EJECUCION (--ejecutar)" : "DIAGNOSTICO (solo lectura -- agregar --ejecutar para continuar)"}`,
  );
  console.log(`usuarioId=${USUARIO_ID}`);
  console.log(`empresaId=${EMPRESA_ID}`);
  console.log("emailEsperado=(definido via CUENTA_PRUEBA_EMAIL, confirmado contra CUENTA_PRUEBA_EMAIL_CONFIRMACION -- no se imprime)");
  console.log("");

  // -- Paso 0: verificar el rol efectivo de la conexion, ANTES de
  // cualquier consulta o escritura (punto 4 de la segunda revision) --
  const rol = await verificarRolEfectivo();
  if (!rol.ok) {
    if (rol.motivo === "ROL_INESPERADO") {
      console.error(
        `Rol inesperado: la conexion actual usa el rol "${rol.rolActual}" y se esperaba "chainpulse_app". Abortado antes de consultar o escribir nada -- no se muestra ninguna credencial, solo el nombre del rol.`,
      );
    } else {
      console.error(
        `No se pudo verificar el rol efectivo de la conexion -- ${rol.etiqueta}. Abortado antes de consultar o escribir nada.`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Rol efectivo confirmado: ${rol.rol}.`);
  console.log("");

  // -- Paso 1: verificacion del usuario, siempre, antes de pedir nada --
  const verificacion = await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, CUENTA_PRUEBA_EMAIL);
  if (!verificacion.ok) {
    console.error(
      `Verificacion fallida (${verificacion.motivo}) -- abortado, no se pidio ni se escribio ninguna contraseña.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Verificacion OK -- el usuario ${verificacion.usuario.id} pertenece a la empresa ${verificacion.usuario.empresaId} (el email coincide con CUENTA_PRUEBA_EMAIL -- no se imprime).`,
  );

  // -- Paso 1b: estado de bloqueo, SOLO LECTURA -- reutiliza la misma
  // fila ya leida por verificarUsuarioObjetivo(), no agrega ninguna
  // consulta nueva. Este script nunca escribe intentosFallidos ni
  // bloqueadoHasta, en ningun modo -- esto es puramente informativo.
  const estadoBloqueo = describirEstadoBloqueo(verificacion.usuario);
  console.log("");
  console.log(
    `Estado de bloqueo (solo lectura, no modificado por este script): intentosFallidos=${estadoBloqueo.intentosFallidos}, bloqueadoHasta=${
      estadoBloqueo.bloqueadoHasta ? estadoBloqueo.bloqueadoHasta.toISOString() : "null"
    }, bloqueadaAhora=${estadoBloqueo.bloqueadaAhora}.`,
  );
  if (estadoBloqueo.bloqueadaAhora) {
    console.log(
      "La cuenta esta bloqueada por rate-limit en este momento. Este script NO desbloquea la cuenta -- bloqueadoHasta/intentosFallidos quedan igual aunque se cambie la contraseña.",
    );
  }

  if (!ejecutar) {
    console.log("");
    console.log("Modo diagnostico: no se pidio ni se escribio ninguna contraseña. Volver a correr con --ejecutar para continuar.");
    return;
  }

  // -- Paso 2: pedir la contraseña dos veces, oculta --
  console.log("");
  let nueva: string;
  let repetida: string;
  try {
    nueva = await leerPasswordOculta("Contraseña nueva: ");
    repetida = await leerPasswordOculta("Repetí la contraseña nueva: ");
  } catch (err) {
    // Corregido (tercera ronda): ya no se lee err.message/String(err) --
    // mensajeEntradaOculta() traduce por `motivo` interno, nunca por el
    // contenido del mensaje (ver entradaOcultaError.ts).
    console.error(`No se pudo leer la contraseña: ${mensajeEntradaOculta(err)}`);
    process.exitCode = 1;
    return;
  }

  if (nueva !== repetida) {
    nueva = "";
    repetida = "";
    console.error("Las dos contraseñas no coinciden -- abortado, no se escribio nada.");
    process.exitCode = 1;
    return;
  }

  const politica = validarPoliticaPassword(nueva);
  if (!politica.ok) {
    nueva = "";
    repetida = "";
    console.error(`La contraseña no cumple la politica del proyecto (minimo 8, maximo 200 caracteres): ${politica.motivo}`);
    process.exitCode = 1;
    return;
  }

  // -- Paso 3: hash, y limpiar el texto plano apenas se calcula -- nunca
  // se imprime, se guarda en archivo, en variable de entorno ni en log.
  const passwordHashNuevo = await hashPassword(nueva);
  nueva = "";
  repetida = "";

  // -- Paso 4: escritura unica y atomica, solo passwordHash. El conteo
  // de filas afectadas se verifica DENTRO de la misma transaccion (ver
  // aplicarNuevaPasswordAtomico()) -- si no es exactamente 1, la
  // transaccion se revierte antes de que esta funcion retorne.
  const resultado = await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, CUENTA_PRUEBA_EMAIL, passwordHashNuevo);
  if (!resultado.ok) {
    if (resultado.motivo === "CONTEO_INESPERADO") {
      console.error(
        `El UPDATE hubiera afectado ${resultado.cantidad} filas (se exigia exactamente 1) -- la transaccion se revirtio automaticamente, no quedo ningun cambio aplicado. Alguna condicion (id/empresa/email) ya no coincidia en el momento de escribir.`,
      );
    } else {
      console.error(
        `No se pudo escribir passwordHash -- ${resultado.etiqueta}. Si el codigo es [42501] permiso denegado, el rol actual (chainpulse_app) no tiene permiso para este UPDATE -- no se reintenta con otro rol ni otras credenciales.`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(
    `passwordHash actualizado (usuarioId=${USUARIO_ID}). El email no se imprime. Ningun hash (anterior ni nuevo) fue leido ni impreso.`,
  );
  console.log("No se toco mfaSecret, mfaHabilitado, sessionVersion, email, empresaId, intentosFallidos, bloqueadoHasta ni ninguna otra fila.");
  console.log(
    "Recordatorio: este cambio NO revoca ningun JWT ya emitido para esta cuenta, ni renueva el secreto MFA -- ver Seccion 10.4 de diagnostico-eliminacion-cuenta-prueba.md.",
  );
}

main().catch((err) => {
  // Manejador final de errores no capturados -- a proposito NUNCA
  // imprime el error crudo (ni err.message ni err.stack, que podrian
  // traer datos de runtime, p. ej. de una variable de entorno o de un
  // string de conexion). Usa la misma etiqueta segura que el resto del
  // mecanismo (ver restablecerPasswordMantenimiento.ts). process.exit()
  // (no solo exitCode) a proposito, igual que en la version anterior de
  // este archivo -- garantiza que el proceso termine aunque stdin haya
  // quedado resumido (p. ej. si el error no vino de leerPasswordOculta(),
  // que es la unica que pausa stdin al salir).
  console.error(`Error inesperado -- ${etiquetaSegura(err)}. No se registro el detalle crudo del error.`);
  process.exit(1);
});
