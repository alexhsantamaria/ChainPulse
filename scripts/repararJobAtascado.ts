// Script de mantenimiento -- recuperacion PUNTUAL de un job de
// COLA_IMPORTACION_CSV ("procesar-importacion-csv") que quedo 'active'
// sin que nada lo este procesando (Incremento 4 Bloque B, Cobertura).
//
// Incidente real que motiva este script (Alex, 2026-09-29/30): el job
// 27f5f447-2b9a-4794-ac66-81e3b6e3f0cc (importacion
// 52aed226-1b0f-4550-bd30-fdd497ba0ed3, creada el 2026-09-29) quedo
// reclamado ('active', started_on seteado) por un boss.fetch() sin
// acotar en confirmarAtomicidad.integration.test.ts (ver el comentario
// de cabecera de esa prueba y el parche de aislamiento que lo corrige),
// pero JAMAS completado ni fallado -- la cola usa supervise:false
// (src/infra/jobs/pgBoss.ts), asi que nada en pg-boss lo expira solo.
// Alex confirmo por lectura directa de Postgres (state=active,
// expire_seconds=900, ya_vencido=true, started_on=heartbeat_on
// 2026-09-29T20:39:08.70254+00, retry_count=0, retry_limit=3,
// output=NULL) y, el 2026-09-30, revisando los procesos Node en Windows
// (sin Vitest ni Next.js corriendo -- solo Codex y Prisma Studio) que no
// hay ningun proceso activo sosteniendo ese claim.
//
// IMPORTANTE -- ESTADO DE APROBACION (no reescribir esto sin que Alex lo
// pida): Alex revisó y descartó explícitamente una primera versión que
// llamaba boss.fail() directamente ("Usar boss.fail() por ID no basta
// para garantizar esas precondiciones") y pidió esta version, con la
// recuperacion hecha por un UPDATE atomico propio (ver
// recuperarJobActivoVencidoPorId() en job.ts). Eso es una revision del
// DISEÑO, no una autorizacion para ejecutar. La ejecucion sigue SIN
// autorizarse -- este script no se corrio ni una vez contra el job real,
// y no debe correrse hasta que Alex lo pida explicitamente.
//
// Diseño: usa recuperarJobActivoVencidoPorId() (job.ts) -- UN SOLO
// UPDATE atomico cuyo WHERE es la precondicion COMPLETA (identidad
// exacta por id+name+singleton_key+data.importId+data.empresaId, estado
// EXACTAMENTE 'active', vencido segun el reloj de POSTGRES
// -- started_on + expire_seconds < pgboss.job_now(), nunca Date.now() de
// este proceso --, y retry_count < retry_limit). Si CUALQUIERA de esas
// condiciones no se cumple EN EL INSTANTE del UPDATE, afecta cero filas
// -- no hay ventana entre "verificar" y "transicionar" donde un cambio
// concurrente pueda colarse, a diferencia de un boss.fail() generico.
//
// Equivalencia con pg-boss CONFIRMADA contra la version realmente
// instalada (Alex, 2026-09-30: "no solamente la formula del retraso") --
// ver node_modules/pg-boss/package.json (12.33.0, satisface el
// "^12.32.0" de package.json) y node_modules/pg-boss/dist/plans.js:
//   - failJobsById() (lo que boss.fail() ejecuta) llama a failJobs() SIN
//     forceTerminal, que a su vez llama a failJobsBody(..., forceTerminal
//     = false por default) -- confirma que boss.fail() SI puede producir
//     'retry' (nunca fuerza 'failed'), tal como asume este diseño.
//   - retried_jobs (la rama "quedan reintentos" de failJobsBody) hace un
//     DELETE + INSERT que copia, SIN CAMBIOS, todas las columnas que nunca
//     tocamos (id, name, priority, data, retry_limit, retry_count,
//     retry_delay, retry_backoff, retry_delay_max, singleton_key,
//     singleton_on, group_id, group_tier, expire_seconds,
//     deletion_seconds, created_on, keep_until, policy, dead_letter,
//     heartbeat_seconds, blocked, blocking, pending_dependencies) --
//     nuestro UPDATE deja esas mismas columnas intactas por construccion
//     (no aparecen en su SET), asi que el resultado final es identico
//     fila por fila a lo que failJobsBody() produciria, sin importar que
//     un UPDATE y un DELETE+INSERT sean operaciones fisicas distintas.
//   - Esa diferencia fisica solo importaria si algo dependiera de ella:
//     no hay ningun CREATE TRIGGER en el schema de pg-boss (grep sobre
//     dist/*.js), la cola se crea con partition:false (default de
//     QUEUE_DEFAULTS, createQueue(COLA_IMPORTACION_CSV, {policy:
//     "exclusive"}) en bootstrapPgBoss.ts nunca lo pisa, asi que no hay
//     particionado que mover entre filas), y LISTEN/NOTIFY en pg-boss es
//     solo un hint de latencia para boss.work()/boss.send() con
//     useListenNotify -- esta app nunca usa boss.work() (solo
//     fetch/complete/fail, ver el comentario de pgBoss.ts) y nunca
//     configura useListenNotify en obtenerBoss(), asi que ninguno de los
//     dos aplica aqui.
//   - CORREGIDO (Alex, 2026-09-30: "failJobsBody contempla conflictos de
//     reinsercion y una rama failed_jobs aun con reintentos disponibles"):
//     la afirmacion anterior de este comentario ("la rama failed_jobs
//     nunca se ejecuta porque exigimos retry_count < retry_limit") era
//     incompleta. failJobsBody() tiene una rama de conflicto que NO mira
//     retry_count en absoluto: retried_jobs hace `INSERT ... ON CONFLICT
//     DO NOTHING`, y failed_jobs inserta como 'failed' -- SIN condicion
//     de reintentos -- cualquier id que el INSERT de retried_jobs no haya
//     logrado insertar por un choque de constraint. Si eso pasara, pg-boss
//     degrada a 'failed' EN SILENCIO aunque quedaran reintentos.
//   - La unica constraint que podria chocar aqui es job_i6 (unique index
//     de pg-boss para policy:"exclusive", que es la policy de esta cola --
//     ver bootstrapPgBoss.ts): a lo sumo una fila por (name,
//     singleton_key) puede estar en created/retry/active a la vez. Por
//     que NO aplica a este UPDATE puntual, con el detalle completo en el
//     docstring de recuperarJobActivoVencidoPorId() en job.ts: nuestro
//     WHERE exige state='active' en el instante del UPDATE, y mientras
//     esa fila siga 'active', job_i6 YA le impide a cualquier
//     encolarImportacionCsv() con el mismo importId crear una segunda
//     fila no terminal (se deduplica, devuelve null -- ver el test
//     "deduplicacion" de confirmarAtomicidad.integration.test.ts). La
//     transicion active->retry se queda dentro del mismo rango que
//     job_i6 protege, asi que si no habia conflicto antes, tampoco lo hay
//     al terminar. Esta rama de failJobsBody() es alcanzable para pg-boss
//     en general (p.ej. un boss.fail() por lote con ids de filas
//     distintas que compartieran singleton_key) pero PROVABLEMENTE
//     inalcanzable para este UPDATE en particular.
//   - CORREGIDO (Alex, 2026-09-30: "si job_i6 no existe, no puede
//     producir una violacion de unicidad por ese indice"): lo anterior
//     estaba al reves. Sin ese indice no hay constraint que violar, asi
//     que NO habria unique_violation -- la garantia de exclusividad
//     dejaria de sostenerse EN SILENCIO (podria coexistir mas de una
//     fila created/retry/active para el mismo singleton_key sin error ni
//     aviso). Ver el docstring completo, ya corregido, de
//     recuperarJobActivoVencidoPorId() en job.ts.
//   - CORREGIDO OTRA VEZ (Alex, 2026-09-30, tras verificar en Neon): el
//     nombre "job_i6" es solo el de la PLANTILLA en plans.js -- pg-boss
//     particiona pgboss.job por LIST (name), y una cola con
//     partition:false (como esta) cae en la particion DEFAULT
//     compartida (pgboss.job_common), con el indice real generado por
//     sustitucion textual (job_table_format() en plans.js), nunca con el
//     nombre literal de la plantilla. Confirmado en la base real de
//     Alex: el job vive en pgboss.job_common, con policy='exclusive', y
//     el indice que lo protege se llama pgboss.job_common_i6
//     (indisunique/indisvalid/indisready en true) -- no pgboss.job_i6.
//   - Por eso esta garantia ya no se asume por lectura de codigo NI por
//     un nombre de indice fijo: se verifica contra la tabla fisica real.
//     (1) verificarIndiceExclusividadDelJob() (job.ts) lee
//     tableoid::regclass de la fila REAL de este jobId -- la tabla fisica
//     donde vive de verdad, sin asumir "job_common" ni ninguna otra --,
//     y despues busca EN ESA tabla (buscarIndiceExclusividadEnTabla(),
//     job.ts) un indice cuya ESTRUCTURA matchee -- CORREGIDO (Alex,
//     2026-09-30: "Falta comprobar las claves y el predicado del indice
//     de exclusividad, no solo dos coincidencias con ILIKE"): ya no
//     basta con que pg_get_indexdef() completo contenga las palabras
//     "singleton_key" y "exclusive" en cualquier parte (eso tambien
//     matchea un indice que NO protege nada, p.ej. uno que solo cubra
//     state='created' o que agregue una columna clave extra); ahora se
//     exige, contra los catalogos del sistema: exactamente dos columnas
//     CLAVE (indnkeyatts=2), columna 1 = name y columna 2 =
//     COALESCE(singleton_key, ...) verificadas una por una
//     (pg_get_indexdef() por columna). CORREGIDO OTRA VEZ (Alex,
//     2026-10-01: "las regex aceptan condiciones adicionales que
//     excluyan nuestro job"): el predicado parcial (pg_get_expr()) ya
//     no se compara con dos regex de presencia (que dejaban pasar un
//     indice con una condicion EXTRA, p.ej. "AND singleton_key =
//     'solo-otro-job'", que angosta el indice a proteger un solo job en
//     vez de la cola entera) -- se compara por IGUALDAD EXACTA,
//     normalizada (minusculas, espacios colapsados), contra el
//     predicado textual que la version instalada de pg-boss produce de
//     verdad para esta cola. Devuelve tambien el nombre y la definicion
//     encontrados para poder auditarlos a simple vista. Este script
//     trata la ausencia, invalidez o no-listeza de ese indice como un
//     problema bloqueante mas, igual que las otras precondiciones.
//     (2) El WHERE del UPDATE ademas exige
//     "policy = 'exclusive'" sobre la propia fila del job (la columna
//     que createTableJob() copia al encolar, la que ese indice
//     realmente evalua) -- ya no se asume desde bootstrapPgBoss.ts, se
//     re-verifica en el instante del UPDATE como cualquier otra
//     precondicion.
//
// Uso (solo diagnostico por defecto -- nunca ejecuta sin --ejecutar):
//   npm run jobs:reparar-job-atascado -- <jobId> <importIdEsperado> <empresaIdEsperada>
//   npm run jobs:reparar-job-atascado -- <jobId> <importIdEsperado> <empresaIdEsperada> --ejecutar
//
// El modo diagnostico (Alex, 2026-09-30: "corregí el modo diagnóstico
// para que verifique existencia, identidad completa, estado active,
// vencimiento según Postgres y reintentos disponibles; cualquier
// incumplimiento debe devolver código distinto de cero") ahora evalua
// las 6 precondiciones de fila EXPLICITAMENTE (nunca solo las imprime)
// -- existencia, identidad completa, state='active', policy='exclusive',
// vencimiento y reintentos disponibles -- y ADEMAS verifica, contra la
// tabla fisica real del job (nunca por lectura de codigo ni por un
// nombre de indice asumido), que el indice de exclusividad que lo
// protege exista, sea unico, valido y este listo
// (verificarIndiceExclusividadDelJob(), job.ts -- localiza la tabla via
// tableoid y el indice via su DEFINICION, nunca por nombre fijo: en la
// base real de Alex es pgboss.job_common_i6 sobre pgboss.job_common,
// nunca pgboss.job_i6): sale con codigo distinto de cero si cualquiera
// de las dos falla, en modo solo diagnostico Y en --ejecutar (si el
// diagnostico ya muestra un problema, el script NI SIQUIERA intenta el
// UPDATE). El vencimiento se evalua con una consulta separada que usa
// pgboss.job_now() -- el reloj de Postgres, nunca Date.now() de este
// proceso. Aun asi, esta verificacion previa es SOLO informativa para
// las 6 precondiciones de fila: la proteccion real sigue siendo el
// WHERE del UPDATE en si mismo (ver recuperarJobActivoVencidoPorId()),
// que se vuelve a evaluar en su propio instante -- si algo cambia entre
// este diagnostico y el --ejecutar, el UPDATE puede seguir devolviendo 0
// filas aunque el diagnostico haya dado bien, y eso es lo esperado, no
// un bug. La UNICA excepcion es el indice de exclusividad: como no es
// una precondicion de fila (es un hecho del catalogo del sistema, no
// algo que un WHERE por id pueda re-verificar), su ausencia, invalidez o
// no-listeza NO la protege el UPDATE -- por eso este script lo trata
// como bloqueante ya en el diagnostico, no solo informativo.
//
// Nunca procesa, reclama, falla ni borra ningun otro job -- ni por lote
// ni por la cola completa.
import "./_cargarEnv";
import { obtenerBoss, cerrarBoss } from "../src/infra/jobs/pgBoss";
import { COLA_IMPORTACION_CSV, recuperarJobActivoVencidoPorId, verificarIndiceExclusividadDelJob } from "../src/infra/kpis/cobertura/job";

