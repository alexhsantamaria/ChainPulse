// Orquestacion de scripts/verificarColumnaSessionVersionEntornoPrueba.ts
// (Alex, 2026-10-04, punto 2 de la segunda correccion: extraido para
// poder probarlo con vitest).
//
// Punto 4 (segunda correccion): "filtrá por el esquema esperado" --
// information_schema.columns sin filtro de esquema podria, en teoria,
// encontrar una tabla "usuarios" en otro esquema dentro de la misma
// base y confundir el resultado; ahora se filtra por el esquema que
// resumenUrl() resolvio de la propia DATABASE_URL (table_schema).
// "comprobá exactamente el default equivalente a 1; no uses includes"
// -- la migracion agrega la columna como "INTEGER NOT NULL DEFAULT 1"
// (ver prisma/migrations/20261003080000_.../migration.sql), que Postgres
// reporta en information_schema.columns.column_default como el literal
// exacto "1" (sin cast, al ser ya del mismo tipo que la columna) --
// ".includes('1')" tambien aceptaria, por ejemplo, un default de "10" o
// "21" por error; se compara por igualdad exacta (recortando espacios).
import { logError } from "../log";
import {
  ROL_APP_ESPERADO,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexion,
  type ClienteSoloLecturaRol,
} from "./destinoPrueba";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "./clientePrueba";

export interface ClienteVerificarColumna extends ClienteSoloLecturaRol {
  $disconnect(): Promise<void>;
}

export interface DependenciasVerificarColumna {
  databaseUrl: string | undefined;
  construirApp(cadenaConexion: string): ClienteVerificarColumna;
  desconectar(cliente: ClienteVerificarColumna): Promise<void>;
}

export function dependenciasRealesVerificarColumna(): DependenciasVerificarColumna {
  return {
    databaseUrl: process.env.DATABASE_URL,
    construirApp: (cs) => construirClientePrueba(cs, "verificar-columna") as ClientePrueba,
    desconectar: (c) => desconectarClientePrueba(c, "verificar-columna:desconexion"),
  };
}

interface FilaColumna {
  data_type: string;
  column_default: string | null;
  is_nullable: "YES" | "NO";
}

export const DEFAULT_ESPERADO = "1";

export async function orquestarVerificarColumna(
  deps: DependenciasVerificarColumna = dependenciasRealesVerificarColumna(),
): Promise<FilaColumna> {
  const destino = resumenUrl("DATABASE_URL", deps.databaseUrl);
  exigirEntornoConfirmado(destino);

  const prismaApp = deps.construirApp(deps.databaseUrl as string);
  try {
    const rol = await verificarRolConexion(prismaApp, "verificar-columna", ROL_APP_ESPERADO);
    verificarDestinoEfectivo(rol, destino, "verificar-columna");

    let filas: FilaColumna[];
    try {
      filas = await prismaApp.$queryRaw<FilaColumna[]>`
        SELECT data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${destino.esquema} AND table_name = 'usuarios' AND column_name = 'sessionVersion'
      `;
    } catch {
      logError("verificar-columna", "ERROR_CONSULTA_COLUMNA");
      throw new Error("ERROR_CONSULTA_COLUMNA");
    }

    const fila = filas[0];
    if (!fila) {
      logError("verificar-columna", "COLUMNA_INEXISTENTE");
      throw new Error('COLUMNA_INEXISTENTE -- "sessionVersion" no existe todavia en "usuarios" en este esquema/entorno.');
    }
    if (fila.data_type !== "integer") {
      logError("verificar-columna", "TIPO_DE_COLUMNA_INESPERADO");
      throw new Error(`TIPO_DE_COLUMNA_INESPERADO -- se esperaba "integer", la base tiene "${fila.data_type}".`);
    }
    if (fila.is_nullable !== "NO") {
      logError("verificar-columna", "COLUMNA_NULEABLE_INESPERADA");
      throw new Error("COLUMNA_NULEABLE_INESPERADA -- se esperaba NOT NULL.");
    }
    if (fila.column_default === null || fila.column_default.trim() !== DEFAULT_ESPERADO) {
      logError("verificar-columna", "DEFAULT_INESPERADO");
      throw new Error(`DEFAULT_INESPERADO -- se esperaba exactamente "${DEFAULT_ESPERADO}", la base tiene "${fila.column_default}".`);
    }

    return fila;
  } finally {
    await deps.desconectar(prismaApp);
  }
}
