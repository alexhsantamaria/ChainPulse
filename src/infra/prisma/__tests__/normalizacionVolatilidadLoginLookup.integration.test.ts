// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA. Cubre
// la correccion de la Seccion C de
// prisma/migrations/20261005120000_reconstruccion_rls_auth_grants/
// migration.sql autorizada por Alex el 2026-10-08, sobre el hallazgo
// real de un predeploy contra una rama "data and schema" de produccion
// (106 chequeos: 103 OK, 3 divergentes -- 2 politicas RLS ausentes en
// Seccion B, resueltas por su propio patron crear-si-falta en la MISMA
// corrida en cuanto Seccion C deja de abortar; mas login_lookup(text)
// encontrado VOLATILE donde se esperaba STABLE). Corre SOLO con
// `npm run test:integration` -- excluida de la suite unitaria comun por
// su propio nombre de archivo (*.integration.test.ts), igual que el
// resto de pruebas de integracion del repositorio: vitest.config.ts
// (`exclude: ["src/**/*.integration.test.ts"]`) la deja afuera de `npm
// run test`; solo vitest.integration.config.ts (`npm run
// test:integration`) la incluye. Esta prueba no necesita ningun ajuste
// adicional de configuracion para cumplir ese punto -- ya lo cumple por
// convencion de nombre, igual que sus archivos hermanos.
//
// POR QUE ESTA PRUEBA NO REUSA EL ESQUEMA DESCARTABLE "_test_ramas" NI
// LA CONEXION COMPARTIDA DE reconstruccionRlsAuthGrantsRamas.integration.
// test.ts: esa prueba EXCLUYE deliberadamente la Seccion C de su
// fragmento (ver su propia cabecera, parrafo "Seccion C (login_lookup)
// tiene un problema adicional...") porque "SELECT count(*) FROM pg_proc
// WHERE proname = 'login_lookup'" es una busqueda GLOBAL del catalogo,
// sin filtro de esquema -- si la funcion real ya existe en "public" (el
// caso tipico en la rama compartida de integracion), Seccion C SIEMPRE
// la encuentra a ELLA, sin importar el search_path de la conexion de
// prueba. Aislar esto en un esquema NO aisla nada en la practica, y
// ademas la identidad esperada de Seccion C exige explicitamente
// v_esquema = 'public' (aborta con RECONSTRUCCION_AUTH_DIVERGENTE si la
// funcion de prueba vive en cualquier otro esquema) -- no hay forma de
// mover la funcion de prueba a un esquema propio sin que la migracion
// misma la rechace por esquema incorrecto. "ejercitar su rama divergente
// de forma segura exigiria divergir la funcion REAL, que esta fuera de
// discusion" (cita textual de esa cabecera) sigue vigente -- esta prueba
// la honra al pie de la letra, usando una base de datos DESCARTABLE
// PROPIA en vez de un esquema dentro de la rama compartida.
//
// TECNICA DE AISLAMIENTO: cada escenario crea su PROPIA base de datos
// descartable (CREATE DATABASE, nombre aleatorio) dentro del MISMO
// cluster/rama que ya apunta SEED_DATABASE_URL, corre el archivo
// COMPLETO de la migracion ahi (las 14 tablas minimas se crean a mano,
// los roles chainpulse_app/neondb_owner son a nivel de CLUSTER -- ya
// existen, no se tocan ni se recrean), y la borra en el `finally` de
// conEscenario() (ver mas abajo), nunca en un hook afterEach aparte --
// Alex, 2026-10-08, segunda revision: un try/finally explicito alrededor
// de cada escenario no depende de que el framework de pruebas garantice
// que un hook de limpieza corra despues de un hook de preparacion
// fallido. pg_proc es un catalogo POR BASE DE DATOS en Postgres -- una
// base de datos nueva nunca tiene ningun "login_lookup" preexistente,
// real o no, sin importar cuantos existan en la base de datos por
// defecto de la rama. Esto nunca toca, lee ni modifica el
// "public.login_lookup" real de la rama compartida de integracion.
//
// ENDURECIMIENTO ADICIONAL (Alex, 2026-10-08, segunda revision), sobre
// el hecho de que esta prueba ejecuta CREATE DATABASE/DROP DATABASE a
// nivel de CLUSTER -- un alcance mayor que las pruebas de integracion ya
// existentes de Prisma (que solo leen/escriben filas y esquemas dentro
// de una base ya existente) e incluso mayor que las 3 pruebas de
// Cobertura que ya exigen una confirmacion explicita de entorno
// (entornoPruebasIntegracionCobertura.ts, Incremento 4 Bloque B):
//   1) Gate explicito de pruebas destructivas + entorno no productivo
//      verificado: requerirConfirmacionPruebasDestructivas() (mas abajo)
//      exige, ADEMAS de SEED_DATABASE_URL, la variable de entorno
//      CHAINPULSE_CONFIRMAR_PRUEBAS_DESTRUCTIVAS con el valor exacto
//      "confirmo-entorno-de-pruebas-no-produccion" -- el MISMO nombre y
//      MISMO valor que ya usa entornoPruebasIntegracionCobertura.ts.
//      Deliberadamente NO se importa ese archivo (es especifico de los
//      fixtures de Cobertura; acoplar esta prueba de Prisma a ese modulo
//      mezclaria dominios sin necesidad) -- se repite el mismo nombre/
//      valor de variable a proposito, para que una sola confirmacion
//      explicita del desarrollador o de CI ("esto no es produccion")
//      cubra ambas familias de pruebas de integracion del repositorio,
//      sin que cada una invente su propia variable paralela. Se llama
//      SIEMPRE como primera linea de conEscenario(), antes de crear
//      ninguna base de datos -- mismo criterio que esa funcion hermana.
//   2) Nombres unicos: randomUUID() por escenario (sin cambios).
//   3) Abortar si la base ya existe: crearBaseDescartable() verifica
//      contra pg_database ANTES de emitir CREATE DATABASE y aborta con
//      BASE_DESCARTABLE_YA_EXISTE si encuentra una coincidencia -- nunca
//      reutiliza ni sobrescribe -- mismo patron que
//      ESQUEMA_TEST_RAMAS_YA_EXISTE en esquemaDescartableRamas.ts.
//   4) Bandera creadaPorEstaSuite: conEscenario() solo la pone en true
//      DESPUES de que crearBaseDescartable() confirma que el CREATE
//      DATABASE tuvo exito -- si la preparacion falla antes de ese
//      punto (gate, chequeo de preexistencia, o el propio CREATE
//      DATABASE), nunca se intenta ningun DROP DATABASE.
//   5) Cleanup en finally + borrado exclusivo de su propia base:
//      conEscenario() envuelve conexion/preparacion/ejecucion del
//      escenario en un try/finally; el finally cierra el cliente y
//      borra, por nombre exacto capturado en una variable local de esa
//      misma llamada (nunca una variable compartida a nivel de
//      describe), UNICAMENTE la base que esa llamada creo -- ninguna
//      base de otro escenario puede ser alcanzada desde aca.
//
// Requiere que el rol de SEED_DATABASE_URL tenga CREATEDB (neondb_owner
// lo tiene por defecto en Neon) -- si no lo tiene, conEscenario() falla
// con un mensaje claro de Postgres (permission denied to create
// database), nunca en silencio.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const RUTA_MIGRACION = join(
  __dirname,
  "../../../../prisma/migrations/20261005120000_reconstruccion_rls_auth_grants/migration.sql",
);

