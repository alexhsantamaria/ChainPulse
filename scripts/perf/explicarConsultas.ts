// Script INERTE -- corre EXPLAIN (ANALYZE, BUFFERS) de las 6 consultas
// determinísticas de Incremento 5 contra datos sembrados por
// semillaSinteticaConsultas.ts, a la escala pedida (Incremento 5 PR4,
// Alex, 2026-11-19).
//
// INERTE A PROPOSITO -- ver el mismo aviso que semillaSinteticaConsultas.ts:
// esta ronda SOLO autoriza crear/corregir este script, nunca ejecutarlo.
// No se corrio ni una sola vez contra ninguna base real.
//
// CORRECCIONES (ronda de revision, 2026-11-19) sobre la version
// anterior -- 2 fallas reales que la revision encontro:
//
//   1. El caso FALTANTES_FILL_RATE_periodo_exacto reutilizaba por error
//      definicionOtifId (la definicion de OTIF) en vez de resolver la
//      definicion real de FILL_RATE -- el SQL medido no coincidia con
//      lo que src/infra/queries/ejecutores/faltantesFillRate.ts hace
//      de verdad. Corregido: se resuelve definicionFillRateId por
//      separado (codigo='FILL_RATE', estado='PUBLICADA'), igual que ya
//      se hacia para OTIF/OTIF_PROVEEDOR.
//
//   2. set_config() y los 8 EXPLAIN corrian con llamadas independientes
//      a pool.query() -- un Pool de `pg` no garantiza que 2 llamadas
//      secuenciales usen la MISMA conexion fisica; si una tomara una
//      conexion distinta del pool, el set_config('app.tenant_id', ...)
//      de la primera seria invisible para esa otra conexion, y RLS
//      ocultaria TODAS las filas sin aviso (current_setting() nulo).
//      Corregido: un unico PoolClient (pool.connect()), una unica
//      transaccion (BEGIN), set_config(..., true) -- local a ESA
//      transaccion, nunca a la sesion completa -- y los 8 EXPLAIN en
//      esa misma conexion, con ROLLBACK + release en finally (nunca
//      COMMIT: este script es de solo lectura, EXPLAIN ANALYZE no
//      debe dejar ningun efecto persistente mas alla de actualizar
//      estadisticas internas de Postgres, que el ROLLBACK no revierte
//      pero tampoco es un cambio de datos).
//
//      Corrigiendo (2) se encontro un problema adicional, no senalado
//      por la revision pero necesario para que (2) funcione: la
//      PRIMERA consulta (buscar el empresaId sintetico por nombre) NO
//      puede hacerse con el rol de aplicacion (chainpulse_app) ANTES de
//      fijar app.tenant_id -- la politica RLS de "empresas"
//      (prisma/rls.sql: USING (id = current_setting('app.tenant_id',
//      true))) oculta TODAS las filas cuando esa variable todavia no
//      esta fijada (comparar con NULL nunca es verdadero). Es un
//      problema de huevo-y-gallina: no se puede saber que tenant_id
//      fijar sin antes poder leer la fila que lo identifica. Resuelto
//      igual que semillaSinteticaConsultas.ts resuelve el mismo
//      problema para ESCRIBIR: una conexion SEPARADA con el rol owner
//      (SEED_DATABASE_URL, bypassa RLS) SOLO para resolver los ids
//      (empresaId/cadenaId/los 3 definicionKpiId), nunca para el
//      EXPLAIN medido -- la conexion que corre set_config+EXPLAIN sigue
//      siendo exclusivamente DATABASE_URL/chainpulse_app, como antes,
//      para que el plan medido sea el real (RLS incluido).
//
// Corre la MEDICION (set_config + EXPLAIN) con el ROL DE APLICACION
// (DATABASE_URL, chainpulse_app) -- mismo set_config que usa
// tenantClient() en runtime, src/infra/prisma/tenantScope.ts -- a
// proposito, para que el plan medido sea el MISMO que Postgres eligiria
// para una peticion real: RLS (capa 2 de RNF1) agrega su propio
// predicado de empresa_id, y un EXPLAIN corrido con el rol
// administrativo (bypassrls) veria un plan DISTINTO (mas barato) del
// que de verdad corre en produccion.
//
// CORRECCION EXPLICITA DE ALEX (2026-11-19) sobre la auditoria estatica
// del diseno de PR4: "el indice de ObservacionKpi no cubre
// necesariamente de forma optima la consulta por periodoFin cuando
// periodoInicio queda sin restringir. Deja como candidatos sujetos a
// medicion tanto HallazgoCadena(cadenaId, createdAt) como el patron
// real de OTIF_CAIDA." Por eso este script NUNCA asume que la lectura 2
// de OTIF_CAIDA (CASO_OTIF_CAIDA_ANTERIOR, el patron real senalado) ya
// esta bien servida por el indice unico existente -- se mide IGUAL que
// el candidato de HallazgoCadena(cadenaId, createdAt)
// (CASO_CAMBIOS_ULTIMO_PULSO_ANTES/_DESDE), nunca se omite ni se da por
// buena de antemano.
//
// Requiere, en el entorno de ESTA sesion de terminal:
//   DATABASE_URL                       -- rol chainpulse_app, el mismo
//                                          destino YA sembrado por
//                                          semillaSinteticaConsultas.ts
//                                          (mismo host que SEED_DATABASE_URL
//                                          en esa corrida). Se usa
//                                          EXCLUSIVAMENTE para
//                                          set_config + los 8 EXPLAIN.
//   SEED_DATABASE_URL                  -- rol neondb_owner, MISMO
//                                          destino exacto que
//                                          DATABASE_URL (ambos se
//                                          validan por separado contra
//                                          el mismo NEON_RAMA_TEMPORAL_HOST_CONFIRMADO
//                                          -- si no coinciden, la
//                                          segunda validacion falla).
//                                          Se usa EXCLUSIVAMENTE para
//                                          resolver empresaId/cadenaId/
//                                          definicionKpiId (bypassa
//                                          RLS), nunca para ningun
//                                          EXPLAIN.
//   NEON_RAMA_TEMPORAL_HOST_CONFIRMADO / NEON_PRODUCCION_HOST_BLOQUEADO /
//   AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL="si" / ENTORNO_PRUEBA_CONFIRMADO
//                                       -- las mismas 2 compuertas, ver
//                                          guardaRamaTemporalRendimiento.ts.
//
// Uso previsto (solo documentado, nunca ejecutado en esta ronda):
//   npx tsx scripts/perf/explicarConsultas.ts --escala=1000
//   (escribe scripts/perf/resultados/explain-<escala>-<timestamp>.txt
//   -- ver .gitignore, ese directorio nunca se commitea)
import "../_cargarEnv";
import { writeFileSync, mkdirSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { esEscalaValida, nombreEmpresaSinteticaParaEscala, type EscalaFilasPorCadena } from "../../src/infra/queries/rendimiento/configuracionRendimiento";
import { exigirDestinoRendimientoSeguro } from "../../src/infra/queries/rendimiento/guardaRamaTemporalRendimiento";
import { construirCasosExplain, type IdsResueltosParaExplain } from "../../src/infra/queries/rendimiento/casosExplainConsultas";

/**
 * Forma minima de un PoolClient de `pg` que esta funcion necesita --
 * permite inyectar un cliente FALSO en las pruebas focalizadas (mismo
 * patron ya establecido en
 * scripts/rf20/calibrarExtractor23505RamaTemporal.ts: `cliente:
 * ClientePrueba` en vez de mockear el modulo `pg` completo), sin exigir
 * una conexion Postgres real para probar la secuencia
 * BEGIN/set_config/EXPLAIN*8/ROLLBACK (Alex, ronda de revision
 * 2026-11-19, punto 4: "misma conexion/transaccion para set_config y
 * EXPLAIN").
 */
export interface ClienteSqlExplain {
  query(texto: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function leerEscalaDeArgv(): EscalaFilasPorCadena {
  const arg = process.argv.find((a) => a.startsWith("--escala="));
  if (!arg) throw new Error("FALTA_ARGUMENTO_ESCALA -- uso: --escala=100|1000|10000|50000");
  const valor = Number(arg.slice("--escala=".length));
  if (!esEscalaValida(valor)) throw new Error(`ESCALA_INVALIDA_${valor}`);
  return valor;
}


/**
 * Resuelve empresaId/cadenaId/los 3 definicionKpiId con el ROL OWNER
 * (bypassa RLS) -- NUNCA con el rol de aplicacion, porque la politica
 * RLS de "empresas" oculta toda fila hasta que app.tenant_id ya este
 * fijado, y para fijarlo primero hay que saber cual es el empresaId
 * (huevo-y-gallina). Esta conexion se cierra antes de abrir la que
 * mide el EXPLAIN -- nunca se reutiliza para medir nada.
 */
export async function resolverIdsConRolOwner(escala: EscalaFilasPorCadena): Promise<IdsResueltosParaExplain> {
  const destinoOwner = exigirDestinoRendimientoSeguro("SEED_DATABASE_URL", process.env.SEED_DATABASE_URL);
  console.log("Destino (rol owner, solo para resolver ids) verificado:", JSON.stringify({ host: destinoOwner.host, base: destinoOwner.base, esquema: destinoOwner.esquema }));

  const poolOwner = new Pool({ connectionString: process.env.SEED_DATABASE_URL, ssl: { rejectUnauthorized: true } });
  try {
    const nombreEmpresa = nombreEmpresaSinteticaParaEscala(escala);
    const filaEmpresa = await poolOwner.query(`SELECT id FROM empresas WHERE nombre=$1 LIMIT 1`, [nombreEmpresa]);
    const empresaId = filaEmpresa.rows[0]?.id as string | undefined;
    if (!empresaId) {
      throw new Error(`EMPRESA_SINTETICA_NO_ENCONTRADA_${escala} -- correr semillaSinteticaConsultas.ts --escala=${escala} primero en este mismo destino`);
    }

    const [filaCadena, filaOtif, filaOtifProveedor, filaFillRate] = await Promise.all([
      poolOwner.query(`SELECT id FROM cadenas WHERE "empresaId"=$1 LIMIT 1`, [empresaId]),
      poolOwner.query(`SELECT id FROM definicion_kpis WHERE codigo='OTIF' AND estado='PUBLICADA' LIMIT 1`),
      poolOwner.query(`SELECT id FROM definicion_kpis WHERE codigo='OTIF_PROVEEDOR' AND estado='PUBLICADA' LIMIT 1`),
      poolOwner.query(`SELECT id FROM definicion_kpis WHERE codigo='FILL_RATE' AND estado='PUBLICADA' ORDER BY numero DESC LIMIT 1`),
    ]);
    const cadenaId = filaCadena.rows[0]?.id as string | undefined;
    const definicionOtifId = filaOtif.rows[0]?.id as string | undefined;
    const definicionOtifProveedorId = filaOtifProveedor.rows[0]?.id as string | undefined;
    const definicionFillRateId = filaFillRate.rows[0]?.id as string | undefined;
    if (!cadenaId || !definicionOtifId || !definicionOtifProveedorId || !definicionFillRateId) {
      throw new Error("DATOS_SEMBRADOS_INCOMPLETOS -- revisar que semillaSinteticaConsultas.ts corrio sin errores para esta escala, y que prisma/seedDefinicionesKpi.ts publico OTIF/OTIF_PROVEEDOR/FILL_RATE en este destino");
    }
    return { empresaId, cadenaId, definicionOtifId, definicionOtifProveedorId, definicionFillRateId };
  } finally {
    await poolOwner.end();
  }
}

/**
 * Orquesta BEGIN + set_config + los 8 EXPLAIN + ROLLBACK sobre UN
 * cliente SQL ya conectado (Alex, ronda de revision 2026-11-19: "no
 * ejecutar set_config() y los EXPLAIN mediante llamadas independientes
 * a pool.query()"). set_config con `true` -- local a ESTA transaccion,
 * nunca a la sesion completa. ROLLBACK siempre en finally, nunca
 * COMMIT: este script es de solo lectura.
 *
 * PURA respecto a la conexion -- nunca abre ni cierra nada, solo recibe
 * `cliente` ya conectado y lo usa. Extraida de medirConRolDeAplicacion
 * especificamente para poder probarse con un cliente FALSO (mismo
 * patron de scripts/rf20/calibrarExtractor23505RamaTemporal.ts) y asi
 * demostrar con una prueba focalizada que set_config y los 8 EXPLAIN
 * corren en la MISMA conexion/transaccion, sin necesitar Postgres real.
 */
export async function ejecutarExplainsEnTransaccion(cliente: ClienteSqlExplain, escala: EscalaFilasPorCadena, ids: IdsResueltosParaExplain): Promise<string[]> {
  const lineasResultado: string[] = [];
  try {
    await cliente.query("BEGIN");
    // `true` -- local a esta transaccion (SET LOCAL implicito via el
    // 3er parametro de set_config), nunca a la sesion/conexion
    // completa. Mismo criterio de RLS que tenantClient() en runtime.
    await cliente.query(`SELECT set_config('app.tenant_id', $1, true)`, [ids.empresaId]);

    const casos = construirCasosExplain(ids);
    for (const caso of casos) {
      const etiqueta = caso.esCandidatoSenaladoPorAlex ? "[CANDIDATO SENALADO POR ALEX -- nunca asumido de antemano]" : "[ya clasificado bien cubierto en el diseno]";
      const resultado = await cliente.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${caso.sql}`, caso.params);
      const texto = resultado.rows.map((r: Record<string, unknown>) => r["QUERY PLAN"]).join("\n");
      lineasResultado.push(`\n=== ${caso.id} ${etiqueta} (escala=${escala}) ===\n${texto}\n`);
      console.log(`OK -- ${caso.id}`);
    }
  } finally {
    await cliente.query("ROLLBACK").catch(() => {
      // Si BEGIN nunca llego a correr (fallo antes), ROLLBACK sin
      // transaccion abierta lanza -- se ignora a proposito, nunca se
      // enmascara el error original (que ya se propago por fuera de
      // este catch especifico).
    });
  }
  return lineasResultado;
}

/**
 * Conecta con el ROL DE APLICACION (DATABASE_URL, chainpulse_app) y
 * delega en ejecutarExplainsEnTransaccion -- unico punto que abre/
 * cierra la conexion real; release() del PoolClient siempre corre
 * despues del ROLLBACK (que ya ocurrio dentro de
 * ejecutarExplainsEnTransaccion antes de que esta funcion retome
 * control, exito o error).
 */
export async function medirConRolDeAplicacion(escala: EscalaFilasPorCadena, ids: IdsResueltosParaExplain): Promise<string[]> {
  const destinoApp = exigirDestinoRendimientoSeguro("DATABASE_URL", process.env.DATABASE_URL);
  console.log("Destino (rol de aplicacion, medicion real) verificado:", JSON.stringify({ host: destinoApp.host, base: destinoApp.base, esquema: destinoApp.esquema }));

  const poolApp = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  let cliente: PoolClient | undefined;
  try {
    cliente = await poolApp.connect();
    return await ejecutarExplainsEnTransaccion(cliente, escala, ids);
  } finally {
    if (cliente) cliente.release();
    await poolApp.end();
  }
}

async function main(): Promise<void> {
  const escala = leerEscalaDeArgv();
  const ids = await resolverIdsConRolOwner(escala);
  const lineasResultado = await medirConRolDeAplicacion(escala, ids);

  mkdirSync("scripts/perf/resultados", { recursive: true });
  const ruta = `scripts/perf/resultados/explain-escala${escala}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  writeFileSync(ruta, lineasResultado.join("\n"), "utf-8");
  console.log(`Resultados escritos en ${ruta}`);
}

// Guard (mismo patron ya establecido en
// scripts/rf20/calibrarExtractor23505RamaTemporal.ts /
// scripts/rf19/restablecer-mfa-plataforma-mantenimiento.ts): este
// archivo exporta funciones para las pruebas focalizadas de
// scripts/perf/__tests__/, y un import de ES modules ejecuta el
// cuerpo entero del modulo -- sin este guard, cada corrida de pruebas
// dispararia main() de verdad. Vitest define process.env.VITEST="true"
// automaticamente; fuera de pruebas (invocacion real con `npx tsx`)
// esa variable nunca existe, asi que el comportamiento real de este
// script no cambia en nada.
if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error("EXPLAIN_ABORTADO:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
