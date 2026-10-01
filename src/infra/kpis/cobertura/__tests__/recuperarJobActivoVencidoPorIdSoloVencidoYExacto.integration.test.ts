// Prueba de integracion -- recuperarJobActivoVencidoPorId() contra
// Postgres real (Alex, 2026-09-30, tras revisar una primera version que
// llamaba boss.fail() directamente): "Debe exigir vencimiento usando el
// reloj de Postgres, verificar la empresa y los reintentos disponibles,
// y proteger la validacion y la transicion frente a cambios
// concurrentes. [...] agregá pruebas de rechazo para job no vencido,
// identidad incorrecta y estado cambiado."
//
// Las pruebas unitarias de job.test.ts (mockeadas) ya prueban la FORMA
// del SQL/parametros y el manejo de "0 filas". Lo que NINGUN mock puede
// demostrar es que el WHERE en si -- evaluado por Postgres, contra su
// propio reloj (job_now()), no el de este proceso -- realmente rechaza
// cada precondicion por separado. Esta prueba deja, para cada escenario,
// EXACTAMENTE un job real encolado (via encolarImportacionCsv(), el
// mismo camino que usa la app) y lo lleva a mano al estado que cada
// precondicion necesita EXCLUIR (con un UPDATE directo, solo para armar
// el escenario -- nunca la operacion bajo prueba), despues intenta
// recuperarlo y verifica, releyendo pgboss.job, que quedo EXACTAMENTE
// intacto cuando la precondicion correspondiente no se cumple. Un ultimo
// caso de control ("todo coincide, vencido, con reintentos") prueba que
// el mismo UPDATE SI transiciona a 'retry' cuando corresponde.
//
// Corre SOLO con `npm run test:integration` en Windows -- misma guardia
// que las demas pruebas de integracion de Cobertura (ver
// entornoPruebasIntegracionCobertura.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { obtenerBoss, cerrarBoss } from "../../../jobs/pgBoss";
import {
  encolarImportacionCsv,
  recuperarJobActivoVencidoPorId,
  verificarIndiceExclusividadDelJob,
  buscarIndiceExclusividadEnTabla,
  COLA_IMPORTACION_CSV,
} from "../job";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureCobertura,
  borrarFixtureCobertura,
  type FixtureCoberturaIntegracion,
} from "./entornoPruebasIntegracionCobertura";

let fixture: FixtureCoberturaIntegracion;
let boss: Awaited<ReturnType<typeof obtenerBoss>>;

interface FilaJob {
  state: string;
  started_on: string | null;
  heartbeat_on: string | null;
  retry_count: number;
  retry_limit: number;
  start_after: string;
  output: unknown;
  policy: string | null;
}

// Jobs reales que cada prueba deja pendientes en pgboss.job -- se borran
// en afterEach, SOLO despues de que cada test ya releyo y confirmo su
// estado. Mismo criterio que
// reclamarJobPorIdSoloConCoincidenciaExacta.integration.test.ts: un
// DELETE puntual por id, nunca un borrado masivo de la cola.
// borrarFixtureCobertura() no los toca (pgboss.job vive en un schema
// separado, sin FK hacia importaciones_csv).
const jobIdsCreados: string[] = [];

async function encolarJobDePrueba(importId: string): Promise<string> {
  await encolarImportacionCsv(boss, { importId, empresaId: fixture.empresaId });
  const fila = await boss
    .getDb()
    .executeSql(`SELECT id FROM pgboss.job WHERE name = $1 AND singleton_key = $2`, [COLA_IMPORTACION_CSV, importId]);
  expect(fila.rows).toHaveLength(1);
  const jobId = fila.rows[0].id as string;
  jobIdsCreados.push(jobId);
  return jobId;
}

async function leerJob(jobId: string): Promise<FilaJob | undefined> {
  const fila = await boss
    .getDb()
    .executeSql(
      `SELECT state, started_on, heartbeat_on, retry_count, retry_limit, start_after, output, policy FROM pgboss.job WHERE id = $1`,
      [jobId],
    );
  return fila.rows[0] as FilaJob | undefined;
}

