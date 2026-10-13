// Infraestructura (solo para las herramientas de scripts/) -- lectura
// del directorio de migraciones del repo, con manejo de error de
// codigo fijo (Alex, 2026-10-04, punto 2 de la segunda correccion:
// "Cubrí también errores de ... archivos"). Tambien resuelve, de forma
// explicita y centralizada, el directorio del proyecto y la ruta del
// esquema revisado que usa scripts/aplicarMigracionEntornoPrueba.ts
// (punto 6: "Fijá explícitamente el directorio del proyecto y el
// esquema revisado") -- a partir de __dirname de ESTE archivo (siempre
// en "src/infra/pruebaRevocacion/"), nunca de la carpeta de trabajo de
// quien invoca un script.
import { readdirSync } from "fs";
import { join } from "path";
import { logError } from "../log";

// src/infra/pruebaRevocacion/ -> src/infra -> src -> raiz del proyecto.
export function directorioProyecto(): string {
  return join(__dirname, "..", "..", "..");
}

export function rutaEsquemaPrisma(): string {
  return join(directorioProyecto(), "prisma", "schema.prisma");
}

export function migracionesEnRepo(contexto: string): string[] {
  try {
    const carpeta = join(directorioProyecto(), "prisma", "migrations");
    return readdirSync(carpeta).filter((nombre) => nombre !== "migration_lock.toml");
  } catch {
    // catch SIN binding -- no hay nada sensible en esta ruta (es del
    // propio repo), pero se mantiene el mismo criterio en todo
    // pruebaRevocacion/: nunca un error de "fs" sin envolver.
    logError(contexto, "ERROR_LECTURA_CARPETA_MIGRACIONES");
    throw new Error("ERROR_LECTURA_CARPETA_MIGRACIONES");
  }
}