interface FilaJobPgBoss {
  id: string;
  name: string;
  state: string;
  data: unknown;
  singleton_key: string | null;
  retry_count: number;
  retry_limit: number;
  retry_delay: number;
  retry_backoff: boolean;
  started_on: string | null;
  heartbeat_on: string | null;
  expire_seconds: number;
  start_after: string;
  output: unknown;
  vencido: boolean;
  policy: string | null;
}

async function leerJobPorId(boss: Awaited<ReturnType<typeof obtenerBoss>>, jobId: string): Promise<FilaJobPgBoss | null> {
  // "vencido" lo calcula Postgres (pgboss.job_now()), nunca este proceso
  // -- mismo criterio, EXACTO, que el WHERE de recuperarJobActivoVencidoPorId().
  // COALESCE a false cuando started_on es NULL (job nunca reclamado):
  // NULL + intervalo < job_now() da NULL en SQL, nunca "vencido".
  const resultado = await boss.getDb().executeSql(
    `SELECT id, name, state, data, singleton_key, retry_count, retry_limit, retry_delay,
            retry_backoff, started_on, heartbeat_on, expire_seconds, start_after, output, policy,
            COALESCE((started_on + expire_seconds * interval '1s') < pgboss.job_now(), false) AS vencido
       FROM pgboss.job
      WHERE id = $1`,
    [jobId],
  );
  return (resultado.rows[0] as FilaJobPgBoss | undefined) ?? null;
}

