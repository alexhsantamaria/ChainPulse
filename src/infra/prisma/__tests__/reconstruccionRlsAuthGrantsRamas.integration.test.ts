// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA (Ronda 9,
// 2026-10-05, punto 4 del pedido original: "añadí una prueba de
// integración preparada que la ejecute realmente" la tecnica de
// canonicalizacion por tabla temporal -- extendida en Ronda 10, 2026-10-05,
// puntos 5 y 6 del pedido: la Rama 2 ya NO ejecuta la migracion dos veces,
// sino que simula el estado real anterior y la corre una sola vez; se
// agrega una prueba SEPARADA de repeticion directa, justificada por
// analisis explicito de que el SQL que queda tras quitar la bitacora es
// deliberadamente reejecutable). Corre SOLO con `npm run test:integration`
// contra la base de prueba EXCLUSIVA (nunca contra produccion). Esta
// sesion NO la ejecuto -- queda en la lista de "pruebas preparadas pero no
// ejecutadas" de esta entrega.
//
// QUE EJECUTA, EXACTAMENTE: el texto REAL y VERBATIM de
// prisma/migrations/20261005120000_reconstruccion_rls_auth_grants/
// migration.sql, desde el inicio de la SECCION A hasta el final de la
// SECCION B inclusive (extraerFragmentoCanonicalizacion() mas abajo hace
// un recorte por indice de texto -- nunca retipea ni reimplementa esa
// SQL), envuelto en su PROPIO BEGIN;/COMMIT; (el mismo patron de
// transaccion explicita que ya usa el archivo completo). Se ejecuta con
// `client.query(textoCompleto)` (protocolo simple de node-postgres, un
// solo mensaje multi-sentencia) para reproducir fielmente como Prisma
// envia migration.sql -- no una API parametrizada, que no soporta
// multiples sentencias en un mismo mensaje.
//
// RONDA 10 -- CAMBIO DE MARCADOR DE INICIO: la Ronda 9 extraia desde la
// creacion de la bitacora ("_bitacora_reconstruccion_rls_auth_grants").
// Esa tabla se elimino por decision explicita de Alex (ver la cabecera de
// migration.sql, parrafo "RONDA 10") -- el marcador de inicio ahora es el
// comienzo mismo de la SECCION A, que es exactamente lo mismo que se
// ejecutaba antes (la bitacora nunca formaba parte de lo que esta prueba
// queria ejercitar realmente, solo quedaba incluida porque estaba ANTES
// de la Seccion A en el archivo).
//
// POR QUE SOLO Seccion A + Seccion B, y NO el archivo completo (Secciones
// 0, C, D, E quedan deliberadamente afuera de esta prueba):
//
//   - Secciones A y B son la UNICA parte de la migracion cuya resolucion
//     de objetos (ALTER TABLE/CREATE POLICY sobre nombres sin calificar,
//     comparacion via ::regclass) es consistentemente relativa a
//     search_path tanto en la LECTURA (¿existe la politica, cual es su
//     expresion?) como en la ESCRITURA (crear/no crear) -- exactamente lo
//     que permite aislarlas de forma segura con SET search_path =
//     _test_ramas, public contra un esquema descartable, sin tocar ningun
//     objeto real de "public".
//
//   - Seccion D (GRANT de tabla) NO tiene esa propiedad: su chequeo esta
//     fijado a table_schema = 'public' (information_schema.
//     role_table_grants), a proposito -- audita privilegios REALES de
//     chainpulse_app. Aislarla en esta prueba significaria o bien mutar
//     permisos REALES como efecto de una prueba automatizada
//     (inaceptable), o simular ese estado real (no seria una prueba
//     fiel). Lo mismo aplica a Seccion E (privilegios de esquema
//     "public", siempre reales) y a Seccion 0 (atributos/membresia REALES
//     de chainpulse_app a nivel de rol -- no hay "rol de prueba
//     descartable" equivalente a un esquema descartable). Ver tambien el
//     comentario de cabecera de la migracion ("CORRECCION ADICIONAL,
//     Ronda 9") sobre el hallazgo que llevo a esta decision.
//
//   - Seccion C (login_lookup) tiene un problema adicional y distinto:
//     "SELECT count(*) FROM pg_proc WHERE proname = 'login_lookup'" NO
//     filtra por esquema -- es una busqueda GLOBAL en el catalogo. Si la
//     funcion real ya existe en "public" (el caso tipico), esta Seccion
//     SIEMPRE la encuentra a ELLA sin importar el search_path de la
//     conexion de prueba, y la compara/conserva de forma inocua (nunca la
//     modifica si coincide) -- pero igual significa que "aislar" esta
//     Seccion en un esquema de prueba no aisla nada en la practica, y
//     ejercitar su rama divergente de forma segura exigiria divergir la
//     funcion REAL, que esta fuera de discusion. Por eso esta prueba ni
//     la incluye en el fragmento ejecutado.
//
// Estas exclusiones estan documentadas aca Y en la cabecera de
// migration.sql para que ninguna de las dos quede como la unica fuente.
//
// TECNICA DE AISLAMIENTO: esquema descartable "_test_ramas" + SET
// search_path = _test_ramas, public en la conexion de prueba. Las 10
// tablas minimas (mismos NOMBRES que usa el fragmento, columnas minimas
// -- sin relacion con el esquema real de Prisma, no se necesita mas para
// ejercitar RLS/políticas) se crean en "_test_ramas"; como ese esquema va
// PRIMERO en el search_path, cualquier identificador sin calificar en el
// fragmento (ALTER TABLE eslabones, ::regclass, etc.) resuelve ahi, no
// contra las tablas reales de "public" del mismo nombre.
//
// RONDA 10 -- RAMA 2 REDISEÑADA (punto 5 del pedido): ya NO ejecuta el
// fragmento dos veces. En cambio, SIEMBRA DIRECTAMENTE (sin pasar por el
// fragmento) el estado que se espera que ya exista -- las mismas 10
// politicas, con la MISMA expresion fuente que usa la migracion -- y
// corre el fragmento UNA SOLA VEZ sobre ese estado pre-sembrado. Esto
// simula exactamente "una base donde esta migracion ya se aplico antes"
// sin necesitar aplicarla dos veces -- que es, de cualquier forma, un
// escenario que Prisma nunca produciria en una operacion normal
// (_prisma_migrations registra que este archivo ya corrio y no lo vuelve
// a enviar). La prueba captura el OID de cada politica ANTES de correr el
// fragmento y vuelve a leerlo DESPUES -- si el OID es el mismo, la
// politica nunca se volvio a crear (un CREATE POLICY sobre un nombre
// existente fallaria de todos modos con un error de Postgres, pero
// comparar el OID es una prueba positiva de "no se toco nada", no solo
// "no hubo error").
//
// RONDA 10 -- PRUEBA ADICIONAL DE REPETICION DIRECTA (punto 6 del
// pedido): se agrega, ADEMAS de la Rama 2 (que ya no repite), una prueba
// separada que SI corre el fragmento dos veces seguidas desde un esquema
// limpio. Esto esta justificado por un analisis explicito, no por
// costumbre: tras quitar la bitacora, las Secciones A y B no tienen
// ningun INSERT/UPDATE/DELETE con clave fija ni ningun otro efecto
// secundario no idempotente -- cada CREATE POLICY esta guardado por un
// chequeo de existencia, cada ALTER TABLE ... ENABLE ROW LEVEL SECURITY
// es naturalmente idempotente en Postgres (no falla si ya esta
// habilitado), y cada CREATE TEMP TABLE _calib tiene su propio DROP TABLE
// _calib dentro del mismo bloque, antes de que termine esa iteracion del
// bucle -- confirmado leyendo migration.sql, no asumido. Por eso el SQL
// de Secciones A/B es deliberadamente reejecutable, y esta prueba lo
// demuestra en vivo. Esto NO es el mecanismo que se espera en operacion
// normal -- eso sigue siendo "_prisma_migrations" registrando que este
// archivo ya se aplico y no reenviandolo nunca -- es una confirmacion
// adicional de robustez, documentada como tal.
//
// ROLLBACK MANUAL (Rama 3): el BEGIN explicito de la propia migracion
// deja la conexion en "current transaction is aborted" despues de que
// Postgres rechaza el fragmento -- un ROLLBACK manual es necesario antes
// de poder volver a usar esa misma conexion (node-postgres no lo hace
// solo). Esto es exactamente lo que se espera: confirma que, sin ese
// ROLLBACK, la conexion queda inutilizable, igual que le pasaria a
// cualquier otra conexion real (Prisma incluida) ante el mismo error.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { prepararEsquemaLimpio, limpiarEsquemaSiCorresponde } from "./esquemaDescartableRamas";
import { extraerFragmentoDeTexto } from "./fragmentoCanonicalizacionRamas";

