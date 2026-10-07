// Helper compartido -- extraido de
// reconstruccionRlsAuthGrantsRamas.integration.test.ts (RONDA 19, Alex
// 2026-10-07) para que la logica de "crear el esquema descartable
// _test_ramas solo si no existe, y borrarlo solo si esta misma suite lo
// creo" sea verificable con pruebas locales (sin conexion real), en
// esquemaDescartableRamas.test.ts. Se importa UNICAMENTE desde esos dos
// archivos.
//
// TABLAS_SECCION_A/TABLAS_SECCION_B/COLUMNA_FK_SECCION_B son una copia
// deliberada (no una importacion) de las mismas listas que ya existen en
// reconstruccionRlsAuthGrantsRamas.integration.test.ts -- se duplican a
// proposito para que este archivo quede 100% autocontenido y no obligue
// a tocar las constantes ya existentes de ese archivo (que ademas usan
// COLUMNA_DIRECTA_SECCION_A/TABLA_PADRE_SECCION_B, ajenas a esta
// correccion) solo para encajar con un import compartido.
export const TABLAS_SECCION_A = ["empresas", "usuarios", "eslabones", "conexiones", "ciclos_pulso"];
export const TABLAS_SECCION_B = ["respuestas_crudas", "resultados_conexion", "resultados_ciclo", "metricas_cuestionario", "recomendaciones_ejecutadas"];

export const COLUMNA_FK_SECCION_B: Record<string, string> = {
  respuestas_crudas: '"conexionId"',
  resultados_conexion: '"conexionId"',
  resultados_ciclo: '"cicloPulsoId"',
  metricas_cuestionario: '"cicloPulsoId"',
  recomendaciones_ejecutadas: '"cicloPulsoId"',
};

// Tipo angosto -- solo el metodo que estas 2 funciones usan de "pg".
// Client. Un Client real de "pg" sigue siendo compatible sin ningun
// cambio en los call sites (es estructuralmente mas amplio que esto);
// las pruebas locales pueden pasar un doble sin abrir ninguna conexion.
export interface ClienteSoloQuery {
  query(texto: string): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/**
 * Crea el esquema descartable _test_ramas y sus 10 tablas minimas --
 * PERO aborta con un error fijo y claro, sin escribir nada (ni DROP ni
 * CREATE), si _test_ramas ya existe.
 *
 * RONDA 19 (Alex, 2026-10-07): antes de esta correccion, esta funcion
 * hacia "DROP SCHEMA IF EXISTS _test_ramas CASCADE" sin preguntar --
 * destruia en silencio cualquier residuo de una corrida anterior
 * interrumpida, en vez de abortar. Ahora verifica primero (SELECT
 * contra information_schema.schemata) y nunca intenta ningun DROP ni
 * CREATE si ya existe.
 */
export async function prepararEsquemaLimpio(client: ClienteSoloQuery): Promise<void> {
  const existente = await client.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = '_test_ramas'",
  );
  if ((existente.rowCount ?? 0) > 0) {
    throw new Error(
      "ESQUEMA_TEST_RAMAS_YA_EXISTE: el esquema descartable _test_ramas ya existe -- esta prueba nunca borra ni reutiliza un esquema que no creo ella misma en esta misma corrida. Puede ser un residuo de una corrida anterior interrumpida: investigar manualmente antes de volver a correr esta suite.",
    );
  }
  await client.query("CREATE SCHEMA _test_ramas");
  for (const tabla of TABLAS_SECCION_A) {
    await client.query(`CREATE TABLE _test_ramas."${tabla}" (id text PRIMARY KEY, "empresaId" text)`);
  }
  for (const tabla of TABLAS_SECCION_B) {
    const columnaFk = COLUMNA_FK_SECCION_B[tabla];
    await client.query(`CREATE TABLE _test_ramas."${tabla}" (id text PRIMARY KEY, ${columnaFk} text)`);
  }
}

/**
 * Borra _test_ramas SOLO si creadoPorEstaSuite es true.
 *
 * RONDA 19: reemplaza el "DROP SCHEMA IF EXISTS ... CASCADE"
 * incondicional que tenia cada afterAll de
 * reconstruccionRlsAuthGrantsRamas.integration.test.ts. Si
 * prepararEsquemaLimpio() nunca llego a completarse (abortó por
 * preexistencia, o fallo a mitad de la creacion de las 10 tablas), el
 * llamador real nunca pone creadoPorEstaSuite en true, y esta funcion no
 * borra nada -- un fallo parcial de preparacion nunca habilita el
 * borrado. Mismo criterio de bandera de propiedad que
 * loginLookupIdentidadRonda11.integration.test.ts (Grupo 5, Ronda 14)
 * ya usa para public.login_lookup().
 */
export async function limpiarEsquemaSiCorresponde(client: ClienteSoloQuery, creadoPorEstaSuite: boolean): Promise<void> {
  if (!creadoPorEstaSuite) return;
  await client.query("DROP SCHEMA IF EXISTS _test_ramas CASCADE").catch(() => {});
}
