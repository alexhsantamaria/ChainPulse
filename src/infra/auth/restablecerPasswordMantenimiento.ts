// Infraestructura — mecanismo de mantenimiento acotado para restablecer
// la contraseña de UNA cuenta puntual sin depender del envío de correo
// (Resend sigue en modo sandbox -- ver
// diagnostico-eliminacion-cuenta-prueba.md Sección 10, Alternativa B,
// autorizada por Alex el 2026-10-03). Preparado para revisión -- NO
// ejecutado contra ninguna base real todavía.
//
// Condiciones explícitas de Alex que este módulo respeta (incluye la
// segunda ronda de revisión, 2026-10-03):
//   - Reutiliza tenantClient()/tenantTransaction() y hashPassword() ya
//     existentes, mismo rol de base (chainpulse_app, via DATABASE_URL)
//     que usa el resto de la app -- nunca SEED_DATABASE_URL/neondb_owner.
//     No se solicita ningún privilegio nuevo. verificarRolEfectivo()
//     confirma esto en tiempo de ejecución, antes de la primera consulta
//     o escritura (ver más abajo) -- el rol lo fija por completo la
//     credencial de DATABASE_URL al abrir la conexión y no cambia
//     durante la vida del proceso, así que una sola comprobación cubre
//     tanto la lectura como la escritura que vienen después.
//   - Actualiza ÚNICAMENTE passwordHash -- a propósito, no toca
//     intentosFallidos/bloqueadoHasta. Tampoco toca mfaSecret,
//     mfaHabilitado, sessionVersion, email, empresaId, ni ninguna otra
//     fila.
//   - El UPDATE corre DENTRO de una única transacción
//     (tenantTransaction(), no tenantClient()) para poder exigir
//     exactamente un usuario afectado Y revertir si no se cumple -- ver
//     el comentario de aplicarNuevaPasswordAtomico().
//   - updateMany() con id+empresaId+email EN EL MISMO where, y data
//     exclusivamente con passwordHash -- nunca se lee ni se devuelve
//     ningún hash, viejo ni nuevo (updateMany() solo expone { count }).
//   - NINGÚN error crudo (mensaje, stack, o el objeto del error en sí)
//     se registra en ningún punto de este módulo -- ver etiquetaSegura()/
//     registrarFalloSeguro() más abajo. A propósito este módulo NO usa
//     logError() de src/infra/log.ts: esa función arma un JSON con el
//     mensaje Y el stack del error real y lo imprime por console.error
//     (ver su propio comentario de cabecera) -- exactamente lo que este
//     mecanismo evita, porque un error de base (timeout, conexión
//     rechazada, lo que sea) podría traer datos de runtime que no
//     corresponde que terminen en ningún log. Acá solo se registra un
//     mensaje fijo más el código ya clasificado en ETIQUETAS_ERROR.
import { z } from "zod";
import { prisma } from "../prisma/client";
import { tenantClient } from "../prisma/tenantClient";
import { tenantTransaction } from "../prisma/tenantTransaction";
import { estaBloqueado } from "./rateLimit";
import { etiquetaSegura, registrarFalloSeguro } from "./etiquetaErrorSegura";

// Re-exportadas sin cambios -- ver etiquetaErrorSegura.ts para por que
// viven en un modulo separado, sin dependencias (ni de Prisma ni de
// ningun otro modulo de infra): el script
// (scripts/restablecerPasswordCuentaPrueba.ts) importa etiquetaSegura()
// DIRECTAMENTE de ese modulo, no de este archivo, precisamente para que
// su modo --probar-entrada no arrastre la construccion de PrismaClient
// que ../prisma/client.ts hace al cargarse. Se re-exportan aca tambien
// para que quien importe este modulo (p. ej. las pruebas) las encuentre
// en el mismo lugar que el resto de las funciones de este mecanismo.
export { etiquetaSegura, registrarFalloSeguro };