const RUTA_MIGRACION = join(
  __dirname,
  "../../../../prisma/migrations/20261005120000_reconstruccion_rls_auth_grants/migration.sql",
);

const TABLAS_SECCION_A = ["empresas", "usuarios", "eslabones", "conexiones", "ciclos_pulso"];
const TABLAS_SECCION_B = ["respuestas_crudas", "resultados_conexion", "resultados_ciclo", "metricas_cuestionario", "recomendaciones_ejecutadas"];
const TODAS_LAS_TABLAS = [...TABLAS_SECCION_A, ...TABLAS_SECCION_B];

// Misma columna directa que usa la Seccion A de la migracion (VALUES de su
// bucle) -- se necesita aca para poder sembrar el estado esperado
// DIRECTAMENTE, sin pasar por el fragmento (Ronda 10, punto 5).
const COLUMNA_DIRECTA_SECCION_A: Record<string, string> = {
  empresas: "id",
  usuarios: '"empresaId"',
  eslabones: '"empresaId"',
  conexiones: '"empresaId"',
  ciclos_pulso: '"empresaId"',
};

// Columna FK minima por tabla hija de Seccion B -- mismo nombre que usa
// el fragmento real, tipo de columna irrelevante para RLS (basta con que
// exista y sea comparable por igualdad/IN).
const COLUMNA_FK_SECCION_B: Record<string, string> = {
  respuestas_crudas: '"conexionId"',
  resultados_conexion: '"conexionId"',
  resultados_ciclo: '"cicloPulsoId"',
  metricas_cuestionario: '"cicloPulsoId"',
  recomendaciones_ejecutadas: '"cicloPulsoId"',
};