function segundosDesde(fechaIso: string | null): number | null {
  if (!fechaIso) return null;
  return Math.round((Date.now() - new Date(fechaIso).getTime()) / 1000);
}

function imprimirDiagnostico(job: FilaJobPgBoss): void {
  const elapsed = segundosDesde(job.started_on);
  console.log("--- Job leido ---");
  console.log(`  id: ${job.id}`);
  console.log(`  name: ${job.name}`);
  console.log(`  state: ${job.state}`);
  console.log(`  singleton_key: ${job.singleton_key}`);
  console.log(`  policy: ${job.policy}`);
  console.log(`  data: ${JSON.stringify(job.data)}`);
  console.log(`  retry_count/retry_limit: ${job.retry_count}/${job.retry_limit}`);
  console.log(`  retry_delay: ${job.retry_delay}s, retry_backoff: ${job.retry_backoff}`);
  console.log(`  started_on: ${job.started_on}`);
  console.log(`  heartbeat_on: ${job.heartbeat_on}`);
  console.log(`  expire_seconds: ${job.expire_seconds}`);
  console.log(`  start_after: ${job.start_after}`);
  console.log(`  vencido (segun pgboss.job_now(), calculado por Postgres): ${job.vencido}`);
  if (elapsed !== null) {
    console.log(`  segundos desde started_on (reloj de este proceso, solo informativo): ${elapsed} (${(elapsed / job.expire_seconds).toFixed(1)}x expire_seconds)`);
  }
  console.log(`  output: ${JSON.stringify(job.output)}`);
}

