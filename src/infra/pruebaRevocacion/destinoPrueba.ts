// Infraestructura (solo para las herramientas de scripts/, no usado por
// la app en runtime) -- verificacion de destino y rol de conexion antes
// de CUALQUIER escritura contra un entorno de prueba (Alex, 2026-10-04,
// corregido en tercera ronda). Puro a proposito donde se puede
// (destinoConfirmado, evaluarEstadoMigraciones) para que se pueda probar
// sin mockear Prisma; donde hace falta una consulta real
// (verificarRolConexion) recibe un cliente ya construido en vez de
// construirlo el mismo, para poder inyectar un mock en las pruebas.
//
// Regla dura (punto 2 de la primera correccion): cada script con
// escrituras debe volver a correr esta verificacion el mismo, SIEMPRE,
// nunca asumir que una corrida anterior (de este script o de otro) ya
// lo confirmo.
//
// Punto 3 de la segunda correccion: un booleano "si" suelto no detecta
// un cambio posterior de conexion -- ENTORNO_PRUEBA_CONFIRMADO debe
// contener el destino EXACTO (host, puerto, base y esquema) que la
// persona confirmo, comparado contra el destino efectivamente resuelto
// en ESTA corrida (exigirEntornoConfirmado). Eso solo valida lo que DICE
// la cadena de conexion -- por eso verificarDestinoEfectivo contrasta
// ademas la base/esquema que Postgres mismo devuelve al conectarse
// (current_database()/current_schema()), nunca solo lo que parseamos de
// la URL.
import { logError } from "../log";

export const ROL_APP_ESPERADO = "chainpulse_app";
export const ROL_ADMIN_ESPERADO = "neondb_owner";

export interface InfoDestino {
  host: string;
  puerto: string;
  base: string;
  esquema: string;
  usuario: string;
}

/**
 * Parsea una URL de conexion SIN exponer la password -- nunca devuelve
 * ni registra el valor crudo de la variable. Si el valor falta o no es
 * una URL valida, aborta con un codigo fijo (nunca el valor en si, que
 * podria contener la password mal formada). El esquema se toma del
 * parametro "?schema=" de la URL (lo que Prisma usa de verdad); "public"
 * si no esta presente, que es el default tanto de Postgres como de
 * Prisma.
 */
export function resumenUrl(nombreVar: string, valor: string | undefined): InfoDestino {
  if (!valor) {
    logError("resumenUrl", `FALTA_VARIABLE_${nombreVar}`);
    throw new Error(`FALTA_VARIABLE_${nombreVar}`);
  }
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    // catch SIN binding -- nunca hay una referencia al error real, que
    // podria incluir el valor que fallo al parsear (con la password
    // adentro) en su mensaje.
    logError("resumenUrl", `URL_INVALIDA_${nombreVar}`);
    throw new Error(`URL_INVALIDA_${nombreVar}`);
  }
  return {
    host: u.hostname,
    puerto: u.port || "5432",
    base: u.pathname.slice(1),
    esquema: u.searchParams.get("schema") || "public",
    usuario: u.username,
  };
}

/** Representacion canonica de un destino -- la misma cadena se usa para
 * lo que la persona confirma a mano (ENTORNO_PRUEBA_CONFIRMADO) y para
 * lo que el script resuelve de las variables de conexion, asi quedan
 * atados: cambiar DATABASE_URL/SEED_DATABASE_URL sin volver a confirmar
 * hace que las dos cadenas dejen de coincidir. */
export function destinoConfirmado(destino: InfoDestino): string {
  return `${destino.host}:${destino.puerto}/${destino.base}?schema=${destino.esquema}`;
}

/**
 * Punto 1 (primera correccion): nada de esto puede saber por si solo
 * cual es "la produccion" de Alex -- la unica forma honesta de no
 * asumirlo es exigir una confirmacion explicita.
 *
 * Punto 3 (segunda correccion): esa confirmacion ya NO es un booleano
 * "si" desconectado del destino -- ENTORNO_PRUEBA_CONFIRMADO debe
 * contener la representacion exacta (destinoConfirmado()) del destino
 * que la persona confirmo DESPUES de leer host/base/esquema impresos
 * por resumenUrl(). Si DATABASE_URL/SEED_DATABASE_URL cambian despues
 * (otra conexion, otro host) sin volver a fijar esta variable con el
 * nuevo valor exacto, esta comparacion deja de coincidir y aborta --
 * un simple "si" ya no alcanza.
 */
export function exigirEntornoConfirmado(destino: InfoDestino): void {
  const confirmado = process.env.ENTORNO_PRUEBA_CONFIRMADO;
  if (!confirmado || confirmado !== destinoConfirmado(destino)) {
    logError("exigirEntornoConfirmado", "ENTORNO_NO_CONFIRMADO");
    throw new Error("ENTORNO_NO_CONFIRMADO");
  }
}