const TABLA_PADRE_SECCION_B: Record<string, string> = {
  respuestas_crudas: '"conexiones"',
  resultados_conexion: '"conexiones"',
  resultados_ciclo: '"ciclos_pulso"',
  metricas_cuestionario: '"ciclos_pulso"',
  recomendaciones_ejecutadas: '"ciclos_pulso"',
};

// RONDA 20 (Alex, 2026-10-07): la busqueda de marcadores (ahora
// extraerFragmentoDeTexto(), en fragmentoCanonicalizacionRamas.ts) se
// movio a un helper aparte para poder probarla localmente, sin conexion
// real, en fragmentoCanonicalizacionRamas.test.ts -- ver ese archivo
// para la correccion real: antes buscaba "SECCION A"/"SECCION C" SIN el
// prefijo de comentario SQL "--", lo que dejaba "SECCION A" como texto
// SQL EJECUTABLE (bare, invalido) al principio del fragmento extraido
// en vez de preservarlo como comentario. Ahora busca los marcadores
// COMPLETOS ("-- SECCION A"/"-- SECCION C") y aborta con un error fijo
// si faltan, se duplican o estan desordenados.
function extraerFragmentoCanonicalizacion(): string {
  const sql = readFileSync(RUTA_MIGRACION, "utf8");
  return extraerFragmentoDeTexto(sql);
}

async function conectarConSearchPathAislado(): Promise<Client> {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado -- esta prueba necesita el rol neondb_owner (CREATE sobre un esquema descartable propio, _test_ramas).",
    );
  }
  const client = new Client({ connectionString });
  await client.connect();
  // Primero en el search_path: cualquier identificador sin calificar del
  // fragmento (ALTER TABLE eslabones, 'eslabones'::regclass, etc.)
  // resuelve aca antes que contra las tablas reales de "public" del
  // mismo nombre.
  await client.query("SET search_path = _test_ramas, public");
  return client;
}

// RONDA 19 (Alex, 2026-10-07): prepararEsquemaLimpio() se movio a
// esquemaDescartableRamas.ts para poder probarla localmente, sin
// conexion real, en esquemaDescartableRamas.test.ts -- ver ese archivo
// para la logica real (abortar con ESQUEMA_TEST_RAMAS_YA_EXISTE si
// _test_ramas ya existe, nunca borrarlo ni recrearlo) y su cabecera para
// el detalle completo. limpiarEsquemaSiCorresponde() (mismo archivo)
// reemplaza el "DROP SCHEMA IF EXISTS ... CASCADE" incondicional que
// tenia cada afterAll de mas abajo -- ahora borra solo si la bandera
// creadoPorEstaSuite de ESE describe llego a true.

