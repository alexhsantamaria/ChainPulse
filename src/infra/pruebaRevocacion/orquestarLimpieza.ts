// Orquestacion de scripts/limpiarPruebaRevocacionAislada.ts (Alex,
// 2026-10-04, extraida para poder probarla con vitest -- punto 2 de la
// segunda correccion).
//
// Punto 1 (segunda correccion): "La correspondencia y las
// comprobaciones deben estar dentro de la transacción de borrado, con
// protección frente a cambios concurrentes" -- verificarCorrespondencia
// Manifiesto() Y verificarSinDatosRelacionadosInesperados() (cascadas)
// corren DENTRO de la misma $transaction que hace el borrado, usando
// "tx" -- nunca el cliente de afuera. "Borrar explícitamente la empresa
// no evita sus cascadas": por eso el chequeo de cascadas (relaciones
// CASCADE/SET NULL desde Empresa/Usuario) corre ANTES de borrar nada, y
// la empresa solo se borra despues de confirmar -- explicitamente,
// dentro de la misma transaccion -- que no quedo ningun usuario bajo
// ella.
//
// CORRECCION (Alex, 2026-10-04, punto 2 de la tercera correccion):
// "Estar dentro de una transacción sin más no demuestra esa
// proteccion" -- estar dentro de UNA transaccion no alcanza bajo el
// nivel de aislamiento DEFAULT de Postgres (READ COMMITTED), que no
// protege una secuencia de "comprobar y despues actuar" frente a una
// transaccion concurrente que confirma algo entre el chequeo y el
// borrado. Por eso esta transaccion ahora pide EXPLICITAMENTE
// aislamiento SERIALIZABLE (NIVEL_AISLAMIENTO_SERIALIZABLE, mas abajo)
// -- ver el comentario de cabecera completo del mecanismo (SSI de
// Postgres, serialization_failure/40001) en
// src/infra/pruebaRevocacion/eliminarUsuarioProtegido.ts, que
// implementa la misma proteccion para el Escenario C de la validacion.
// Sin reintento automatico (fuera de alcance de esta correccion): un
// serialization_failure real se colapsa en el mismo ERROR_TRANSACCION_
// LIMPIEZA de siempre, dejando el manifiesto intacto para reintentar.
import { logError } from "../log";
// "Serializable" como string literal, no Prisma.TransactionIsolation
// Level.Serializable -- ese enum lo genera "prisma generate", que esta
// sesion no puede correr (red bloqueada); el string es exactamente el
// mismo valor en runtime (ver la nota completa en
// eliminarUsuarioProtegido.ts).
import { NIVEL_AISLAMIENTO_SERIALIZABLE } from "./eliminarUsuarioProtegido";
import {
  ROL_ADMIN_ESPERADO,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexion,
  type ClienteSoloLecturaRol,
} from "./destinoPrueba";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "./clientePrueba";
import { leerManifiesto as leerManifiestoReal, borrarManifiesto as borrarManifiestoReal } from "./manifiestoIO";
import { verificarCorrespondenciaManifiesto } from "./correspondenciaManifiesto";
import { verificarSinDatosRelacionadosInesperados } from "./relacionesCascada";
import { SUFIJOS_USUARIO, type ManifiestoPrueba } from "./manifiesto";

export interface ClienteLimpieza extends ClienteSoloLecturaRol {
  $disconnect(): Promise<void>;
}

export interface DependenciasLimpieza {
  seedDatabaseUrl: string | undefined;
  construirAdmin(cadenaConexion: string): ClientePrueba;
  desconectar(cliente: ClientePrueba): Promise<void>;
  leerManifiesto(ruta: string): ManifiestoPrueba;
  borrarManifiesto(ruta: string): boolean;
}

export function dependenciasRealesLimpieza(): DependenciasLimpieza {
  return {
    seedDatabaseUrl: process.env.SEED_DATABASE_URL,
    construirAdmin: (cs) => construirClientePrueba(cs, "limpiar:admin"),
    desconectar: (c) => desconectarClientePrueba(c, "limpiar:desconexion"),
    leerManifiesto: (ruta) => leerManifiestoReal(ruta, "limpiar:manifiesto"),
    borrarManifiesto: (ruta) => borrarManifiestoReal(ruta, "limpiar:manifiesto"),
  };
}