function leerMigracionCompleta(): string {
  return readFileSync(RUTA_MIGRACION, "utf8");
}

function requerirSeedDatabaseUrl(): string {
  const url = process.env.SEED_DATABASE_URL;
  if (!url) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado -- esta prueba necesita un rol con CREATEDB (neondb_owner) para crear y borrar bases de datos descartables propias.",
    );
  }
  return url;
}

// Mismo nombre y mismo valor EXACTO que VARIABLE_CONFIRMACION_ENTORNO/
// VALOR_CONFIRMACION_ENTORNO de entornoPruebasIntegracionCobertura.ts
// (src/infra/kpis/cobertura/__tests__/) -- ver el parrafo "ENDURECIMIENTO
// ADICIONAL" de la cabecera de este archivo para la justificacion
// completa de por que se repite en vez de importarse.
const VARIABLE_CONFIRMACION_ENTORNO = "CHAINPULSE_CONFIRMAR_PRUEBAS_DESTRUCTIVAS";
const VALOR_CONFIRMACION_ENTORNO = "confirmo-entorno-de-pruebas-no-produccion";

/**
 * Llamar SIEMPRE como primera linea de conEscenario() -- lanza (fallando
 * el escenario entero, antes de crear ninguna base de datos) si falta la
 * confirmacion explicita de entorno no productivo, con el valor exacto.
 */
