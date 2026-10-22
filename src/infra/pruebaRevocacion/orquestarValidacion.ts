// Orquestacion de scripts/validarRevocacionEntornoPrueba.ts (Alex,
// 2026-10-04, extraida para poder probarla con vitest -- punto 2 de la
// segunda correccion). Usa las funciones REALES de
// src/infra/auth/sessionVerification.ts y el tenantClient() REAL (nunca
// inyectados: son justamente lo que este script existe para ejercitar
// contra un entorno real; las pruebas los mockean a nivel de modulo,
// igual que src/infra/auth/__tests__/sessionVerification.test.ts). Lo
// que SI se inyecta es la conexion de solo-rol y la lectura del
// manifiesto, para poder probar la orquestacion (orden, aborto antes de
// mutar, conteo dinamico) sin tocar Postgres ni el disco real.
//
// Punto 5 (segunda correccion): "Si falla una precondición del
// validador, abortá antes de realizar más mutaciones" -- las dos
// comprobaciones del Escenario A (antes de mutar A1 en el B) y la
// primera del Escenario D (antes de mutar A4) son PRECONDICIONES: si
// fallan, se aborta de inmediato, antes de la mutacion que depende de
// ellas. Las demas (post-mutacion: B, C, D-segunda-mitad, E) solo se
// registran -- son el propio resultado que se esta validando, abortar
// ahi no evitaria ninguna mutacion adicional.
//
// "Distinguí los usuarios que deben existir al iniciar la validación de
// los que pueden faltar durante la limpieza" -- verificarTodosPresentes
// (estricta) se exige aca, al EMPEZAR, antes de cualquier escenario;
// verificarCorrespondenciaManifiesto (tolerante) sigue siendo la que
// usa tambien la limpieza.
//
// Punto 1 (segunda correccion): antes de eliminar un usuario (Escenario
// C borra a A3), se verifica que no haya relaciones que cascadearian
// desde el (ver relacionesCascada.ts) -- igual criterio que la limpieza,
// aca acotado al usuario que se va a borrar.
//
// Punto 2 (tercera correccion): el Escenario C ya NO hace el chequeo de
// cascadas y el delete() como dos llamadas separadas via tenantClient()
// (que envuelve CADA llamada en su PROPIA transaccion -- ver
// src/infra/prisma/tenantClient.ts, nunca compartio una transaccion
// entre ambas). Usa eliminarUsuarioConProteccionConcurrente() (ver su
// comentario de cabecera para el mecanismo completo: aislamiento
// SERIALIZABLE/SSI), que corre el chequeo y el borrado como UNA sola
// transaccion explicita.
//
// CORRECCION (Alex, 2026-10-04, revision de la version d): "La prueba
// concurrente no ejercita ... incluido el caso de referencias desde
// otra empresa que RLS podría ocultar al rol de aplicación" -- la
// investigacion de ese punto encontro que eliminarUsuarioConProteccion
// Concurrente() estaba conectado por el rol EQUIVOCADO (prismaApp,
// chainpulse_app, sujeto a RLS) para un chequeo que necesita ver
// referencias de OTRA empresa (ver la PARTE 1 del comentario de
// cabecera de eliminarUsuarioProtegido.ts para la evidencia completa:
// migracion real + schema.prisma + GRANTs). La correccion agrega una
// SEGUNDA conexion, admin (SEED_DATABASE_URL/neondb_owner, el mismo rol
// que ya usa orquestarLimpieza.ts para este mismo chequeo, dueño de las
// tablas y por lo tanto exento de RLS), y Escenario C ahora pasa esa
// conexion admin, nunca prismaApp. El chequeo de destino-coincidente
// entre DATABASE_URL y SEED_DATABASE_URL replica el mismo patron ya
// usado en orquestarAplicarMigracion.ts (DESTINO_INESPERADO). prismaApp
// vuelve a desconectarse justo despues de su propio chequeo de rol (ya
// no necesita quedar abierto: Escenario C usa prismaAdmin); prismaAdmin
// es el que queda abierto hasta el final (try/finally), porque Escenario
// C lo reutiliza.
import { logError } from "../log";
import { eliminarUsuarioConProteccionConcurrente } from "./eliminarUsuarioProtegido";
import { tenantClient } from "../prisma/tenantClient";
import { leerSessionVersionParaLogin, verificarSesionVigente } from "../auth/sessionVerification";
import {
  ROL_ADMIN_ESPERADO,
  ROL_APP_ESPERADO,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexion,
  verificarRolConexionAdministrativa,
  type ClienteSoloLecturaRol,
} from "./destinoPrueba";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "./clientePrueba";
import { leerManifiesto as leerManifiestoReal } from "./manifiestoIO";
import { verificarCorrespondenciaManifiesto, verificarTodosPresentes } from "./correspondenciaManifiesto";
import type { ManifiestoPrueba } from "./manifiesto";