export type ResultadoLimpieza =
  | { ok: true; cantidadBorrada: number; manifiestoBorrado: boolean; rutaManifiesto: string }
  | { ok: false; motivo: "ERROR_TRANSACCION_LIMPIEZA" };

export async function orquestarLimpieza(
  rutaManifiesto: string,
  deps: DependenciasLimpieza = dependenciasRealesLimpieza(),
): Promise<ResultadoLimpieza> {
  const destino = resumenUrl("SEED_DATABASE_URL", deps.seedDatabaseUrl);
  exigirEntornoConfirmado(destino);

  const manifiesto = deps.leerManifiesto(rutaManifiesto);
  const idsManifiesto = SUFIJOS_USUARIO.map((s) => manifiesto.usuarios[s].id);

  const prismaAdmin = deps.construirAdmin(deps.seedDatabaseUrl as string);

  // El rechazo del destino/rol NUNCA se convierte en el resultado suave
  // de mas abajo (ERROR_TRANSACCION_LIMPIEZA) -- se relanza tal cual.
  try {
    const rol = await verificarRolConexion(prismaAdmin, "limpiar:rol", ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(rol, destino, "limpiar:rol");
  } catch (e) {
    await deps.desconectar(prismaAdmin);
    throw e;
  }

  let cantidadBorrada = 0;
  try {
    await prismaAdmin.$transaction(
      async (tx: ClientePrueba) => {
        // Punto 1: correspondencia y cascadas DENTRO de la transaccion --
        // si algo cambio desde que se leyo el manifiesto (otra corrida,
        // datos inesperados agregados mientras tanto), esto lo ve con la
        // misma instantanea desde la que se va a borrar, no con una
        // comprobacion ya desactualizada hecha afuera.
        await verificarCorrespondenciaManifiesto(tx, manifiesto, destino, "limpiar:correspondencia");
        await verificarSinDatosRelacionadosInesperados(tx, manifiesto.empresaId, idsManifiesto, "limpiar:cascadas");

        const resultado = await tx.usuario.deleteMany({
          where: { id: { in: idsManifiesto }, empresaId: manifiesto.empresaId },
        });
        cantidadBorrada = resultado.count;

        // Nunca confiar en "onDelete: Cascade" para esto -- se verifica de
        // forma explicita, DENTRO de la misma transaccion, que no quede
        // ningun usuario bajo esta empresa antes de borrarla.
        const restantes = await tx.usuario.count({ where: { empresaId: manifiesto.empresaId } });
        if (restantes > 0) {
          throw new Error("USUARIOS_RESTANTES_TRAS_BORRADO");
        }

        await tx.empresa.delete({ where: { id: manifiesto.empresaId } });
      },
      { isolationLevel: NIVEL_AISLAMIENTO_SERIALIZABLE },
    );
  } catch {
    // catch SIN binding -- la transaccion completa no tuvo efecto
    // (atomica): no se perdio ningun dato a medio borrar, y el
    // manifiesto no se toca (se conserva para reintentar).
    logError("limpiar:transaccion", "ERROR_TRANSACCION_LIMPIEZA");
    await deps.desconectar(prismaAdmin);
    return { ok: false, motivo: "ERROR_TRANSACCION_LIMPIEZA" };
  }

  await deps.desconectar(prismaAdmin);

  // Solo se llega aca si la transaccion de arriba tuvo exito -- recien
  // entonces se intenta borrar el archivo del manifiesto. Si ESE borrado
  // falla, los datos de prueba YA fueron eliminados de la base --
  // manifiestoBorrado:false simplemente le dice a quien corrio el
  // script que borre el archivo a mano, nunca se interpreta como que la
  // limpieza de la base fallo.
  const manifiestoBorrado = deps.borrarManifiesto(rutaManifiesto);
  return { ok: true, cantidadBorrada, manifiestoBorrado, rutaManifiesto };
}