// Deja el job en 'active', con started_on tan atras como
// segundosDesdeInicio indique -- SIEMPRE via UPDATE directo, solo para
// armar el escenario de cada prueba (nunca la operacion bajo prueba en
// si, que es recuperarJobActivoVencidoPorId()). expire_seconds ya viene
// en 900 por default de la cola (ver QUEUE_DEFAULTS en
// node_modules/pg-boss/dist/plans.js, encolarImportacionCsv() no lo
// sobreescribe) -- 901s atras esta vencido, 60s atras no.
async function marcarActivoDesdeHace(jobId: string, segundosDesdeInicio: number): Promise<void> {
  await boss
    .getDb()
    .executeSql(
      `UPDATE pgboss.job SET state = 'active', started_on = pgboss.job_now() - ($2 * interval '1 second'), heartbeat_on = pgboss.job_now() - ($2 * interval '1 second') WHERE id = $1`,
      [jobId, segundosDesdeInicio],
    );
}

beforeAll(async () => {
  requerirEntornoDePruebasConfirmado();
  fixture = await crearFixtureCobertura("recuperar-activo-vencido");
  boss = await obtenerBoss();
}, 30000);

afterEach(async () => {
  while (jobIdsCreados.length > 0) {
    const jobId = jobIdsCreados.pop()!;
    await boss.getDb().executeSql(`DELETE FROM pgboss.job WHERE id = $1`, [jobId]);
  }
});

afterAll(async () => {
  if (fixture) await borrarFixtureCobertura(fixture);
  await cerrarBoss();
});

describe("recuperarJobActivoVencidoPorId -- el UPDATE atomico no transiciona nada si alguna precondicion no se cumple (Postgres real)", () => {
  it("job NO vencido (todavia dentro de expire_seconds) -- 0 filas afectadas, el job real queda intacto", async () => {
    const importId = `import-recuperar-novencido-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 60); // muy por debajo de expire_seconds=900

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: fixture.empresaId, jobId },
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: false });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("active");
    expect(filaDespues?.output).toBeNull();
    expect(filaDespues?.retry_count).toBe(0);
  }, 30000);

  it("jobId incorrecto -- 0 filas afectadas, el job real (vencido) queda intacto", async () => {
    const importId = `import-recuperar-jobid-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 901);

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: fixture.empresaId, jobId: randomUUID() }, // no existe
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: false });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("active");
    expect(filaDespues?.output).toBeNull();
  }, 30000);

  it("empresaId incorrecto -- 0 filas afectadas, el job real (vencido) queda intacto", async () => {
    const importId = `import-recuperar-empresa-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 901);

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: randomUUID(), jobId }, // no coincide con data.empresaId
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: false });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("active");
    expect(filaDespues?.output).toBeNull();
  }, 30000);

  it("data.importId incorrecto -- AUNQUE jobId, empresa y singleton_key SI coincidan -- 0 filas afectadas, el job real queda intacto", async () => {
    const importId = `import-recuperar-dataimportid-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 901);

    // Corrompe SOLO data.importId, dejando singleton_key intacto -- mismo
    // criterio de aislamiento que
    // reclamarJobPorIdSoloConCoincidenciaExacta.integration.test.ts para
    // reclamarJobImportacionCsvPorId().
    await boss
      .getDb()
      .executeSql(`UPDATE pgboss.job SET data = jsonb_set(data, '{importId}', to_jsonb($1::text)) WHERE id = $2`, [
        `otra-importacion-${randomUUID()}`,
        jobId,
      ]);

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: fixture.empresaId, jobId }, // el importId real -- SI coincide con singleton_key
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: false });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("active");
    expect(filaDespues?.output).toBeNull();
  }, 30000);

  it("estado ya no es 'active' (otra transicion ya corrio) -- 0 filas afectadas AUNQUE el job este vencido", async () => {
    const importId = `import-recuperar-estado-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 901);
    // Simula que otra cosa ya lo hizo transicionar (p.ej. un consumidor
    // real que si lo termino) DESPUES de que este quedo vencido -- el
    // vencimiento por si solo nunca debe alcanzar si el estado ya
    // cambio.
    await boss.getDb().executeSql(`UPDATE pgboss.job SET state = 'retry' WHERE id = $1`, [jobId]);

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: fixture.empresaId, jobId },
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: false });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("retry"); // nunca lo toco, sigue como lo dejo el UPDATE de arriba
    expect(filaDespues?.output).toBeNull();
  }, 30000);

  it("policy incorrecto (no 'exclusive') -- 0 filas afectadas AUNQUE el job este vencido y activo (Alex, 2026-09-30: \"la garantia depende de que [...] el job tenga policy='exclusive'\")", async () => {
    const importId = `import-recuperar-policy-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 901);
    // Corrompe SOLO policy -- simula un job cuya cola no fuera
    // policy='exclusive' (o que lo haya dejado de ser desde que se
    // encolo). encolarImportacionCsv() siempre deja policy='exclusive'
    // en la practica (COLA_IMPORTACION_CSV se crea asi en
    // bootstrapPgBoss.ts) -- este UPDATE directo es solo para armar el
    // escenario que la precondicion debe excluir, nunca algo que la app
    // haga por si sola.
    await boss.getDb().executeSql(`UPDATE pgboss.job SET policy = 'standard' WHERE id = $1`, [jobId]);

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: fixture.empresaId, jobId },
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: false });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("active");
    expect(filaDespues?.output).toBeNull();
  }, 30000);

  it("sin reintentos disponibles (retry_count = retry_limit) -- 0 filas afectadas AUNQUE el job este vencido y activo", async () => {
    const importId = `import-recuperar-sinreintentos-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 901);
    const antes = await leerJob(jobId);
    await boss.getDb().executeSql(`UPDATE pgboss.job SET retry_count = retry_limit WHERE id = $1`, [jobId]);

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: fixture.empresaId, jobId },
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: false });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("active"); // sigue tal cual -- esta funcion nunca decide llevarlo a 'failed'
    expect(filaDespues?.retry_count).toBe(antes?.retry_limit);
    expect(filaDespues?.output).toBeNull();
  }, 30000);

  it("control -- vencido, activo, identidad exacta y con reintentos disponibles -- SI transiciona a 'retry' preservando las reglas de pg-boss", async () => {
    const importId = `import-recuperar-ok-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);
    await marcarActivoDesdeHace(jobId, 901);
    const antes = await leerJob(jobId);
    expect(antes?.retry_count).toBe(0);
    // Confirma, contra la base real, la segunda mitad de la garantia de
    // exclusividad (Alex, 2026-09-30): un job encolado por la app de
    // verdad (encolarImportacionCsv(), nunca un valor inventado aca)
    // efectivamente trae policy='exclusive' -- no es un supuesto de
    // lectura de bootstrapPgBoss.ts, es lo que Postgres devuelve.
    expect(antes?.policy).toBe("exclusive");

    const resultado = await recuperarJobActivoVencidoPorId(
      boss,
      { importId, empresaId: fixture.empresaId, jobId },
      "recuperacion de prueba",
    );

    expect(resultado).toEqual({ recuperado: true });

    const filaDespues = await leerJob(jobId);
    expect(filaDespues?.state).toBe("retry"); // nunca 'failed' -- retry_count(0) < retry_limit
    expect(filaDespues?.heartbeat_on).toBeNull();
    expect(filaDespues?.retry_count).toBe(0); // sin tocar -- pg-boss lo incrementa recien en el proximo claim real
    expect(filaDespues?.output).toEqual({ mensaje: "recuperacion de prueba" });
    // start_after recalculado con retry_delay=30/retry_backoff=true
    // (encolarImportacionCsv()) -- queda en el futuro, nunca inmediato.
    expect(new Date(filaDespues!.start_after).getTime()).toBeGreaterThan(Date.now());
  }, 30000);
});

