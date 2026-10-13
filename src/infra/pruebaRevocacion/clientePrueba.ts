// Infraestructura (solo para las herramientas de scripts/) -- punto 2
// de la segunda correccion de Alex: "Cubrí también errores de ...
// construcción/desconexión de clientes". Construir un PrismaClient con
// el adaptador rara vez tira sincronicamente (la conexion real se abre
// recien con la primera consulta), pero se envuelve igual -- nunca debe
// llegar un error real de Postgres/pg hasta el logger o hasta el
// manejador final de un script.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logError } from "../log";

// (prisma generate bloqueado por la politica de red del entorno): estas
// herramientas necesitan acceso generico a $queryRaw, $transaction y a
// los modelos (usuario, empresa, eslabon, ...) sin que TypeScript pueda
// inferir esos tipos sin ese paso.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de cabecera de tenantClient.ts
export type ClientePrueba = any;

export function construirClientePrueba(connectionString: string, contexto: string): ClientePrueba {
  try {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  } catch {
    // catch SIN binding -- la cadena de conexion (con la password) podria
    // aparecer en un error de construccion mal formado.
    logError(contexto, "ERROR_CONSTRUCCION_CLIENTE");
    throw new Error("ERROR_CONSTRUCCION_CLIENTE");
  }
}

/**
 * Desconectar es best-effort a proposito: para el momento en que esto
 * corre, la operacion principal ya temino (bien o mal) -- un fallo al
 * desconectar nunca debe tapar ni reemplazar ese resultado real. Se
 * registra con un codigo fijo y se sigue, nunca se relanza.
 */
export async function desconectarClientePrueba(cliente: { $disconnect(): Promise<void> }, contexto: string): Promise<void> {
  try {
    await cliente.$disconnect();
  } catch {
    logError(contexto, "ERROR_DESCONEXION_CLIENTE");
  }
}
