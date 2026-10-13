// Infraestructura (solo para las herramientas de scripts/) --
// correspondencia del manifiesto contra la base REAL (Alex, 2026-10-04,
// punto 4 de la primera correccion: "... y su correspondencia con el
// destino, la empresa y los usuarios de esa corrida antes de cualquier
// mutación"). Separado de validarEstructuraManifiesto() (manifiesto.ts,
// puro, sin base) para poder probar cada mitad por separado -- esta
// recibe un cliente ya construido, nunca lo construye, para poder
// inyectar un mock simple en las pruebas.
import { logError } from "../log";
import { type ManifiestoPrueba, SUFIJOS_USUARIO, nombreEmpresa } from "./manifiesto";

export interface ClienteCorrespondencia {
  empresa: { findUnique(args: { where: { id: string } }): Promise<{ id: string; nombre: string } | null> };
  usuario: { findMany(args: { where: { empresaId: string } }): Promise<Array<{ id: string; email: string }>> };
}

export interface ResultadoCorrespondencia {
  empresaId: string;
  usuariosEnBase: Array<{ id: string; email: string }>;
}

/**
 * Aborta (lanza un codigo fijo) si:
 * - el destino actual (host/base) no es el mismo que registro el
 *   manifiesto al sembrar -- nunca validar/limpiar un manifiesto contra
 *   un entorno distinto de donde se creo;
 * - la empresa del manifiesto no existe, o su nombre no coincide con el
 *   que genera esta misma corrida (nombreEmpresa(runId));
 * - hay una fila de usuario bajo esa empresa que NO esta en el
 *   manifiesto (dato inesperado -- alguien mas pudo haber usado la
 *   misma empresa de prueba, o quedo basura de una corrida anterior
 *   mal limpiada);
 * - una fila que SI esta en el manifiesto tiene un email distinto del
 *   declarado (id reciclado por coincidencia).
 *
 * TOLERANTE a que falten usuarios del manifiesto en la base (la
 * limpieza puede correr despues de que la propia validacion ya borro
 * a A3, por ejemplo) -- ver verificarTodosPresentes() mas abajo para el
 * chequeo ESTRICTO que si exige a los 4 presentes, para usar al EMPEZAR
 * la validacion (punto 5 de la segunda correccion).
 *
 * Nunca muta nada -- es el chequeo que corre ANTES de cualquier mutacion
 * en validarRevocacionEntornoPrueba.ts y limpiarPruebaRevocacionAislada.ts,
 * y en limpiarPruebaRevocacionAislada.ts corre DENTRO de la misma
 * transaccion que borra (punto 1 de la segunda correccion: "protección
 * frente a cambios concurrentes" -- un chequeo hecho afuera de la
 * transaccion podria quedar desactualizado para el momento de borrar).
 */
export async function verificarCorrespondenciaManifiesto(
  cliente: ClienteCorrespondencia,
  manifiesto: ManifiestoPrueba,
  destinoActual: { host: string; base: string },
  contexto: string,
): Promise<ResultadoCorrespondencia> {
  if (manifiesto.destino.host !== destinoActual.host || manifiesto.destino.base !== destinoActual.base) {
    logError(contexto, "MANIFIESTO_DESTINO_DISTINTO");
    throw new Error("MANIFIESTO_DESTINO_DISTINTO");
  }

  let empresa: { id: string; nombre: string } | null;
  let usuariosEnBase: Array<{ id: string; email: string }>;
  try {
    empresa = await cliente.empresa.findUnique({ where: { id: manifiesto.empresaId } });
    usuariosEnBase = await cliente.usuario.findMany({ where: { empresaId: manifiesto.empresaId } });
  } catch {
    logError(contexto, "ERROR_CONSULTA_CORRESPONDENCIA");
    throw new Error("ERROR_CONSULTA_CORRESPONDENCIA");
  }

  if (!empresa || empresa.nombre !== nombreEmpresa(manifiesto.runId)) {
    logError(contexto, "EMPRESA_NO_CORRESPONDE");
    throw new Error("EMPRESA_NO_CORRESPONDE");
  }

  const idsManifiesto = new Set(SUFIJOS_USUARIO.map((s) => manifiesto.usuarios[s].id));

  for (const fila of usuariosEnBase) {
    if (!idsManifiesto.has(fila.id)) {
      logError(contexto, "USUARIO_INESPERADO_EN_EMPRESA_DE_PRUEBA");
      throw new Error("USUARIO_INESPERADO_EN_EMPRESA_DE_PRUEBA");
    }
    const sufijo = SUFIJOS_USUARIO.find((s) => manifiesto.usuarios[s].id === fila.id);
    if (sufijo && manifiesto.usuarios[sufijo].email !== fila.email) {
      logError(contexto, "USUARIO_NO_CORRESPONDE");
      throw new Error("USUARIO_NO_CORRESPONDE");
    }
  }

  return { empresaId: manifiesto.empresaId, usuariosEnBase };
}

/**
 * Punto 5 (segunda correccion): "Distinguí los usuarios que deben
 * existir al iniciar la validación de los que pueden faltar durante la
 * limpieza." -- verificarCorrespondenciaManifiesto() de arriba es
 * TOLERANTE a propósito (la limpieza la necesita tolerante), asi que el
 * chequeo ESTRICTO de "los 4 tienen que estar" es una funcion aparte,
 * para que solo el validador (al empezar, antes de mutar nada) lo exija.
 * Nunca toca la base -- opera sobre el resultado que ya devolvio
 * verificarCorrespondenciaManifiesto().
 */
export function verificarTodosPresentes(
  resultado: ResultadoCorrespondencia,
  manifiesto: ManifiestoPrueba,
  contexto: string,
): void {
  const idsEnBase = new Set(resultado.usuariosEnBase.map((u) => u.id));
  const faltantes = SUFIJOS_USUARIO.filter((s) => !idsEnBase.has(manifiesto.usuarios[s].id));
  if (faltantes.length > 0) {
    logError(contexto, "USUARIOS_FALTANTES_AL_INICIAR_VALIDACION");
    throw new Error("USUARIOS_FALTANTES_AL_INICIAR_VALIDACION");
  }
}