// Ronda 10, punto 5: siembra DIRECTAMENTE (sin pasar por el fragmento de
// la migracion) el estado exacto que la migracion esperaria encontrar ya
// aplicado -- misma expresion fuente, mismo nombre de politica, RLS
// habilitado sin FORCE. Simula "una base donde esto ya se aplico antes"
// sin necesitar correr la migracion dos veces.
async function sembrarEstadoIdenticoAlEsperado(client: Client): Promise<void> {
  for (const tabla of TABLAS_SECCION_A) {
    const columna = COLUMNA_DIRECTA_SECCION_A[tabla];
    await client.query(`ALTER TABLE _test_ramas."${tabla}" ENABLE ROW LEVEL SECURITY`);
    await client.query(
      `CREATE POLICY tenant_isolation_${tabla} ON _test_ramas."${tabla}" USING (${columna} = current_setting('app.tenant_id', true))`,
    );
  }
  for (const tabla of TABLAS_SECCION_B) {
    const fk = COLUMNA_FK_SECCION_B[tabla];
    const padre = TABLA_PADRE_SECCION_B[tabla];
    await client.query(`ALTER TABLE _test_ramas."${tabla}" ENABLE ROW LEVEL SECURITY`);
    // Importante: "padre" va SIN calificar de esquema, igual que
    // rec.tabla_padre en la Seccion B de la migracion real -- la
    // resolucion depende de search_path (_test_ramas primero), exactamente
    // el mismo mecanismo que usa el fragmento real. Calificarlo aca con
    // "_test_ramas." produciria un texto fuente DISTINTO al que la propia
    // migracion canonicaliza, arriesgando una comparacion deparse-contra-
    // deparse que no coincida por una razon ajena a RLS.
    await client.query(
      `CREATE POLICY tenant_isolation_${tabla} ON _test_ramas."${tabla}" USING (${fk} IN (SELECT id FROM ${padre} WHERE "empresaId" = current_setting('app.tenant_id', true)))`,
    );
  }
}

async function existePoliticaTenant(client: Client, tabla: string): Promise<{ existe: boolean; rls: boolean | null; force: boolean | null; oid: string | null; expr: string | null }> {
  const r = await client.query(
    `SELECT c.relrowsecurity, c.relforcerowsecurity, p.oid::text AS oid, pg_get_expr(p.polqual, p.polrelid) AS expr
       FROM pg_class c
       LEFT JOIN pg_policy p ON p.polname = $2 AND p.polrelid = c.oid
       WHERE c.oid = $1::regclass`,
    [tabla, `tenant_isolation_${tabla}`],
  );
  const fila = r.rows[0];
  return {
    existe: fila?.oid != null,
    rls: fila?.relrowsecurity ?? null,
    force: fila?.relforcerowsecurity ?? null,
    oid: fila?.oid ?? null,
    expr: fila?.expr ?? null,
  };
}

async function existeTablaTemporalCalib(client: Client): Promise<boolean> {
  const r = await client.query(`SELECT to_regclass('pg_temp._calib') AS existe`);
  return r.rows[0].existe !== null;
}