export type ResultadoVerificacionObjetivo =
  | {
      ok: true;
      usuario: {
        id: string;
        empresaId: string;
        email: string;
        intentosFallidos: number;
        bloqueadoHasta: Date | null;
      };
    }
  | { ok: false; motivo: "NO_ENCONTRADO" | "EMAIL_NO_COINCIDE" | "EMPRESA_NO_COINCIDE" | "ERROR_VERIFICACION" };

/**
 * Confirma que usuarioId pertenece a empresaId (via RLS de
 * tenantClient() -- si no pertenece, la fila ni siquiera aparece) Y que
 * su email coincide EXACTAMENTE con emailEsperado. Nunca asume: ante
 * cualquier discrepancia o fallo de la propia consulta, devuelve
 * ok:false en vez de lanzar, para que el llamador (el script) pueda
 * abortar sin pedir ni escribir ninguna contraseña.
 *
 * De paso trae intentosFallidos/bloqueadoHasta -- NO para escribirlos
 * (este módulo nunca los toca, ver aplicarNuevaPasswordAtomico()), sino
 * para que el llamador pueda mostrar, de solo lectura y ANTES de pedir
 * ninguna contraseña, si la cuenta está bloqueada en este momento (ver
 * describirEstadoBloqueo() más abajo). Es la misma consulta de siempre,
 * con dos campos más seleccionados -- no agrega ninguna consulta nueva.
 */
export async function verificarUsuarioObjetivo(
  empresaId: string,
  usuarioId: string,
  emailEsperado: string,
): Promise<ResultadoVerificacionObjetivo> {
  let usuario: {
    id: string;
    empresaId: string;
    email: string;
    intentosFallidos: number;
    bloqueadoHasta: Date | null;
  } | null;
  try {
    usuario = await tenantClient(empresaId).usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, empresaId: true, email: true, intentosFallidos: true, bloqueadoHasta: true },
    });
  } catch (err) {
    registrarFalloSeguro("verificarUsuarioObjetivo", err);
    return { ok: false, motivo: "ERROR_VERIFICACION" };
  }

  if (!usuario) {
    return { ok: false, motivo: "NO_ENCONTRADO" };
  }
  // Defensivo -- estructuralmente ya lo garantiza tenantClient(empresaId)
  // via RLS (una fila de otra empresa ni aparece), pero nunca confiar en
  // silencio: si alguna vez no coincidiera, abortar explícitamente.
  if (usuario.empresaId !== empresaId) {
    return { ok: false, motivo: "EMPRESA_NO_COINCIDE" };
  }
  if (usuario.email !== emailEsperado) {
    return { ok: false, motivo: "EMAIL_NO_COINCIDE" };
  }

  return { ok: true, usuario };
}

export interface EstadoBloqueo {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  bloqueadaAhora: boolean;
}

/**
 * Comprobación de SOLO LECTURA del bloqueo de la cuenta -- no escribe
 * nada, no agrega ninguna consulta (usa los campos que
 * verificarUsuarioObjetivo() ya trajo). Reusa estaBloqueado() de
 * rateLimit.ts (la misma función que ya usa /api/mfa/activar) en vez de
 * reimplementar el criterio de "bloqueada ahora". El llamador (el
 * script) imprime esto ANTES de pedir ninguna contraseña -- este
 * mecanismo nunca limpia intentosFallidos/bloqueadoHasta, así que si la
 * cuenta está bloqueada, seguirá bloqueada después del cambio.
 */
export function describirEstadoBloqueo(usuario: {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}): EstadoBloqueo {
  return {
    intentosFallidos: usuario.intentosFallidos,
    bloqueadoHasta: usuario.bloqueadoHasta,
    bloqueadaAhora: estaBloqueado(usuario.bloqueadoHasta),
  };
}

const ROL_ESPERADO = "chainpulse_app";

export type ResultadoVerificacionRol =
  | { ok: true; rol: string }
  | { ok: false; motivo: "ROL_INESPERADO"; rolActual: string }
  | { ok: false; motivo: "ERROR_VERIFICACION_ROL"; etiqueta: string };