function requerirConfirmacionPruebasDestructivas(): void {
  if (process.env[VARIABLE_CONFIRMACION_ENTORNO] !== VALOR_CONFIRMACION_ENTORNO) {
    throw new Error(
      `Esta prueba crea Y BORRA bases de datos completas (CREATE DATABASE/DROP DATABASE) en el cluster de SEED_DATABASE_URL -- un alcance mayor que leer/escribir filas o esquemas dentro de una base ya existente. Por seguridad, ademas de SEED_DATABASE_URL hace falta confirmar explicitamente que ese cluster NUNCA es produccion -- definir ${VARIABLE_CONFIRMACION_ENTORNO}=${VALOR_CONFIRMACION_ENTORNO} en el entorno antes de correr \`npm run test:integration\`. Sin esta confirmacion, la prueba se niega a correr -- no alcanza con que SEED_DATABASE_URL exista.`,
    );
  }
}

// Reemplaza el nombre de base de datos en una connection string de
// Postgres, conservando host/puerto/credenciales/parametros -- nunca se
// construye la URL a mano concatenando strings, para no romper una
// password con caracteres especiales ya escapados en la URL original.
function urlConBase(url: string, nombreBase: string): string {
  const u = new URL(url);
  u.pathname = `/${nombreBase}`;
  return u.toString();
}

/**
 * Crea una base de datos descartable con nombre aleatorio -- PERO aborta
 * con un error fijo y claro, sin escribir nada (ni DROP ni CREATE), si
 * una base con ese nombre exacto ya existe. Mismo criterio defensivo que
 * prepararEsquemaLimpio()/ESQUEMA_TEST_RAMAS_YA_EXISTE en
 * esquemaDescartableRamas.ts, aplicado a bases de datos en vez de
 * esquemas: una colision de randomUUID() es astronomicamente improbable,
 * pero esta prueba nunca asume -- verifica.
 */
async function crearBaseDescartable(): Promise<{ nombreBase: string; url: string }> {
  const urlOriginal = requerirSeedDatabaseUrl();
  const nombreBase = `cp_test_login_lookup_${randomUUID().replace(/-/g, "")}`;
  const bootstrap = new Client({ connectionString: urlOriginal });
  await bootstrap.connect();
  try {
    const existente = await bootstrap.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [nombreBase]);
    if ((existente.rowCount ?? 0) > 0) {
      throw new Error(
        `BASE_DESCARTABLE_YA_EXISTE: la base de datos descartable "${nombreBase}" ya existe -- esta prueba nunca borra ni reutiliza una base que no creo ella misma en esta misma corrida. Investigar manualmente antes de volver a correr esta suite.`,
      );
    }
    await bootstrap.query(`CREATE DATABASE "${nombreBase}"`);
  } finally {
    await bootstrap.end();
  }
  return { nombreBase, url: urlConBase(urlOriginal, nombreBase) };
}