// Evalua, EXPLICITAMENTE, las 6 precondiciones de fila que exige
// recuperarJobActivoVencidoPorId() -- existencia, identidad completa,
// estado 'active', policy 'exclusive', vencimiento (ya calculado por
// Postgres en leerJobPorId()) y reintentos disponibles. Devuelve la
// lista de incumplimientos -- vacia significa que, EN EL INSTANTE de
// esta lectura, el UPDATE deberia poder recuperar el job (siempre que
// el indice de exclusividad tambien exista, sea unico, valido y este
// listo -- eso se verifica aparte, en main(), con
// verificarIndiceExclusividadDelJob() de job.ts, contra la tabla fisica
// real del job, nunca por un nombre de indice fijo).
function verificarPrecondiciones(job: FilaJobPgBoss | null, jobId: string, importIdEsperado: string, empresaIdEsperada: string): string[] {
  const problemas: string[] = [];
  if (!job) {
    problemas.push(`No existe ningun job con id=${jobId} en pgboss.job.`);
    return problemas; // sin fila no hay mas nada que verificar
  }
  if (job.name !== COLA_IMPORTACION_CSV) {
    problemas.push(`name esperado "${COLA_IMPORTACION_CSV}", encontrado "${job.name}".`);
  }
  if (job.singleton_key !== importIdEsperado) {
    problemas.push(`singleton_key esperado "${importIdEsperado}", encontrado "${job.singleton_key}".`);
  }
  const data = job.data as { importId?: string; empresaId?: string } | null;
  if (data?.importId !== importIdEsperado) {
    problemas.push(`data.importId esperado "${importIdEsperado}", encontrado "${data?.importId}".`);
  }
  if (data?.empresaId !== empresaIdEsperada) {
    problemas.push(`data.empresaId esperado "${empresaIdEsperada}", encontrado "${data?.empresaId}".`);
  }
  if (job.state !== "active") {
    problemas.push(`state esperado "active", encontrado "${job.state}".`);
  }
  if (job.policy !== "exclusive") {
    problemas.push(
      `policy esperado "exclusive" (la garantia de exclusividad del indice que protege esta cola depende de esto -- ver docstring de recuperarJobActivoVencidoPorId()), encontrado "${job.policy}".`,
    );
  }
  if (!job.vencido) {
    problemas.push(`todavia NO esta vencido segun pgboss.job_now() (started_on + expire_seconds sigue en el futuro o started_on es NULL).`);
  }
  if (!(job.retry_count < job.retry_limit)) {
    problemas.push(`no quedan reintentos disponibles (retry_count=${job.retry_count} >= retry_limit=${job.retry_limit}).`);
  }
  return problemas;
}