// Forma minima de cliente que necesitan estas verificaciones -- tipada
// a mano (no PrismaClient completo) para poder probarlas con un mock
// simple, sin generar un cliente Prisma real ni tocar una base.
export interface ClienteSoloLecturaRol {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface VerdictoRol {
  usuarioActual: string;
  baseActual: string;
  esquemaActual: string;
  bypassrls: boolean;
  superuser: boolean;
}

/**
 * Verifica el rol EFECTIVO de una conexion ya abierta y aborta (lanza)
 * si: el rol no es exactamente el esperado, o el rol tiene BYPASSRLS o
 * es superusuario (atributos incompatibles con que las politicas RLS se
 * esten aplicando de verdad). Nunca reenvia un error real de Postgres --
 * cualquier fallo de consulta cae a un codigo fijo.
 */
export async function verificarRolConexion(
  cliente: ClienteSoloLecturaRol,
  contexto: string,
  rolEsperado: string,
): Promise<VerdictoRol> {
  let filaRol: Array<{ usuario_actual: string; base_actual: string; esquema_actual: string }>;
  let filaAtributos: Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
  try {
    filaRol = await cliente.$queryRaw<
      Array<{ usuario_actual: string; base_actual: string; esquema_actual: string }>
    >`SELECT current_user::text AS usuario_actual, current_database()::text AS base_actual, current_schema()::text AS esquema_actual`;
    filaAtributos = await cliente.$queryRaw<
      Array<{ rolbypassrls: boolean; rolsuper: boolean }>
    >`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
  } catch {
    logError(contexto, "ERROR_CONSULTA_ROL");
    throw new Error("ERROR_CONSULTA_ROL");
  }

  const rol = filaRol[0];
  const atributos = filaAtributos[0];
  if (!rol || !atributos) {
    logError(contexto, "RESPUESTA_VACIA_VERIFICACION_ROL");
    throw new Error("RESPUESTA_VACIA_VERIFICACION_ROL");
  }

  if (rol.usuario_actual !== rolEsperado) {
    logError(contexto, "ROL_INESPERADO");
    throw new Error("ROL_INESPERADO");
  }
  if (atributos.rolbypassrls || atributos.rolsuper) {
    logError(contexto, "ROL_CON_ATRIBUTOS_INCOMPATIBLES");
    throw new Error("ROL_CON_ATRIBUTOS_INCOMPATIBLES");
  }

  return {
    usuarioActual: rol.usuario_actual,
    baseActual: rol.base_actual,
    esquemaActual: rol.esquema_actual,
    bypassrls: atributos.rolbypassrls,
    superuser: atributos.rolsuper,
  };
}

/**
 * Punto 3 (segunda correccion), segunda mitad: "Contrastá también la
 * base efectiva devuelta por la consulta" -- resumenUrl() solo parsea lo
 * que DICE la cadena de conexion; esto contrasta contra lo que Postgres
 * mismo devolvio al conectarse de verdad (verificarRolConexion ya hizo
 * esa consulta). Defiende contra una cadena de conexion que apunte, via
 * un proxy o un alias, a un destino distinto del que el nombre/puerto
 * parecen indicar.
 */
export function verificarDestinoEfectivo(veredictoRol: VerdictoRol, destinoEsperado: InfoDestino, contexto: string): void {
  if (veredictoRol.baseActual !== destinoEsperado.base) {
    logError(contexto, "BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA");
    throw new Error("BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA");
  }
  if (veredictoRol.esquemaActual !== destinoEsperado.esquema) {
    logError(contexto, "ESQUEMA_EFECTIVO_DISTINTO_DEL_ESPERADO");
    throw new Error("ESQUEMA_EFECTIVO_DISTINTO_DEL_ESPERADO");
  }
}

// --- Estado de migraciones -----------------------------------------

export interface FilaMigracion {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

export interface EstadoMigraciones {
  aplicadas: string[];
  pendientes: string[];
  fallidasOInconclusas: string[];
}

/**
 * Punto 1 (primera correccion): "no basta con listar pendientes" -- una
 * fila de _prisma_migrations con rolled_back_at distinto de null
 * (rollback explicito) o con finished_at null (quedo a mitad de
 * aplicar, crasheo o se interrumpio) NO es "aplicada" ni tampoco
 * "pendiente" en el sentido de "nunca se intento" -- es su propia
 * categoria, que debe bloquear la autorizacion hasta que una persona la
 * resuelva a mano (normalmente con "prisma migrate resolve"), nunca
 * intentar seguir como si no hubiera pasado nada.
 *
 * Funcion PURA (sin tocar la base) a proposito, para poder probar la
 * clasificacion con pruebas unitarias comunes, sin mockear Prisma.
 */
export function evaluarEstadoMigraciones(filas: FilaMigracion[], todasEnRepo: string[]): EstadoMigraciones {
  const aplicadas: string[] = [];
  const fallidasOInconclusas: string[] = [];

  for (const fila of filas) {
    if (fila.rolled_back_at) {
      fallidasOInconclusas.push(fila.migration_name);
    } else if (!fila.finished_at) {
      fallidasOInconclusas.push(fila.migration_name);
    } else {
      aplicadas.push(fila.migration_name);
    }
  }

  const yaConsideradas = new Set([...aplicadas, ...fallidasOInconclusas]);
  const pendientes = todasEnRepo.filter((nombre) => !yaConsideradas.has(nombre));

  return { aplicadas, pendientes, fallidasOInconclusas };
}