async function borrarBaseDescartable(nombreBase: string): Promise<void> {
  const urlOriginal = requerirSeedDatabaseUrl();
  const bootstrap = new Client({ connectionString: urlOriginal });
  await bootstrap.connect();
  try {
    await bootstrap.query(`DROP DATABASE IF EXISTS "${nombreBase}"`);
  } finally {
    await bootstrap.end();
  }
}

// Las 14 tablas minimas que las Secciones A/B/D/E referencian, mas la
// unica tabla y el unico enum que la Seccion C necesita para
// login_lookup(text) -- mismas columnas minimas que ya usa
// reconstruccionRlsAuthGrantsRamas.integration.test.ts para A/B, mas las
// columnas reales de "usuarios" que el cuerpo de login_lookup selecciona
// (ver prisma/schema.prisma). Los roles chainpulse_app/neondb_owner son
// de CLUSTER, no de base de datos -- ya existen en esta base de datos
// nueva sin que esta prueba los cree.
async function prepararTablasMinimas(client: Client): Promise<void> {
  await client.query(`CREATE TYPE "RolUsuario" AS ENUM ('ADMINISTRADOR', 'MIEMBRO')`);
  await client.query(`CREATE TABLE empresas (id text primary key)`);
  await client.query(`
    CREATE TABLE usuarios (
      id text primary key,
      "empresaId" text not null,
      email text,
      nombre text,
      rol "RolUsuario",
      "passwordHash" text,
      "mfaSecret" text,
      "mfaHabilitado" boolean,
      "intentosFallidos" integer,
      "bloqueadoHasta" timestamp,
      "eslabonId" text
    )
  `);
  await client.query(`CREATE TABLE eslabones ("empresaId" text)`);
  await client.query(`CREATE TABLE conexiones (id text primary key, "empresaId" text)`);
  await client.query(`CREATE TABLE ciclos_pulso (id text primary key, "empresaId" text)`);
  await client.query(`CREATE TABLE respuestas_crudas ("conexionId" text)`);
  await client.query(`CREATE TABLE resultados_conexion ("conexionId" text)`);
  await client.query(`CREATE TABLE resultados_ciclo ("cicloPulsoId" text)`);
  await client.query(`CREATE TABLE metricas_cuestionario ("cicloPulsoId" text)`);
  await client.query(`CREATE TABLE recomendaciones_ejecutadas ("cicloPulsoId" text)`);
  await client.query(`CREATE TABLE evaluaciones_expres (id text primary key)`);
  await client.query(`CREATE TABLE evaluaciones_expres_eslabones (id text primary key)`);
  await client.query(`CREATE TABLE evaluaciones_expres_conexiones (id text primary key)`);
  await client.query(`CREATE TABLE limite_tasa (id text primary key)`);
}

/**
 * Orquesta un escenario completo: confirma el gate de pruebas
 * destructivas, crea una base de datos descartable propia, conecta,
 * prepara las tablas minimas, ejecuta `cuerpo` con ese cliente, y SIEMPRE
 * limpia en un `finally` explicito -- cierra el cliente y, solo si la
 * base llego a crearse con exito (creadaPorEstaSuite), la borra por su
 * nombre exacto. Nunca depende de que vitest garantice el orden/la
 * ejecucion de hooks afterEach cuando un hook beforeEach anterior falla:
 * el try/finally de esta funcion es explicito e incondicional.
 */
async function conEscenario(cuerpo: (client: Client) => Promise<void>): Promise<void> {
  requerirConfirmacionPruebasDestructivas();

  let nombreBase: string | undefined;
  let creadaPorEstaSuite = false;
  let client: Client | undefined;

  try {
    const creada = await crearBaseDescartable();
    nombreBase = creada.nombreBase;
    // Solo a partir de aca: crearBaseDescartable() ya confirmo que el
    // CREATE DATABASE tuvo exito. Si algo FALLA antes de esta linea
    // (gate, chequeo de preexistencia, o el CREATE DATABASE en si), esta
    // bandera nunca llega a true y el finally de mas abajo nunca intenta
    // ningun DROP DATABASE.
    creadaPorEstaSuite = true;

    client = new Client({ connectionString: creada.url });
    await client.connect();
    await prepararTablasMinimas(client);
    await cuerpo(client);
  } finally {
    await client?.end().catch(() => {});
    if (creadaPorEstaSuite && nombreBase) {
      await borrarBaseDescartable(nombreBase);
    }
  }
}