// Cierra la primera mitad de la garantia de exclusividad que Alex pidio
// verificar (2026-09-30: "la garantia depende de que el indice exista y
// este valido en Neon [...] eso todavia debemos verificarlo"): NO basta
// con que createIndexJobPolicyExclusive() lo defina en el codigo fuente
// de pg-boss -- esta prueba confirma, leyendo el catalogo del sistema de
// la base de pruebas real (la misma que usa el resto de este archivo),
// que la fila de un job real queda protegida por un indice unico,
// valido y listo, despues del bootstrap real de la app
// (bootstrapPgBoss.ts, disparado por obtenerBoss() en beforeAll).
//
// CORREGIDO (Alex, 2026-09-30, tras verificar en Neon): esta prueba
// asumia antes un nombre de indice fijo ("pgboss.job_i6"), que solo es
// correcto sin particionado. pg-boss particiona pgboss.job por LIST
// (name); COLA_IMPORTACION_CSV (partition:false) cae en la particion
// DEFAULT compartida, y el indice real se genera con un nombre distinto
// por sustitucion textual (ver docstring de
// verificarIndiceExclusividadDelJob() en job.ts) -- confirmado en la
// base real de Alex: pgboss.job_common / pgboss.job_common_i6, nunca
// pgboss.job_i6. Por eso esta prueba ya no asume ningun nombre: encola
// un job real, lee su tableoid (la tabla fisica real donde vive esa
// fila especifica) y confirma que, EN ESA tabla, existe un indice unico
// cuya definicion cubra singleton_key + policy/exclusive -- exactamente
// el mismo criterio, sin nombre fijo, que usa
// scripts/repararJobAtascado.ts antes de considerar cualquier
// --ejecutar.
describe("verificarIndiceExclusividadDelJob -- contra Postgres real", () => {
  it("un job real queda protegido por un indice unico/valido/listo en su tabla fisica real (sin asumir ningun nombre de indice)", async () => {
    const importId = `import-recuperar-indice-${randomUUID()}`;
    const jobId = await encolarJobDePrueba(importId);

    const resultado = await verificarIndiceExclusividadDelJob(boss, jobId);

    // No se fija un nombre de tabla/indice exacto a proposito (Alex,
    // 2026-09-30: "no dependas exclusivamente del nombre") -- hoy es
    // pgboss.job_common / pgboss.job_common_i6, pero esta prueba sigue
    // siendo valida si algun dia cambia (otra particion, otra version
    // de pg-boss). Lo que se exige es la GARANTIA en si.
    expect(resultado.tablaFisica).not.toBeNull();
    expect(resultado.tablaFisica).toMatch(/^pgboss\./);
    expect(resultado.indiceNombre).not.toBeNull();
    expect(resultado.indiceDefinicion).toContain("singleton_key");
    expect(resultado.indiceDefinicion?.toLowerCase()).toContain("exclusive");
    expect(resultado.existe).toBe(true);
    expect(resultado.unico).toBe(true);
    expect(resultado.valido).toBe(true);
    expect(resultado.listo).toBe(true);
  }, 30000);

  // Segunda mitad de la garantia (Alex, 2026-09-30: "Falta comprobar las
  // claves y el predicado del indice de exclusividad, no solo dos
  // coincidencias con ILIKE. Agrega pruebas negativas para un indice que
  // cubra unicamente created y otro con claves adicionales que permitan
  // duplicados"): el test anterior prueba que el indice REAL (Neon, via
  // el bootstrap de la app) es aceptado. Estos tres prueban que
  // buscarIndiceExclusividadEnTabla() -- la misma consulta estructural,
  // llamada directamente contra una tabla fisica ya resuelta -- RECHAZA
  // formas de indice que una verificacion mas floja aceptaria por error
  // (las tres mencionan "singleton_key" y "exclusive" en su definicion,
  // pero ninguna cierra el hueco real). Los primeros dos escenarios
  // (solo 'created', columna clave extra) ya cerraban el hueco de un
  // ILIKE suelto sobre pg_get_indexdef() completo. El tercero (Alex,
  // 2026-10-01: "las regex aceptan condiciones adicionales que excluyan
  // nuestro job") cierra un hueco distinto: un predicado con una
  // condicion EXTRA (p.ej. "AND singleton_key = 'solo-otro-job'") sigue
  // mencionando policy='exclusive' y state<='active', asi que dos regex
  // `~*` de presencia lo aceptaban -- pero ese indice en realidad solo
  // protege una fila puntual, no la cola entera; la comparacion actual
  // (igualdad EXACTA normalizada contra el predicado que la version
  // instalada de pg-boss produce de verdad) lo rechaza correctamente.
  //
  // CORREGIDO (Alex, corrida real en Windows): la primera version de
  // estas tres pruebas creaba la tabla/indice descartable con
  // `boss.getDb()` -- la MISMA conexion (DATABASE_URL, rol
  // chainpulse_app) que usa el resto de este archivo. Windows lo
  // rechazo real: "permission denied for schema pgboss". Era una
  // afirmacion falsa de una version anterior de este comentario ("el
  // mismo rol de runtime... tiene permiso de DDL en ese schema"), nunca
  // releida contra el codigo real de scripts/bootstrapPgBoss.ts antes de
  // escribirla -- ese script dice, textualmente, que chainpulse_app es
  // "el rol restringido de la aplicacion en tiempo de ejecucion, SIN
  // permiso de DDL", y los GRANT que le otorga sobre pgboss son
  // unicamente USAGE (schema) + SELECT/INSERT/UPDATE/DELETE (tablas) --
  // nunca CREATE. src/infra/jobs/pgBoss.ts (obtenerBoss(), usado por
  // `boss` en todo este archivo) confirma lo mismo: "createSchema/migrate
  // en false a proposito: chainpulse_app... no tiene permiso de DDL".
  //
  // Por eso estas tres pruebas usan una CONEXION SEPARADA Y ELEVADA --
  // `new Client({ connectionString: process.env.SEED_DATABASE_URL })`,
  // el MISMO rol (neondb_owner) y el MISMO patron que
  // scripts/bootstrapPgBoss.ts ya usa para crear el schema pgboss en si
  // -- SOLO para el DDL de armar/desarmar cada escenario (CREATE
  // TABLE/CREATE UNIQUE INDEX/DROP TABLE). La consulta bajo prueba en si
  // -- buscarIndiceExclusividadEnTabla(boss, tabla) -- sigue corriendo,
  // SIN NINGUN cambio, contra `boss` (chainpulse_app, DATABASE_URL): los
  // catalogos del sistema (pg_index/pg_class/pg_get_indexdef/
  // pg_get_expr) son legibles por cualquier rol autenticado con USAGE en
  // el schema, sin necesidad de ser el dueno de la tabla -- exactamente
  // como el test anterior ("caso feliz") ya demuestra, leyendo
  // pgboss.job_common_i6 (creado por neondb_owner) con este mismo `boss`
  // restringido. Que la LECTURA siga corriendo con el rol de produccion
  // real es intencional, no un descuido: es el mismo rol que usa
  // scripts/repararJobAtascado.ts (via obtenerBoss(), DATABASE_URL) en
  // la vida real -- solo la preparacion DESCARTABLE del escenario de
  // prueba necesita el rol elevado, nunca la verificacion bajo prueba.
  //
  // Cada prueba crea y borra su propia tabla descartable DENTRO del
  // schema pgboss (nunca toca pgboss.job/pgboss.job_common). DROP TABLE
  // en el finally garantiza limpieza aunque la asercion falle, mismo
  // criterio que el resto de este archivo.
  describe("buscarIndiceExclusividadEnTabla -- rechaza indices estructuralmente insuficientes (contra Postgres real)", () => {
    let clienteElevado: Client;

    // Alex: "current_database() puede devolver 'neondb' en dos ramas
    // diferentes [de Neon]. Antes de cualquier DDL, verificá también que
    // ambas conexiones apunten al mismo endpoint de Neon, contemplando
    // la diferencia pooled/direct, y a la misma base. No imprimas
    // credenciales y rechazá destinos distintos o ambiguos." --
    // current_database() por si solo NO alcanza: Neon nombra "neondb" a
    // la base por defecto de CUALQUIER rama (branch), asi que dos
    // conexiones a dos entornos completamente distintos (p.ej. una rama
    // de desarrollo y otra de produccion, o dos ramas de preview
    // distintas) pueden devolver el mismo nombre de base sin ser el
    // mismo entorno. Lo que de verdad identifica el entorno es el
    // ENDPOINT que Neon le asigna a esa rama especifica -- eso viaja en
    // el hostname de la propia cadena de conexion. Unica complicacion:
    // Neon expone el MISMO endpoint bajo dos hostnames distintos segun
    // el modo de conexion -- "ep-xxxx-pooler.<region>.aws.neon.tech"
    // (pooled, via PgBouncer) y "ep-xxxx.<region>.aws.neon.tech"
    // (directo) -- asi que comparar el hostname tal cual rechazaria por
    // error, por ejemplo, un DATABASE_URL pooled contra un
    // SEED_DATABASE_URL directo aun cuando ambos apuntan exactamente al
    // mismo endpoint; se normaliza quitando el sufijo "-pooler" del
    // primer segmento del hostname antes de comparar.
    function resolverEndpointYBaseDeNeon(connectionString: string): {
      endpointNormalizado: string;
      base: string;
    } {
      const url = new URL(connectionString);
      const segmentos = url.hostname.toLowerCase().split(".");
      const primerSegmento = segmentos[0];
      const base = url.pathname.replace(/^\//, "");
      if (!primerSegmento || !base) {
        throw new Error("no se pudo determinar endpoint/base de la cadena de conexion");
      }
      const idEndpoint = primerSegmento.replace(/-pooler$/, "");
      const endpointNormalizado = [idEndpoint, ...segmentos.slice(1)].join(".");
      return { endpointNormalizado, base };
    }

    // Nunca imprime la cadena de conexion completa ni ningun fragmento
    // con credenciales (usuario/password) -- "No imprimas credenciales".
    // Los unicos valores que llegan a un mensaje de error son el
    // endpoint normalizado y el nombre de base, que ya se mostraban en
    // el chequeo con current_database() de abajo y no son informacion
    // sensible. Ante CUALQUIER destino distinto, O que no se pueda
    // interpretar con confianza (parseo fallido, hostname o pathname
    // vacios), rechaza -- nunca deja pasar un caso ambiguo ("rechazá
    // destinos distintos o ambiguos"). Se llama ANTES de abrir
    // clienteElevado y, por lo tanto, antes de cualquier DDL.
    function verificarMismoDestinoNeon(urlBoss: string, urlElevado: string): void {
      let destinoBoss: { endpointNormalizado: string; base: string };
      let destinoElevado: { endpointNormalizado: string; base: string };
      try {
        destinoBoss = resolverEndpointYBaseDeNeon(urlBoss);
      } catch {
        throw new Error(
          "No se pudo interpretar DATABASE_URL como una cadena de conexion valida -- destino ambiguo, se rechaza antes de cualquier DDL.",
        );
      }
      try {
        destinoElevado = resolverEndpointYBaseDeNeon(urlElevado);
      } catch {
        throw new Error(
          "No se pudo interpretar SEED_DATABASE_URL como una cadena de conexion valida -- destino ambiguo, se rechaza antes de cualquier DDL.",
        );
      }
      if (
        destinoBoss.endpointNormalizado !== destinoElevado.endpointNormalizado ||
        destinoBoss.base !== destinoElevado.base
      ) {
        throw new Error(
          `DATABASE_URL y SEED_DATABASE_URL no apuntan al mismo entorno de Neon (endpoint "${destinoBoss.endpointNormalizado}" / base "${destinoBoss.base}" vs endpoint "${destinoElevado.endpointNormalizado}" / base "${destinoElevado.base}", ya normalizando la diferencia pooled/direct) -- deben ser EXACTAMENTE el mismo entorno de pruebas. Revisa .env antes de correr estas pruebas.`,
        );
      }
    }

    beforeAll(async () => {
      // Guardia explicita, mismo criterio que
      // requerirEntornoDePruebasConfirmado(): fallar con un mensaje
      // claro ANTES de intentar nada, en vez de dejar que cada test
      // tropiece con un "permission denied" críptico si falta la
      // variable.
      if (!process.env.SEED_DATABASE_URL) {
        throw new Error(
          "Estas pruebas necesitan SEED_DATABASE_URL (rol neondb_owner, ver .env.example -- el mismo que usa scripts/bootstrapPgBoss.ts) para crear y borrar tablas/indices descartables de prueba. DATABASE_URL (chainpulse_app) no tiene permiso de DDL sobre el schema pgboss (confirmado real en Windows: \"permission denied for schema pgboss\").",
        );
      }
      if (!process.env.DATABASE_URL) {
        throw new Error(
          "Falta DATABASE_URL -- no se puede verificar que apunte al mismo entorno de Neon que SEED_DATABASE_URL antes de cualquier DDL.",
        );
      }

      // Alex: "Antes de cualquier DDL, verificá también que ambas
      // conexiones apunten al mismo endpoint de Neon, contemplando la
      // diferencia pooled/direct, y a la misma base [...] rechazá
      // destinos distintos o ambiguos". Se ejecuta con las cadenas de
      // conexion crudas, ANTES de abrir clienteElevado -- la forma mas
      // fuerte de "antes de cualquier DDL": ni siquiera se llega a abrir
      // la conexion elevada si los destinos no coinciden.
      verificarMismoDestinoNeon(process.env.DATABASE_URL, process.env.SEED_DATABASE_URL);

      clienteElevado = new Client({ connectionString: process.env.SEED_DATABASE_URL });
      await clienteElevado.connect();

      // Capa secundaria, en caliente, contra las conexiones REALES ya
      // abiertas -- Alex: "verificá TAMBIÉN" (se agrega a, no reemplaza,
      // el chequeo anterior basado en las cadenas de conexion): compara
      // current_database() de boss (chainpulse_app) y clienteElevado
      // (neondb_owner). Por si solo current_database() no alcanzaba (dos
      // ramas de Neon distintas pueden compartir el nombre "neondb") --
      // ahora es una segunda capa de defensa, no la unica, y sigue
      // fallando duro, ANTES de crear ninguna tabla, si no coinciden.
      const db = boss.getDb();
      const [porBoss, porElevado] = await Promise.all([
        db.executeSql(`SELECT current_database() AS db`),
        clienteElevado.query(`SELECT current_database() AS db`),
      ]);
      const baseBoss = (porBoss.rows[0] as { db: string }).db;
      const baseElevada = (porElevado.rows[0] as { db: string }).db;
      if (baseBoss !== baseElevada) {
        throw new Error(
          `DATABASE_URL apunta a la base "${baseBoss}" pero SEED_DATABASE_URL apunta a "${baseElevada}" -- deben ser EXACTAMENTE el mismo entorno de pruebas. Revisa .env antes de correr estas pruebas.`,
        );
      }
    }, 30000);

    afterAll(async () => {
      await clienteElevado?.end();
    });

    async function crearTablaDePrueba(sufijo: string): Promise<string> {
      const tabla = `pgboss.job_prueba_${sufijo}_${randomUUID().replace(/-/g, "_")}`;
      // `state pgboss.job_state` (el mismo ENUM que usa pgboss.job de
      // verdad), no `text` -- CORREGIDO (Alex: "Usá `state
      // pgboss.job_state` en las tablas de prueba... para demostrar que
      // los negativos fallan por la condición probada y no por
      // diferencias de tipo"). Con `state text`, Postgres deparsea el
      // predicado con el cast `::text` (p.ej. `state <=
      // 'active'::text`) en vez de `::pgboss.job_state` -- la
      // comparacion EXACTA de buscarIndiceExclusividadEnTabla() (job.ts)
      // espera literalmente `::pgboss.job_state`, asi que CUALQUIER
      // indice sobre una tabla con `state text` seria rechazado por esa
      // sola diferencia de tipo, incluso uno con las claves y el
      // predicado perfectos -- los 3 escenarios negativos habrian dado
      // `existe:false` por la razon EQUIVOCADA, no por la condicion que
      // en realidad se queria probar. Con `state pgboss.job_state` el
      // cast deparsado coincide exactamente con el de la tabla real, y
      // el control positivo de abajo lo demuestra: la misma
      // construccion de tabla, con el indice CORRECTO, SI se acepta.
      await clienteElevado.query(
        `CREATE TABLE ${tabla} (
           id uuid NOT NULL,
           name text NOT NULL,
           singleton_key text,
           state pgboss.job_state NOT NULL,
           policy text NOT NULL
         )`,
      );
      return tabla;
    }

    it("control positivo -- un indice creado con las mismas dos columnas clave y el mismo predicado exacto que el real SI se acepta (descarta que los 3 negativos de abajo rechacen por una diferencia de tipo, no por la condicion probada)", async () => {
      const tabla = await crearTablaDePrueba("control_positivo");
      try {
        // Misma tabla (mismo tipo `pgboss.job_state` para `state`),
        // mismas dos columnas clave, mismo predicado EXACTO que
        // job_common_i6 en la base real -- ningun atajo, ninguna
        // diferencia. Si esto NO se aceptara, la causa seria un defecto
        // en la construccion de la tabla de prueba (tipos, columnas) y
        // no en la logica que los 3 negativos ejercitan.
        await clienteElevado.query(
          `CREATE UNIQUE INDEX ON ${tabla} (name, COALESCE(singleton_key, ''))
             WHERE state <= 'active' AND policy = 'exclusive'`,
        );

        const resultado = await buscarIndiceExclusividadEnTabla(boss, tabla);

        expect(resultado.existe).toBe(true);
        expect(resultado.indiceNombre).not.toBeNull();
        expect(resultado.indiceDefinicion).not.toBeNull();
        expect(resultado.unico).toBe(true);
        expect(resultado.valido).toBe(true);
        expect(resultado.listo).toBe(true);
      } finally {
        await clienteElevado.query(`DROP TABLE IF EXISTS ${tabla}`);
      }
    }, 30000);

    it("un indice que cubre unicamente state='created' (nunca <= 'active') NO se acepta como indice de exclusividad", async () => {
      const tabla = await crearTablaDePrueba("solo_created");
      try {
        // Mismas dos columnas clave que el indice real (name,
        // COALESCE(singleton_key, '')) y el mismo policy='exclusive' en
        // el predicado -- la UNICA diferencia con el indice real es
        // state='created' en vez de state<='active'. Menciona
        // "singleton_key" y "exclusive" en su definicion completa (un
        // ILIKE suelto lo aceptaria), pero deja una fila en 'retry' o
        // 'active' sin ninguna proteccion -- exactamente el hueco que
        // job_common_i6 (state<='active') SI cierra. DDL con
        // clienteElevado (neondb_owner) -- ver el comentario de arriba.
        await clienteElevado.query(
          `CREATE UNIQUE INDEX ON ${tabla} (name, COALESCE(singleton_key, ''))
             WHERE state = 'created' AND policy = 'exclusive'`,
        );

        // La verificacion bajo prueba sigue corriendo con `boss`
        // (chainpulse_app, DATABASE_URL) -- el mismo rol que usa
        // scripts/repararJobAtascado.ts en la vida real.
        const resultado = await buscarIndiceExclusividadEnTabla(boss, tabla);

        expect(resultado.existe).toBe(false);
        expect(resultado.indiceNombre).toBeNull();
        expect(resultado.indiceDefinicion).toBeNull();
      } finally {
        await clienteElevado.query(`DROP TABLE IF EXISTS ${tabla}`);
      }
    }, 30000);

    it("un indice con una columna clave extra (permite duplicados reales de name+singleton_key) NO se acepta como indice de exclusividad", async () => {
      const tabla = await crearTablaDePrueba("claves_extra");
      try {
        // Mismo predicado parcial que el indice real (state<='active' Y
        // policy='exclusive'), pero con `id` agregado como TERCERA
        // columna clave. Postgres lo sigue reportando como
        // `indisunique=true` -- la unicidad real que exige es sobre
        // (name, singleton_key, id), no sobre (name, singleton_key)
        // solo, asi que dos filas con el mismo name+singleton_key SI
        // pueden coexistir mientras tengan `id` distinto (siempre lo
        // tienen). Menciona "singleton_key" y "exclusive" en su
        // definicion completa (un ILIKE suelto tambien lo aceptaria),
        // pero no cierra el hueco que la exclusividad necesita. DDL con
        // clienteElevado (neondb_owner) -- ver el comentario de arriba.
        await clienteElevado.query(
          `CREATE UNIQUE INDEX ON ${tabla} (name, COALESCE(singleton_key, ''), id)
             WHERE state <= 'active' AND policy = 'exclusive'`,
        );

        const resultado = await buscarIndiceExclusividadEnTabla(boss, tabla);

        expect(resultado.existe).toBe(false);
        expect(resultado.indiceNombre).toBeNull();
        expect(resultado.indiceDefinicion).toBeNull();
      } finally {
        await clienteElevado.query(`DROP TABLE IF EXISTS ${tabla}`);
      }
    }, 30000);

    it("un indice con una condicion adicional en el predicado (p.ej. singleton_key puntual) NO se acepta como indice de exclusividad", async () => {
      const tabla = await crearTablaDePrueba("condicion_adicional");
      try {
        // Mismas dos columnas clave que el indice real y el MISMO
        // predicado base (state<='active' Y policy='exclusive'), pero
        // con una TERCERA condicion agregada: "AND singleton_key =
        // 'solo-otro-job'". Sigue mencionando "singleton_key" y
        // "exclusive" -- un ILIKE suelto lo aceptaria -- y sigue
        // conteniendo, en algun lugar del predicado, tanto
        // "policy='exclusive'" como "state<='active'" -- dos regex `~*`
        // de presencia TAMBIEN lo aceptarian (el falso positivo real que
        // Alex identifico). Pero este indice NO protege la cola: solo
        // exige unicidad para la fila puntual con
        // singleton_key='solo-otro-job', asi que dos jobs distintos con
        // OTRO singleton_key podrian coexistir sin violar nada -- la
        // garantia de exclusividad que recuperarJobActivoVencidoPorId()
        // necesita (una fila activa por name+singleton_key, para
        // CUALQUIER singleton_key) no esta cerrada. Debe rechazarse. DDL
        // con clienteElevado (neondb_owner) -- ver el comentario de
        // arriba.
        await clienteElevado.query(
          `CREATE UNIQUE INDEX ON ${tabla} (name, COALESCE(singleton_key, ''))
             WHERE state <= 'active' AND policy = 'exclusive' AND singleton_key = 'solo-otro-job'`,
        );

        const resultado = await buscarIndiceExclusividadEnTabla(boss, tabla);

        expect(resultado.existe).toBe(false);
        expect(resultado.indiceNombre).toBeNull();
        expect(resultado.indiceDefinicion).toBeNull();
      } finally {
        await clienteElevado.query(`DROP TABLE IF EXISTS ${tabla}`);
      }
    }, 30000);
  });
});