async function main() {
  const [jobId, importIdEsperado, empresaIdEsperada, flag] = process.argv.slice(2);
  if (!jobId || !importIdEsperado || !empresaIdEsperada) {
    console.error("Uso: npm run jobs:reparar-job-atascado -- <jobId> <importIdEsperado> <empresaIdEsperada> [--ejecutar]");
    process.exitCode = 1;
    return;
  }
  const ejecutar = flag === "--ejecutar";

  const boss = await obtenerBoss();
  try {
    const job = await leerJobPorId(boss, jobId);
    if (job) imprimirDiagnostico(job);

    const problemas = verificarPrecondiciones(job, jobId, importIdEsperado, empresaIdEsperada);

    // El indice de exclusividad no es una precondicion de fila -- es un
    // hecho del catalogo del sistema, asi que el WHERE del UPDATE no
    // puede re-verificarlo por si (ver el docstring de
    // recuperarJobActivoVencidoPorId() en job.ts). Se verifica aca,
    // contra la TABLA FISICA REAL de este job (tableoid, nunca un
    // nombre asumido como "pgboss.job_i6" -- pg-boss particiona por
    // nombre de cola, y esta cola cae en la particion compartida, con un
    // indice generado por sustitucion textual, no con el nombre literal
    // de la plantilla), y se trata como bloqueante igual que el resto:
    // sin esto, "policy = 'exclusive'" en el WHERE no alcanza a
    // garantizar exclusividad si el indice que la hace cumplir no
    // existe, quedo invalido o todavia no esta listo.
    const indice = await verificarIndiceExclusividadDelJob(boss, jobId);
    console.log(
      `  indice de exclusividad (verificado contra la tabla fisica real, tableoid): tabla=${indice.tablaFisica}, indice=${indice.indiceNombre}, existe=${indice.existe}, unico=${indice.unico}, valido=${indice.valido}, listo=${indice.listo}`,
    );
    if (indice.indiceDefinicion) console.log(`  definicion: ${indice.indiceDefinicion}`);
    if (!indice.tablaFisica) {
      problemas.push(
        `No se pudo determinar la tabla fisica (tableoid) de este job -- probablemente ya no existe la fila (ver la verificacion de existencia mas arriba).`,
      );
    } else if (!indice.existe) {
      problemas.push(
        `No se encontro, en ${indice.tablaFisica}, ningun indice unico cuya definicion cubra singleton_key + policy/exclusive -- sin el, nada impide que coexistan dos filas active/retry para el mismo singleton_key (ver docstring de recuperarJobActivoVencidoPorId()).`,
      );
    } else if (!indice.unico) {
      problemas.push(`El indice ${indice.indiceNombre} en ${indice.tablaFisica} no es unico (indisunique=false) -- no protege exclusividad.`);
    } else if (!indice.valido) {
      problemas.push(
        `El indice ${indice.indiceNombre} en ${indice.tablaFisica} existe pero esta marcado invalido (indisvalid=false, probablemente un CREATE INDEX CONCURRENTLY fallido) -- Postgres no lo usa para exigir unicidad.`,
      );
    } else if (!indice.listo) {
      problemas.push(
        `El indice ${indice.indiceNombre} en ${indice.tablaFisica} todavia no esta listo (indisready=false, probablemente un CREATE INDEX CONCURRENTLY en construccion) -- todavia no protege escrituras concurrentes.`,
      );
    }

    if (problemas.length > 0) {
      console.error("--- Verificacion fallida -- no se intenta ningun UPDATE ---");
      for (const problema of problemas) console.error(`  - ${problema}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      "--- Verificacion OK (en este instante): existe, identidad completa, state=active, policy=exclusive, vencido segun Postgres, reintentos disponibles, indice de exclusividad existe/unico/valido/listo ---",
    );

    if (!ejecutar) {
      console.log("Modo solo diagnostico (falta --ejecutar). No se intento ningun UPDATE. Nada fue modificado.");
      return;
    }

    console.log("Intentando recuperarJobActivoVencidoPorId() -- UPDATE atomico, acotado por id+name+singleton_key+data.importId+data.empresaId+state='active'+policy='exclusive'+vencido(job_now())+retry_count<retry_limit.");
    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { jobId, importId: importIdEsperado, empresaId: empresaIdEsperada },
      "Recuperacion manual: job huerfano por boss.fetch() sin acotar en confirmarAtomicidad.integration.test.ts (incidente 2026-09-29/30).",
    );

    if (!resultado.recuperado) {
      console.error(
        "recuperado=false -- el UPDATE no afecto ninguna fila. El diagnostico de arriba dio bien, pero algo cambio entre esa " +
          "lectura y este UPDATE (esto es exactamente la proteccion contra condiciones de carrera funcionando, no un bug).",
      );
      process.exitCode = 1;
      return;
    }

    const jobDespues = await leerJobPorId(boss, jobId);
    if (jobDespues) imprimirDiagnostico(jobDespues);

    if (jobDespues?.state !== "retry") {
      console.error(`Estado inesperado tras recuperarJobActivoVencidoPorId(): "${jobDespues?.state}" (se esperaba "retry").`);
      process.exitCode = 1;
      return;
    }
    console.log(`Job recuperado: SI (paso a "retry", start_after=${jobDespues.start_after}, volvio a la cola normal para que el consumidor real lo procese).`);
  } finally {
    await cerrarBoss();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