// Cuerpo EXACTO que espera la Seccion C (v_prosrc_esperado) -- se repite
// aca a proposito, nunca importado de la migracion, para que una prueba
// que sembrara deliberadamente un cuerpo DISTINTO (no es el caso de los
// escenarios de este archivo, que nunca necesitan un cuerpo divergente)
// pudiera hacerlo sin editar este helper.
const CUERPO_LOGIN_LOOKUP = `
  SELECT id, "empresaId", email, nombre, rol, "passwordHash", "mfaSecret",
         "mfaHabilitado", "intentosFallidos", "bloqueadoHasta", "eslabonId"
  FROM usuarios
  WHERE email = p_email
  LIMIT 1;
`;

/**
 * Crea login_lookup(text) EXACTAMENTE con la identidad/contenido que la
 * Seccion C espera, pero con la volatilidad/SECURITY DEFINER que indique
 * el llamador -- para poder sembrar, a voluntad, "coincide en todo salvo
 * volatilidad" (escenario 2) o "diverge en algo mas, no solo volatilidad"
 * (escenario 4).
 */
async function sembrarLoginLookupExistente(
  client: Client,
  opciones: { volatilidad: "STABLE" | "VOLATILE" | "IMMUTABLE"; securityDefiner: boolean },
): Promise<void> {
  await client.query(`
    CREATE FUNCTION login_lookup(p_email text)
    RETURNS TABLE (
      id text, "empresaId" text, email text, nombre text, rol "RolUsuario",
      "passwordHash" text, "mfaSecret" text, "mfaHabilitado" boolean,
      "intentosFallidos" integer, "bloqueadoHasta" timestamp, "eslabonId" text
    )
    LANGUAGE sql
    ${opciones.volatilidad}
    ${opciones.securityDefiner ? "SECURITY DEFINER" : ""}
    SET search_path = public
    AS $BODY$${CUERPO_LOGIN_LOOKUP}$BODY$
  `);
  await client.query(`REVOKE ALL ON FUNCTION login_lookup(text) FROM PUBLIC`);
  await client.query(`GRANT EXECUTE ON FUNCTION login_lookup(text) TO chainpulse_app`);
}

async function leerIdentidadActual(
  client: Client,
): Promise<{ oid: string; provolatile: string; prosecdef: boolean }> {
  const r = await client.query(
    `SELECT oid::text AS oid, provolatile, prosecdef FROM pg_proc WHERE proname = 'login_lookup'`,
  );
  return r.rows[0];
}