export interface ClienteValidacionApp extends ClienteSoloLecturaRol {
  $disconnect(): Promise<void>;
}

export interface ClienteValidacionAdmin extends ClienteSoloLecturaRol {
  $disconnect(): Promise<void>;
  // Punto 2 (tercera correccion), rol corregido (revision de la version
  // d): necesario para que Escenario C comparta UNA transaccion
  // explicita (via eliminarUsuarioConProteccionConcurrente()) entre el
  // chequeo de cascadas y el borrado -- nunca llamadas separadas via
  // tenantClient(). Esta conexion es SIEMPRE la admin (neondb_owner) --
  // ver la PARTE 1 del comentario de cabecera de
  // eliminarUsuarioProtegido.ts. "unknown" a proposito: el valor real es
  // NIVEL_AISLAMIENTO_SERIALIZABLE (ver eliminarUsuarioProtegido.ts),
  // pero esta interfaz no necesita atarse a ese literal.
  $transaction(fn: (tx: ClientePrueba) => Promise<void>, opciones: { isolationLevel: unknown }): Promise<void>;
}

export interface DependenciasValidacion {
  databaseUrl: string | undefined;
  seedDatabaseUrl: string | undefined;
  construirApp(cadenaConexion: string): ClienteValidacionApp;
  construirAdmin(cadenaConexion: string): ClienteValidacionAdmin;
  desconectarApp(cliente: ClienteValidacionApp): Promise<void>;
  desconectarAdmin(cliente: ClienteValidacionAdmin): Promise<void>;
  leerManifiesto(ruta: string): ManifiestoPrueba;
}

export function dependenciasRealesValidacion(): DependenciasValidacion {
  return {
    databaseUrl: process.env.DATABASE_URL,
    seedDatabaseUrl: process.env.SEED_DATABASE_URL,
    construirApp: (cs) => construirClientePrueba(cs, "validar:app") as ClientePrueba,
    construirAdmin: (cs) => construirClientePrueba(cs, "validar:admin") as ClientePrueba,
    desconectarApp: (c) => desconectarClientePrueba(c, "validar:desconexion-app"),
    desconectarAdmin: (c) => desconectarClientePrueba(c, "validar:desconexion-admin"),
    leerManifiesto: (ruta) => leerManifiestoReal(ruta, "validar:manifiesto"),
  };
}

export interface ResultadoComprobacion {
  nombre: string;
  paso: boolean;
}

export interface ResultadoValidacion {
  comprobaciones: ResultadoComprobacion[];
}