/**
 * Confirma que el rol efectivo de la conexión actual a la base es
 * EXACTAMENTE "chainpulse_app" -- nunca neondb_owner ni ningún otro.
 * Nueva en la segunda ronda de revisión, a pedido de Alex: "verificá el
 * rol efectivo antes de consultar la cuenta o escribir". El rol lo fija
 * por completo la credencial de DATABASE_URL al abrir la conexión (ver
 * src/infra/prisma/client.ts) y no cambia durante la vida del proceso --
 * por eso UNA sola comprobación, corrida antes de la primera consulta de
 * este mecanismo, cubre tanto la lectura (verificarUsuarioObjetivo) como
 * la escritura (aplicarNuevaPasswordAtomico) que vienen después en el
 * mismo proceso; no hace falta repetirla antes de cada una.
 *
 * Usa el cliente base (prisma, sin tenantClient()) porque "cuál es mi
 * rol" no depende de ningún tenant -- mismo patrón ya documentado y
 * usado en loginLookup.ts (buscarUsuarioPorEmail(), prisma.$queryRaw
 * directo dentro de src/infra, la única excepción ya existente a pasar
 * siempre por tenantClient()).
 *
 * Nunca imprime ni devuelve DATABASE_URL ni ninguna credencial -- el rol
 * es un identificador (como un nombre de usuario de base), no un
 * secreto; se devuelve el nombre del rol detectado solo para poder
 * diagnosticar un rol inesperado sin mostrar la cadena de conexión.
 */
export async function verificarRolEfectivo(): Promise<ResultadoVerificacionRol> {
  let filas: { rol: string }[];
  try {
    // Corregido (sexta ronda de revision, a pedido de Alex -- fallo real
    // en Windows con v5+v7 instalados): `current_user` SIN cast es de
    // tipo Postgres "name" (OID 19, el tipo interno para identificadores
    // como nombres de rol/base, NO texto comun). @prisma/adapter-pg
    // (confirmado leyendo fieldToColumnType() en
    // node_modules/@prisma/adapter-pg/dist/index.js de este proyecto,
    // version 6.19.3 instalada) solo sabe convertir un conjunto fijo de
    // tipos nativos de Postgres a columnas de Prisma -- "name" no esta
    // en ese conjunto, asi que cualquier columna de ese tipo hace que
    // fieldToColumnType() lance UnsupportedNativeDataType ANTES de que
    // Prisma devuelva ninguna fila. Esa excepcion llega a esta funcion
    // como PrismaClientKnownRequestError con code "P2010" (confirmado en
    // node_modules/@prisma/client/runtime/client.js: el mapeo interno
    // "UnsupportedNativeDataType" -> "P2010") -- por eso la consulta
    // fallaba SIEMPRE (no por un permiso ni una conexion real), y
    // etiquetaSegura() mostraba "[ERROR] error no clasificado" porque
    // "P2010" no estaba todavia en la lista permitida (ver mas abajo, se
    // agrega ahora). El cast explicito `::text` (OID 25, "text", que SI
    // esta soportado) evita el problema de raiz -- Postgres devuelve el
    // mismo valor (el nombre del rol efectivo), solo que ya convertido a
    // un tipo que el adapter sabe deserializar.
    filas = await prisma.$queryRaw<{ rol: string }[]>`SELECT current_user::text AS rol`;
  } catch (err) {
    registrarFalloSeguro("verificarRolEfectivo", err);
    return { ok: false, motivo: "ERROR_VERIFICACION_ROL", etiqueta: etiquetaSegura(err) };
  }
  const rolActual = filas[0]?.rol ?? "DESCONOCIDO";
  if (rolActual !== ROL_ESPERADO) {
    return { ok: false, motivo: "ROL_INESPERADO", rolActual };
  }
  return { ok: true, rol: rolActual };
}

// Misma política ya usada en /api/registro, /api/invitaciones/aceptar y
// /api/recuperar-contrasena/confirmar (z.string().min(8).max(200)) -- no
// se inventa una regla distinta para este caso puntual.
const POLITICA_PASSWORD = z.string().min(8).max(200);

