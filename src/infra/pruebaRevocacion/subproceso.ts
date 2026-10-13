// Infraestructura (solo para las herramientas de scripts/) -- punto 3
// de la tercera correccion de Alex (2026-10-04, revision de la version
// c): "Para Prisma, evitá depender de ejecutar un .cmd mediante
// execFileSync. Preferí process.execPath con la entrada JavaScript del
// Prisma instalado localmente, manteniendo cwd y --schema explícitos.
// Prepará una comprobación inocua de lanzamiento con --version,
// separada de cualquier migración."
//
// La version anterior elegia "npx" o "npx.cmd" segun la plataforma y
// dejaba que PATH/el shell resolviera el ejecutable -- Alex senalo que
// eso sigue dependiendo de la resolucion de un .cmd (asociaciones de
// extension de Windows, PATHEXT, si npx esta instalado globalmente o
// solo como devDependency, etc.), algo que este puente no puede
// verificar de verdad sin una maquina Windows. La alternativa elegida
// evita todo eso: en vez de pedirle al sistema que encuentre y lance
// "npx", se resuelve DIRECTAMENTE el archivo .js que es la entrada de
// la CLI de Prisma ya instalada en node_modules (leyendo el campo
// "bin" de prisma/package.json, nunca una ruta fija adivinada -- ese
// campo puede cambiar entre versiones de Prisma) y se lo ejecuta con
// "process.execPath" (el mismo binario de Node que esta corriendo este
// proceso). Node siempre sabe ejecutar un .js propio, en cualquier
// plataforma, sin pasar por PATH ni por ninguna asociacion de
// extension -- por eso esto es mas robusto que depender de "npx"/
// "npx.cmd" en Windows.
//
// "--schema" sigue siendo explicito con una ruta absoluta (nunca
// relativo a la carpeta de trabajo de quien corre el script) y "cwd"
// sigue fijado al directorio del proyecto, por la misma razon que
// antes: que "prisma migrate deploy" nunca dependa de desde donde se
// invoco ni del auto-descubrimiento de schema.prisma de Prisma.
//
// verificarLanzamientoPrisma() es la "comprobacion inocua" pedida:
// corre el mismo mecanismo de resolucion + process.execPath pero con
// "--version" en vez de "migrate deploy --schema ...", asi que nunca
// toca ninguna base de datos ni requiere ENTORNO_PRUEBA_CONFIRMADO --
// sirve para que Alex confirme en Windows que el lanzamiento en si
// funciona, ANTES de confiar en el lanzamiento real de la migracion.
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { logError } from "../log";

export interface OpcionesMigrateDeploy {
  directorioProyecto: string;
  rutaEsquema: string;
}

type StdioModo = "inherit" | "pipe";

type FuncionExecFileSync = (
  comando: string,
  args: string[],
  opciones: { cwd: string; stdio: StdioModo },
) => Buffer | string;

export interface DependenciasResolucionCliPrisma {
  // Equivalente a createRequire(import.meta.url).resolve -- inyectado
  // para que las pruebas nunca tengan que depender de la resolucion
  // real de node_modules.
  resolverPackageJson: (especificador: string) => string;
  leerArchivo: (ruta: string) => string;
}

function dependenciasRealesResolucionCliPrisma(): DependenciasResolucionCliPrisma {
  const requerir = createRequire(import.meta.url);
  return {
    resolverPackageJson: (especificador) => requerir.resolve(especificador),
    leerArchivo: (ruta) => readFileSync(ruta, "utf-8"),
  };
}

/**
 * Resuelve la ruta absoluta del archivo .js que es la entrada de la
 * CLI de Prisma instalada localmente (node_modules/prisma), leyendo el
 * campo "bin" de su propio package.json -- nunca una ruta adivinada o
 * fija, para no quedar desactualizado si una futura version de Prisma
 * cambia su estructura interna.
 */
export function resolverEntradaCliPrisma(
  contexto: string,
  deps: DependenciasResolucionCliPrisma = dependenciasRealesResolucionCliPrisma(),
): string {
  try {
    const rutaPackageJson = deps.resolverPackageJson("prisma/package.json");
    const contenido = deps.leerArchivo(rutaPackageJson);
    const paquete = JSON.parse(contenido) as { bin?: Record<string, string> | string };
    const binRelativo = typeof paquete.bin === "string" ? paquete.bin : paquete.bin?.prisma;
    if (!binRelativo) {
      throw new Error("bin.prisma ausente en prisma/package.json");
    }
    return join(dirname(rutaPackageJson), binRelativo);
  } catch {
    // catch SIN binding -- nunca reenvia el error real (que podria
    // incluir rutas del sistema de archivos del usuario).
    logError(contexto, "ERROR_RESOLUCION_CLI_PRISMA");
    throw new Error("ERROR_RESOLUCION_CLI_PRISMA");
  }
}

export function ejecutarMigrateDeploy(
  opciones: OpcionesMigrateDeploy,
  contexto: string,
  ejecutar: FuncionExecFileSync = execFileSync as unknown as FuncionExecFileSync,
  resolverEntrada: (contexto: string) => string = resolverEntradaCliPrisma,
): void {
  const rutaCli = resolverEntrada(contexto);
  try {
    ejecutar(process.execPath, [rutaCli, "migrate", "deploy", "--schema", opciones.rutaEsquema], {
      cwd: opciones.directorioProyecto,
      stdio: "inherit",
    });
  } catch {
    // catch SIN binding -- "stdio: inherit" ya muestra la salida real de
    // Prisma en la terminal de quien corre esto; nunca se reenvia nada
    // mas aca, solo un codigo fijo.
    logError(contexto, "ERROR_MIGRATE_DEPLOY");
    throw new Error("ERROR_MIGRATE_DEPLOY");
  }
}

/**
 * Comprobacion INOCUA de lanzamiento: el mismo mecanismo de resolucion
 * + process.execPath, pero con "--version" -- nunca toca una base de
 * datos, nunca requiere --schema ni ENTORNO_PRUEBA_CONFIRMADO. Pensada
 * para validar en Windows que el lanzamiento en si funciona, separada
 * de cualquier migracion real.
 */
export function verificarLanzamientoPrisma(
  contexto: string,
  ejecutar: FuncionExecFileSync = execFileSync as unknown as FuncionExecFileSync,
  resolverEntrada: (contexto: string) => string = resolverEntradaCliPrisma,
): string {
  const rutaCli = resolverEntrada(contexto);
  try {
    const salida = ejecutar(process.execPath, [rutaCli, "--version"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    return salida.toString();
  } catch {
    // catch SIN binding -- misma razon que en ejecutarMigrateDeploy.
    logError(contexto, "ERROR_VERIFICACION_LANZAMIENTO_PRISMA");
    throw new Error("ERROR_VERIFICACION_LANZAMIENTO_PRISMA");
  }
}