export async function orquestarValidacion(
  rutaManifiesto: string,
  deps: DependenciasValidacion = dependenciasRealesValidacion(),
): Promise<ResultadoValidacion> {
  const destinoApp = resumenUrl("DATABASE_URL", deps.databaseUrl);
  const destinoAdmin = resumenUrl("SEED_DATABASE_URL", deps.seedDatabaseUrl);
  if (
    destinoApp.host !== destinoAdmin.host ||
    destinoApp.puerto !== destinoAdmin.puerto ||
    destinoApp.base !== destinoAdmin.base ||
    destinoApp.esquema !== destinoAdmin.esquema
  ) {
    logError("validar", "DESTINO_INESPERADO");
    throw new Error("DESTINO_INESPERADO -- DATABASE_URL y SEED_DATABASE_URL apuntan a destinos distintos.");
  }
  exigirEntornoConfirmado(destinoApp);

  const manifiesto = deps.leerManifiesto(rutaManifiesto);
  const { empresaId, usuarios } = manifiesto;

  // prismaApp solo existe para confirmar que la conexion de aplicacion
  // (DATABASE_URL) efectivamente es chainpulse_app -- ya NO se reutiliza
  // para ninguna transaccion (ver correccion de cabecera): se desconecta
  // apenas termina este chequeo.
  const prismaApp = deps.construirApp(deps.databaseUrl as string);
  try {
    const rolApp = await verificarRolConexion(prismaApp, "validar:app", ROL_APP_ESPERADO);
    verificarDestinoEfectivo(rolApp, destinoApp, "validar:app");
  } finally {
    await deps.desconectarApp(prismaApp);
  }

  const prismaAdmin = deps.construirAdmin(deps.seedDatabaseUrl as string);
  try {
    const rolAdmin = await verificarRolConexionAdministrativa(prismaAdmin, "validar:admin", ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(rolAdmin, destinoAdmin, "validar:admin");

    const clienteTenant = tenantClient(empresaId);

    const correspondencia = await verificarCorrespondenciaManifiesto(
      clienteTenant,
      manifiesto,
      { host: destinoApp.host, base: destinoApp.base },
      "validar:correspondencia",
    );
    // Punto 5: estricto al EMPEZAR -- los 4 tienen que existir todavia.
    verificarTodosPresentes(correspondencia, manifiesto, "validar:precondicion");

    const comprobaciones: ResultadoComprobacion[] = [];
    function comprobar(nombre: string, condicion: boolean) {
      comprobaciones.push({ nombre, paso: condicion });
    }
    function comprobarYExigir(nombre: string, condicion: boolean, codigoSiFalla: string) {
      comprobaciones.push({ nombre, paso: condicion });
      if (!condicion) {
        logError("validar:precondicion", codigoSiFalla);
        throw new Error(codigoSiFalla);
      }
    }

    // --- Escenario A -- sesion vigente (A1, recien sembrado, claim=1) --
    // PRECONDICION del Escenario B: si esto no es lo esperado, abortar
    // antes de mutar sessionVersion de A1.
    const v1 = await leerSessionVersionParaLogin(usuarios.a1.id, empresaId);
    comprobarYExigir(
      "leerSessionVersionParaLogin(A1) devuelve 1 (valor real, recien sembrado)",
      v1 === 1,
      "PRECONDICION_ESCENARIO_A_FALLO",
    );
    const r1 = await verificarSesionVigente(usuarios.a1.id, empresaId, 1);
    comprobarYExigir(
      "verificarSesionVigente(A1, claim=1) -- vigente",
      r1.vigente === true,
      "PRECONDICION_ESCENARIO_A_FALLO",
    );

    // --- Escenario B -- sesion revocada (se sube sessionVersion de A1 a 2) ---
    try {
      await clienteTenant.usuario.update({ where: { id: usuarios.a1.id }, data: { sessionVersion: 2 } });
    } catch {
      logError("validar:escenarioB", "ERROR_MUTACION_ESCENARIO_B");
      throw new Error("ERROR_MUTACION_ESCENARIO_B");
    }
    const r2 = await verificarSesionVigente(usuarios.a1.id, empresaId, 1); // JWT viejo, claim todavia en 1
    comprobar(
      "verificarSesionVigente(A1, claim=1) tras subir la version real a 2 -- REVOCADA",
      r2.vigente === false && (r2 as { motivo?: string }).motivo === "REVOCADA",
    );

    // --- Escenario C -- usuario eliminado (se borra A3) ---
    // Punto 1 Y punto 2 (tercera correccion), rol corregido (revision de
    // la version d): chequeo de cascadas Y borrado como UNA transaccion
    // SERIALIZABLE explicita, SIEMPRE sobre prismaAdmin -- nunca
    // prismaApp (sujeto a RLS, invisible a referencias de otra empresa)
    // ni clienteTenant()/tenantClient() (cada llamada en su propia
    // transaccion). Ver el comentario de cabecera de este archivo y el
    // de eliminarUsuarioProtegido.ts para el detalle completo.
    await eliminarUsuarioConProteccionConcurrente(prismaAdmin, empresaId, usuarios.a3.id, "validar:escenarioC");
    const r3 = await verificarSesionVigente(usuarios.a3.id, empresaId, 1);
    comprobar(
      "verificarSesionVigente(A3) tras eliminarlo -- ELIMINADA",
      r3.vigente === false && (r3 as { motivo?: string }).motivo === "ELIMINADA",
    );

    // --- Escenario D -- JWT viejo sin claim (A4) ---
    const r4a = await verificarSesionVigente(usuarios.a4.id, empresaId, undefined);
    comprobarYExigir(
      "verificarSesionVigente(A4, claim=undefined) con sessionVersion=1 real -- vigente",
      r4a.vigente === true,
      "PRECONDICION_ESCENARIO_D_FALLO",
    );
    try {
      await clienteTenant.usuario.update({ where: { id: usuarios.a4.id }, data: { sessionVersion: 2 } });
    } catch {
      logError("validar:escenarioD", "ERROR_MUTACION_ESCENARIO_D");
      throw new Error("ERROR_MUTACION_ESCENARIO_D");
    }
    const r4b = await verificarSesionVigente(usuarios.a4.id, empresaId, undefined);
    comprobar(
      "verificarSesionVigente(A4, claim=undefined) tras subir la version real a 2 -- REVOCADA " +
        "(un login nuevo no sustituye esta prueba)",
      r4b.vigente === false && (r4b as { motivo?: string }).motivo === "REVOCADA",
    );

    // --- Escenario E -- aislamiento (A2 nunca tocado) ---
    const r5 = await verificarSesionVigente(usuarios.a2.id, empresaId, 1);
    comprobar(
      "verificarSesionVigente(A2, claim=1) -- vigente, sin efecto de lo hecho a los otros usuarios de prueba",
      r5.vigente === true,
    );

    return { comprobaciones };
  } finally {
    await deps.desconectarAdmin(prismaAdmin);
  }
}