export function validarPoliticaPassword(password: string): { ok: true } | { ok: false; motivo: string } {
  const resultado = POLITICA_PASSWORD.safeParse(password);
  if (resultado.success) {
    return { ok: true };
  }
  return { ok: false, motivo: resultado.error.issues[0]?.message ?? "DATOS_INVALIDOS" };
}

export type ResultadoAplicarPassword =
  | { ok: true }
  | { ok: false; motivo: "CONTEO_INESPERADO"; cantidad: number }
  | { ok: false; motivo: "ERROR_ESCRITURA"; etiqueta: string };

// Señal interna para forzar el rollback -- nunca se expone fuera de este
// archivo, el llamador solo ve ResultadoAplicarPassword.
class ConteoInesperadoError extends Error {
  constructor(public readonly cantidad: number) {
    super(`UPDATE afecto ${cantidad} filas (se exigia exactamente 1)`);
    this.name = "ConteoInesperadoError";
  }
}

/**
 * Único punto de escritura de este mecanismo. Actualiza SOLO
 * passwordHash -- a propósito no toca intentosFallidos/bloqueadoHasta,
 * mfaSecret, mfaHabilitado, sessionVersion, email ni empresaId.
 *
 * POR QUÉ tenantTransaction() y no tenantClient(): tenantClient() abre y
 * CIERRA (confirma) su propia transacción en cada operación -- para
 * cuando el código que llama a tenantClient(...).usuario.updateMany()
 * recibe el resultado, la transacción YA fue confirmada, así que
 * comprobar "count !== 1" en ese punto ya sería tarde para revertir
 * nada. tenantTransaction(empresaId, fn) en cambio abre UNA transacción y
 * recién la confirma cuando fn(tx) termina sin lanzar -- lanzar
 * ConteoInesperadoError DENTRO de fn, antes de que fn termine, hace que
 * Prisma revierta esa misma transacción (el UPDATE nunca se confirma)
 * antes de propagar el error hacia afuera. Es la misma garantía que ya
 * usa registrarIntentoFallido() (rateLimit.ts) para su propio UPDATE
 * atómico -- infraestructura ya existente y revisada, reusada acá.
 *
 * El where incluye id+empresaId+email a la vez -- exige que las tres
 * condiciones sigan coincidiendo en el momento exacto de la escritura
 * (no solo en la lectura previa de verificarUsuarioObjetivo()). El data
 * tiene un único campo, passwordHash -- updateMany() nunca devuelve las
 * filas afectadas, solo { count }, así que este módulo no tiene forma de
 * leer ni de imprimir el hash nuevo ni el anterior en ningún punto.
 */
export async function aplicarNuevaPasswordAtomico(
  empresaId: string,
  usuarioId: string,
  emailEsperado: string,
  passwordHashNuevo: string,
): Promise<ResultadoAplicarPassword> {
  try {
    await tenantTransaction(empresaId, async (tx) => {
      const resultado = await tx.usuario.updateMany({
        where: { id: usuarioId, empresaId, email: emailEsperado },
        data: { passwordHash: passwordHashNuevo },
      });
      if (resultado.count !== 1) {
        // Lanzar ACA (dentro de fn, antes de que tenantTransaction()
        // confirme) -- ver el comentario de arriba. La transaccion se
        // revierte: el UPDATE (si llego a afectar alguna fila, cosa que
        // no deberia pasar salvo el caso 0 ya explicado) nunca queda
        // confirmado.
        throw new ConteoInesperadoError(resultado.count);
      }
    });
  } catch (err) {
    if (err instanceof ConteoInesperadoError) {
      return { ok: false, motivo: "CONTEO_INESPERADO", cantidad: err.cantidad };
    }
    registrarFalloSeguro("aplicarNuevaPasswordAtomico", err);
    return { ok: false, motivo: "ERROR_ESCRITURA", etiqueta: etiquetaSegura(err) };
  }

  return { ok: true };
}
