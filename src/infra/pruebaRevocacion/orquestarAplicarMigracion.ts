// Orquestacion de scripts/aplicarMigracionEntornoPrueba.ts (Alex,
// 2026-10-04, punto 2 de la segunda correccion: extraido para poder
// probarlo con vitest). Dos autorizaciones DISTINTAS, ninguna sustituye
// a la otra: ENTORNO_PRUEBA_CONFIRMADO (atado al destino exacto, punto
// 3 de la segunda correccion) y AUTORIZO_APLICAR_MIGRACION_PRUEBA
// (autoriza aplicar la migracion pendiente ahi). El subproceso fija
// --schema y cwd de forma explicita, y lanza la CLI de Prisma via
// process.execPath + su entrada JS resuelta localmente, nunca
// execFileSync("npx"/"npx.cmd", ...) (Alex, 2026-10-04, punto 3 de la
// tercera correccion -- ver subproceso.ts).
import { logError } from "../log";
import {
  ROL_ADMIN_ESPERADO,
  ROL_APP_ESPERADO,
  evaluarEstadoMigraciones,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexion,
  type ClienteSoloLecturaRol,
  type FilaMigracion,
} from "./destinoPrueba";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "./clientePrueba";
import { migracionesEnRepo as migracionesEnRepoReal, directorioProyecto, rutaEsquemaPrisma } from "./archivoProyecto";
import { ejecutarMigrateDeploy } from "./subproceso";
import { MIGRACION_ESPERADA } from "./orquestarDiagnostico";

export interface ClienteAplicarMigracion extends ClienteSoloLecturaRol {
  $disconnect(): Promise<void>;
}

export interface DependenciasAplicarMigracion {
  databaseUrl: string | undefined;
  seedDatabaseUrl: string | undefined;
  autorizoAplicarMigracion: string | undefined;
  construirApp(cadenaConexion: string): ClienteAplicarMigracion;
  construirAdmin(cadenaConexion: string): ClienteAplicarMigracion;
  desconectar(cliente: ClienteAplicarMigracion): Promise<void>;
  migracionesEnRepo(): string[];
  ejecutarMigrateDeploy(): void;
}

export function dependenciasRealesAplicarMigracion(): DependenciasAplicarMigracion {
  return {
    databaseUrl: process.env.DATABASE_URL,
    seedDatabaseUrl: process.env.SEED_DATABASE_URL,
    autorizoAplicarMigracion: process.env.AUTORIZO_APLICAR_MIGRACION_PRUEBA,
    construirApp: (cs) => construirClientePrueba(cs, "aplicar-migracion:app") as ClientePrueba,
    construirAdmin: (cs) => construirClientePrueba(cs, "aplicar-migracion:admin") as ClientePrueba,
    desconectar: (c) => desconectarClientePrueba(c, "aplicar-migracion:desconexion"),
    migracionesEnRepo: () => migracionesEnRepoReal("aplicar-migracion:migraciones"),
    ejecutarMigrateDeploy: () =>
      ejecutarMigrateDeploy(
        { directorioProyecto: directorioProyecto(), rutaEsquema: rutaEsquemaPrisma() },
        "aplicar-migracion:subproceso",
      ),
  };
}

export async function orquestarAplicarMigracion(
  deps: DependenciasAplicarMigracion = dependenciasRealesAplicarMigracion(),
): Promise<void> {
  const destinoApp = resumenUrl("DATABASE_URL", deps.databaseUrl);
  const destinoAdmin = resumenUrl("SEED_DATABASE_URL", deps.seedDatabaseUrl);
  if (
    destinoApp.host !== destinoAdmin.host ||
    destinoApp.puerto !== destinoAdmin.puerto ||
    destinoApp.base !== destinoAdmin.base ||
    destinoApp.esquema !== destinoAdmin.esquema
  ) {
    logError("aplicar-migracion", "DESTINO_INESPERADO");
    throw new Error("DESTINO_INESPERADO -- DATABASE_URL y SEED_DATABASE_URL apuntan a destinos distintos.");
  }
  // Punto 2: esta verificacion se repite AQUI, completa, sin depender de
  // que scripts/verificacionSoloLecturaEntornoPrueba.ts se haya corrido
  // antes en esta misma sesion de terminal o en otra.
  exigirEntornoConfirmado(destinoApp);

  const prismaApp = deps.construirApp(deps.databaseUrl as string);
  const prismaAdmin = deps.construirAdmin(deps.seedDatabaseUrl as string);
  try {
    const rolApp = await verificarRolConexion(prismaApp, "aplicar-migracion:app", ROL_APP_ESPERADO);
    verificarDestinoEfectivo(rolApp, destinoApp, "aplicar-migracion:app");
    const rolAdmin = await verificarRolConexion(prismaAdmin, "aplicar-migracion:admin", ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(rolAdmin, destinoAdmin, "aplicar-migracion:admin");

    let filas: FilaMigracion[];
    try {
      filas = await prismaAdmin.$queryRaw<FilaMigracion[]>`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `;
    } catch {
      logError("aplicar-migracion:migraciones", "ERROR_CONSULTA_MIGRACIONES");
      throw new Error("ERROR_CONSULTA_MIGRACIONES");
    }

    const estado = evaluarEstadoMigraciones(filas, deps.migracionesEnRepo());
    if (estado.fallidasOInconclusas.length > 0) {
      logError("aplicar-migracion:migraciones", "MIGRACIONES_FALLIDAS_O_INCONCLUSAS");
      throw new Error("MIGRACIONES_FALLIDAS_O_INCONCLUSAS -- resolvelas a mano antes de aplicar nada mas.");
    }
    if (estado.pendientes.length !== 1 || estado.pendientes[0] !== MIGRACION_ESPERADA) {
      logError("aplicar-migracion:migraciones", "MIGRACIONES_PENDIENTES_INESPERADAS");
      throw new Error(`MIGRACIONES_PENDIENTES_INESPERADAS -- se esperaba unicamente "${MIGRACION_ESPERADA}" pendiente.`);
    }
  } finally {
    await deps.desconectar(prismaApp);
    await deps.desconectar(prismaAdmin);
  }

  if (deps.autorizoAplicarMigracion !== "si") {
    logError("aplicar-migracion", "AUTORIZACION_DE_MIGRACION_FALTANTE");
    throw new Error(
      'AUTORIZACION_DE_MIGRACION_FALTANTE -- fija AUTORIZO_APLICAR_MIGRACION_PRUEBA="si" (distinto de ' +
        "ENTORNO_PRUEBA_CONFIRMADO) para aplicar, despues de revisar lo de arriba.",
    );
  }

  deps.ejecutarMigrateDeploy();
}