describe("normalizacion de volatilidad de login_lookup (Seccion C de la migracion 20261005120000) -- bases de datos descartables propias", () => {
  it("escenario 1 -- login_lookup no existe: la migracion la crea como STABLE (comportamiento ya existente, sin cambios)", async () => {
    await conEscenario(async (client) => {
      await client.query(leerMigracionCompleta());

      const identidad = await leerIdentidadActual(client);
      expect(identidad.provolatile).toBe("s");
      expect(identidad.prosecdef).toBe(true);
    });
  });

  it("escenario 2 -- login_lookup existe VOLATILE con identidad y contenido validos: queda STABLE y conserva el mismo oid", async () => {
    await conEscenario(async (client) => {
      await sembrarLoginLookupExistente(client, { volatilidad: "VOLATILE", securityDefiner: true });
      const antes = await leerIdentidadActual(client);
      expect(antes.provolatile).toBe("v");

      await client.query(leerMigracionCompleta());

      const despues = await leerIdentidadActual(client);
      expect(despues.provolatile).toBe("s");
      expect(despues.oid).toBe(antes.oid);
    });
  });

  it("escenario 3 -- login_lookup ya es STABLE: la migracion no la toca (mismo oid, segunda corrida sin cambios)", async () => {
    await conEscenario(async (client) => {
      await client.query(leerMigracionCompleta());
      const antes = await leerIdentidadActual(client);
      expect(antes.provolatile).toBe("s");

      // Segunda corrida completa sobre un estado ya reconciliado -- debe
      // conservar sin lanzar y sin recrear la funcion.
      await client.query(leerMigracionCompleta());

      const despues = await leerIdentidadActual(client);
      expect(despues.provolatile).toBe("s");
      expect(despues.oid).toBe(antes.oid);
    });
  });

  it("escenario 4 -- login_lookup diverge en algo MAS que volatilidad (sin SECURITY DEFINER): aborta, nunca se auto-corrige", async () => {
    await conEscenario(async (client) => {
      await sembrarLoginLookupExistente(client, { volatilidad: "STABLE", securityDefiner: false });

      await expect(client.query(leerMigracionCompleta())).rejects.toThrow(/RECONSTRUCCION_AUTH_DIVERGENTE/);
      await client.query("ROLLBACK");

      // Nada se toco: sigue exactamente como se sembro.
      const estado = await leerIdentidadActual(client);
      expect(estado.provolatile).toBe("s");
      expect(estado.prosecdef).toBe(false);
    });
  });

  it("escenario 4b -- login_lookup coincide en todo salvo una volatilidad inesperada que no es ni STABLE ni VOLATILE (IMMUTABLE): aborta, nunca se auto-corrige", async () => {
    await conEscenario(async (client) => {
      await sembrarLoginLookupExistente(client, { volatilidad: "IMMUTABLE", securityDefiner: true });

      await expect(client.query(leerMigracionCompleta())).rejects.toThrow(/RECONSTRUCCION_AUTH_DIVERGENTE/);
      await client.query("ROLLBACK");

      const estado = await leerIdentidadActual(client);
      expect(estado.provolatile).toBe("i");
    });
  });

  it("escenario 5 -- las 2 politicas RLS ausentes (metricas_cuestionario, recomendaciones_ejecutadas) se crean en la MISMA corrida que normaliza la volatilidad", async () => {
    await conEscenario(async (client) => {
      await sembrarLoginLookupExistente(client, { volatilidad: "VOLATILE", securityDefiner: true });

      await client.query(leerMigracionCompleta());

      for (const tabla of ["metricas_cuestionario", "recomendaciones_ejecutadas"]) {
        const r = await client.query(
          `SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = $1::regclass`,
          [tabla],
        );
        expect(r.rows[0].relrowsecurity).toBe(true);
        const pol = await client.query(
          `SELECT 1 FROM pg_policy WHERE polname = $1 AND polrelid = $2::regclass`,
          [`tenant_isolation_${tabla}`, tabla],
        );
        expect(pol.rowCount).toBe(1);
      }
    });
  });

  it("escenario 6 -- segunda ejecucion COMPLETA (archivo entero) despues de normalizar: ningun cambio, ninguna excepcion", async () => {
    await conEscenario(async (client) => {
      await sembrarLoginLookupExistente(client, { volatilidad: "VOLATILE", securityDefiner: true });
      await client.query(leerMigracionCompleta());

      const antes = await leerIdentidadActual(client);
      const politicasAntes = await client.query(`SELECT polname, oid::text FROM pg_policy ORDER BY polname`);

      await client.query(leerMigracionCompleta());

      const despues = await leerIdentidadActual(client);
      const politicasDespues = await client.query(`SELECT polname, oid::text FROM pg_policy ORDER BY polname`);
      expect(despues).toEqual(antes);
      expect(politicasDespues.rows).toEqual(politicasAntes.rows);
    });
  });
});