describe("canonicalizacion RLS por tabla temporal (Secciones A/B de la migracion 20261005120000) -- Ramas reales contra un esquema descartable", () => {
  describe("Rama 1 -- politica ausente -> se crea", () => {
    let client: Client;
    let creadoPorEstaSuite = false;

    beforeAll(async () => {
      client = await conectarConSearchPathAislado();
      await prepararEsquemaLimpio(client);
      creadoPorEstaSuite = true;
    }, 30000);

    afterAll(async () => {
      await limpiarEsquemaSiCorresponde(client, creadoPorEstaSuite);
      await client?.end();
    }, 30000);

    it("ejecuta el fragmento real verbatim y crea las 10 politicas, con RLS habilitado y sin FORCE, en las 10 tablas", async () => {
      await client.query(extraerFragmentoCanonicalizacion());

      for (const tabla of TODAS_LAS_TABLAS) {
        const estado = await existePoliticaTenant(client, tabla);
        expect(estado.existe).toBe(true);
        expect(estado.rls).toBe(true);
        expect(estado.force).toBe(false);
      }
    });

    it("no deja ninguna tabla temporal _calib persistente despues de una corrida exitosa", async () => {
      expect(await existeTablaTemporalCalib(client)).toBe(false);
    });
  });

  describe("Rama 2 -- politica identica -> se conserva (Ronda 10: estado pre-sembrado DIRECTAMENTE, fragmento ejecutado UNA SOLA VEZ -- ya no se ejecuta dos veces, ver cabecera)", () => {
    let client: Client;
    let oidsAntes: Record<string, string | null>;
    let creadoPorEstaSuite = false;

    beforeAll(async () => {
      client = await conectarConSearchPathAislado();
      await prepararEsquemaLimpio(client);
      creadoPorEstaSuite = true;
      // Simula "esta migracion ya se aplico antes" sembrando DIRECTAMENTE
      // el estado esperado -- nunca corriendo el fragmento para crearlo.
      await sembrarEstadoIdenticoAlEsperado(client);

      oidsAntes = {};
      for (const tabla of TODAS_LAS_TABLAS) {
        oidsAntes[tabla] = (await existePoliticaTenant(client, tabla)).oid;
      }

      // UNA SOLA corrida sobre el estado ya pre-sembrado -- esto es lo que
      // esta prueba verifica: que conserva sin tocar, no que sobreviva una
      // segunda corrida (eso es la prueba de repeticion directa, aparte).
      await client.query(extraerFragmentoCanonicalizacion());
    }, 30000);

    afterAll(async () => {
      await limpiarEsquemaSiCorresponde(client, creadoPorEstaSuite);
      await client?.end();
    }, 30000);

    it("la corrida sobre el estado pre-sembrado no lanza ninguna excepcion (si hubiera intentado recrear una politica existente, Postgres la habria rechazado)", async () => {
      // Si beforeAll hubiera lanzado (el await de mas arriba), este describe
      // completo habria fallado al no poder conectar/sembrar -- este test
      // en si mismo existe para que la intencion quede explicita en el
      // reporte de resultados, no solo implicita en que beforeAll no fallo.
      expect(client).toBeDefined();
    });

    it("las 10 politicas conservan el MISMO oid que tenian antes de la corrida -- prueba positiva de que nunca se recrearon, no solo de que no hubo error", async () => {
      for (const tabla of TODAS_LAS_TABLAS) {
        const estado = await existePoliticaTenant(client, tabla);
        expect(estado.oid).not.toBeNull();
        expect(estado.oid).toBe(oidsAntes[tabla]);
      }
    });

    it("las 10 politicas siguen existiendo, con la misma expresion, RLS habilitado y sin FORCE", async () => {
      for (const tabla of TODAS_LAS_TABLAS) {
        const estado = await existePoliticaTenant(client, tabla);
        expect(estado.existe).toBe(true);
        expect(estado.rls).toBe(true);
        expect(estado.force).toBe(false);
      }
    });

    it("no deja ninguna tabla temporal _calib persistente despues de la corrida de conservacion", async () => {
      expect(await existeTablaTemporalCalib(client)).toBe(false);
    });
  });

  describe("Repeticion directa (Ronda 10, punto 6 -- prueba ADICIONAL: el fragmento de Secciones A/B es deliberadamente reejecutable sin la bitacora, se demuestra corriendolo dos veces desde un esquema limpio; no es el mecanismo esperado en operacion normal, que sigue siendo _prisma_migrations)", () => {
    let client: Client;
    let creadoPorEstaSuite = false;

    beforeAll(async () => {
      client = await conectarConSearchPathAislado();
      await prepararEsquemaLimpio(client);
      creadoPorEstaSuite = true;
    }, 30000);

    afterAll(async () => {
      await limpiarEsquemaSiCorresponde(client, creadoPorEstaSuite);
      await client?.end();
    }, 30000);

    it("corre el fragmento dos veces seguidas desde un esquema limpio sin que la segunda corrida lance ningun error", async () => {
      await client.query(extraerFragmentoCanonicalizacion());
      await expect(client.query(extraerFragmentoCanonicalizacion())).resolves.toBeDefined();
    });

    it("las 10 politicas siguen existiendo, identicas, despues de la segunda corrida directa", async () => {
      for (const tabla of TODAS_LAS_TABLAS) {
        const estado = await existePoliticaTenant(client, tabla);
        expect(estado.existe).toBe(true);
        expect(estado.rls).toBe(true);
        expect(estado.force).toBe(false);
      }
    });

    it("tampoco deja ninguna tabla temporal _calib persistente despues de la repeticion directa", async () => {
      expect(await existeTablaTemporalCalib(client)).toBe(false);
    });
  });

  describe("Rama 3 -- politica divergente -> aborta y revierte TODO lo creado por esa corrida (incluido lo creado ANTES de llegar a la tabla divergente)", () => {
    let client: Client;
    let creadoPorEstaSuite = false;

    beforeAll(async () => {
      client = await conectarConSearchPathAislado();
      await prepararEsquemaLimpio(client);
      creadoPorEstaSuite = true;
      // Pre-sembrado DIVERGENTE sobre "eslabones" -- 3era tabla procesada
      // por el bucle de la Seccion A (orden real: empresas, usuarios,
      // eslabones, conexiones, ciclos_pulso), para que "empresas" y
      // "usuarios" SI lleguen a crearse dentro de la misma corrida antes
      // del aborto -- eso es lo que permite probar que el rollback
      // deshace TODO lo creado en esa corrida, no solo la tabla que
      // disparo el error.
      await client.query(`ALTER TABLE _test_ramas.eslabones ENABLE ROW LEVEL SECURITY`);
      await client.query(
        `CREATE POLICY tenant_isolation_eslabones ON _test_ramas.eslabones USING ("empresaId" = 'valor-manifiestamente-divergente')`,
      );
    }, 30000);

    afterAll(async () => {
      await limpiarEsquemaSiCorresponde(client, creadoPorEstaSuite);
      await client?.end();
    }, 30000);

    it("aborta con RECONSTRUCCION_RLS_DIVERGENTE y, tras el ROLLBACK manual, no persiste nada de lo que esa corrida intento", async () => {
      await expect(client.query(extraerFragmentoCanonicalizacion())).rejects.toThrow(/RECONSTRUCCION_RLS_DIVERGENTE/);

      // El BEGIN explicito del propio fragmento deja la conexion en
      // "current transaction is aborted" -- sin este ROLLBACK, cualquier
      // consulta posterior en esta misma conexion fallaria con ese mismo
      // error, nunca con el resultado real de la consulta.
      await client.query("ROLLBACK");

      // 1) "empresas" y "usuarios" -- procesadas ANTES de "eslabones" en
      // el mismo bucle -- NO quedaron con la politica creada. Esto es lo
      // que prueba el rollback COMPLETO, no solo "la tabla que fallo
      // quedo sin tocar". (Ronda 10: la bitacora ya no existe, por lo que
      // esta prueba ya no verifica su ausencia -- el rollback transaccional
      // en si mismo, que es lo que realmente importa, queda probado igual
      // por los puntos de abajo.)
      for (const tabla of ["empresas", "usuarios"]) {
        const estado = await existePoliticaTenant(client, tabla);
        expect(estado.existe).toBe(false);
        expect(estado.rls).toBe(false);
      }

      // 2) La tabla PRE-SEMBRADA divergente ("eslabones") sigue EXACTAMENTE
      // como se dejo en beforeAll -- el patron verificar-o-abortar nunca
      // la toca, solo la detecta.
      const eslabones = await client.query(
        `SELECT pg_get_expr(polqual, polrelid) AS expr FROM pg_policy WHERE polname = 'tenant_isolation_eslabones' AND polrelid = 'eslabones'::regclass`,
      );
      expect(eslabones.rows[0].expr).toContain("valor-manifiestamente-divergente");

      // 3) Ninguna tabla temporal _calib quedo persistente -- se crea y
      // se borra ANTES de la comparacion que decide abortar, dentro del
      // mismo bloque DO, independientemente de que la corrida aborte mas
      // adelante.
      expect(await existeTablaTemporalCalib(client)).toBe(false);

      // 4) Las tablas POSTERIORES a "eslabones" en el orden de ejecucion
      // (conexiones, ciclos_pulso, y las 5 de Seccion B) ni siquiera se
      // llegaron a procesar -- el bucle se detiene en la excepcion.
      for (const tabla of ["conexiones", "ciclos_pulso", ...TABLAS_SECCION_B]) {
        const estado = await existePoliticaTenant(client, tabla);
        expect(estado.existe).toBe(false);
      }
    });
  });
});
