// Orquestacion de scripts/verificacionSoloLecturaEntornoPrueba.ts --
// extraida a este modulo (Alex, 2026-10-04, punto 2 de la segunda
// correccion: "Agregá pruebas de estos caminos de los scripts, no solo
// de los módulos auxiliares") para poder probarla con vitest, que no
// recorre "scripts/" (ver vitest.config.ts). El script en si queda como
// un envoltorio fino: arma las dependencias reales y llama a esto.
//
// Dependencias inyectables -- en produccion (el script real) usan
// PrismaClient/fs reales; las pruebas inyectan mocks sin tocar ninguna
// conexion ni archivo real.
import { logError } from "../log";
import {
  ROL_ADMIN_ESPERADO,
  ROL_APP_ESPERADO,
  evaluarEstadoMigraciones,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexion,
  verificarRolConexionAdministrativa,
  type ClienteSoloLecturaRol,
  type EstadoMigraciones,
  type FilaMigracion,
  type InfoDestino,
} from "./destinoPrueba";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "./clientePrueba";
import { migracionesEnRepo as migracionesEnRepoReal } from "./archivoProyecto";

export const MIGRACION_ESPERADA = "20261003080000_incremento_revocacion_sesion";

export interface ClienteDiagnostico extends ClienteSoloLecturaRol {
  $disconnect(): Promise<void>;
}

export interface DependenciasDiagnostico {
  databaseUrl: string | undefined;
  seedDatabaseUrl: string | undefined;
  construirApp(cadenaConexion: string): ClienteDiagnostico;
  construirAdmin(cadenaConexion: string): ClienteDiagnostico;
  desconectar(cliente: ClienteDiagnostico): Promise<void>;
  migracionesEnRepo(): string[];
}

export function dependenciasRealesDiagnostico(): DependenciasDiagnostico {
  return {
    databaseUrl: process.env.DATABASE_URL,
    seedDatabaseUrl: process.env.SEED_DATABASE_URL,
    construirApp: (cs) => construirClientePrueba(cs, "diagnostico:app") as ClientePrueba,
    construirAdmin: (cs) => construirClientePrueba(cs, "diagnostico:admin") as ClientePrueba,
    desconectar: (c) => desconectarClientePrueba(c, "diagnostico:desconexion"),
    migracionesEnRepo: () => migracionesEnRepoReal("diagnostico:migraciones"),
  };
}

export interface ResultadoDiagnostico {
  destinoApp: InfoDestino;
  destinoAdmin: InfoDestino;
  estado: EstadoMigraciones;
}

export async function orquestarDiagnostico(
  deps: DependenciasDiagnostico = dependenciasRealesDiagnostico(),
): Promise<ResultadoDiagnostico> {
  const destinoApp = resumenUrl("DATABASE_URL", deps.databaseUrl);
  const destinoAdmin = resumenUrl("SEED_DATABASE_URL", deps.seedDatabaseUrl);

  if (
    destinoApp.host !== destinoAdmin.host ||
    destinoApp.puerto !== destinoAdmin.puerto ||
    destinoApp.base !== destinoAdmin.base ||
    destinoApp.esquema !== destinoAdmin.esquema
  ) {
    logError("diagnostico", "DESTINO_INESPERADO");
    throw new Error("DESTINO_INESPERADO -- DATABASE_URL y SEED_DATABASE_URL apuntan a destinos distintos.");
  }

  // Punto 3 (segunda correccion): la confirmacion esta atada al destino
  // EXACTO recien resuelto -- no a un booleano suelto.
  exigirEntornoConfirmado(destinoApp);

  const prismaApp = deps.construirApp(deps.databaseUrl as string);
  const prismaAdmin = deps.construirAdmin(deps.seedDatabaseUrl as string);
  try {
    const rolApp = await verificarRolConexion(prismaApp, "diagnostico:app", ROL_APP_ESPERADO);
    verificarDestinoEfectivo(rolApp, destinoApp, "diagnostico:app");
    const rolAdmin = await verificarRolConexionAdministrativa(prismaAdmin, "diagnostico:admin", ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(rolAdmin, destinoAdmin, "diagnostico:admin");

    let filas: FilaMigracion[];
    try {
      filas = await prismaAdmin.$queryRaw<FilaMigracion[]>`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `;
    } catch {
      // catch SIN binding -- nunca el error real de Postgres.
      logError("diagnostico:migraciones", "ERROR_CONSULTA_MIGRACIONES");
      throw new Error("ERROR_CONSULTA_MIGRACIONES");
    }

    const todasLasMigraciones = deps.migracionesEnRepo();
    const estado = evaluarEstadoMigraciones(filas, todasLasMigraciones);

    if (estado.fallidasOInconclusas.length > 0) {
      logError("diagnostico:migraciones", "MIGRACIONES_FALLIDAS_O_INCONCLUSAS");
      throw new Error(
        "MIGRACIONES_FALLIDAS_O_INCONCLUSAS -- resolvelas a mano (normalmente con \"prisma migrate resolve\") antes de seguir.",
      );
    }
    if (estado.pendientes.length !== 1 || estado.pendientes[0] !== MIGRACION_ESPERADA) {
      logError("diagnostico:migraciones", "MIGRACIONES_PENDIENTES_INESPERADAS");
      throw new Error(
        `MIGRACIONES_PENDIENTES_INESPERADAS -- se esperaba unicamente "${MIGRACION_ESPERADA}" pendiente.`,
      );
    }

    return { destinoApp, destinoAdmin, estado };
  } finally {
    await deps.desconectar(prismaApp);
    await deps.desconectar(prismaAdmin);
  }
}
