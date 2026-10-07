// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA (Ronda 11,
// 2026-10-06, puntos 5 y 6 del pedido de Alex: reproducir exactamente los
// 2 defectos reales que una ejecucion real contra PostgreSQL 18.6 encontro
// en la Seccion C de la migracion y en verificarDriftReconstruccion.ts --
// nunca detectados por las pruebas estaticas existentes, que por diseno
// (ver cabecera de reconstruccionRlsAuthGrants.test.ts) solo verifican
// forma de texto, nunca valores reales contra un catalogo real). Corre
// SOLO con `npm run test:integration` contra la base de prueba EXCLUSIVA
// (chainpulse_reconstruccion_test en el branch validacion-reconstruccion-
// 2026-10-05, nunca produccion). Esta sesion NO la ejecuto -- queda en la
// lista de "pruebas preparadas pero no ejecutadas" de esta entrega, igual
// que el resto de pruebas de integracion de este proyecto.
//
// EXTENDIDO EN RONDA 12 (2026-10-06, mismo archivo, sin renombrar -- ver
// Grupo 6 y la prueba agregada al final del Grupo 5): el conteo real de
// Alex contra esta misma Seccion C (106 chequeos, 105 OK + 1 divergencia)
// encontro un tercer defecto real, independiente de los 2 de arriba: el
// conjunto esperado de EXECUTE grants de login_lookup() exigia
// "exactamente chainpulse_app", incompatible con exigir simultaneamente
// "owner = neondb_owner" en la misma condicion -- information_schema
// cataloga al propietario como grantee de EXECUTE ademas de
// chainpulse_app. Ver RONDA 12 en migration.sql y
// verificarDriftReconstruccion.ts para la correccion.
//
// LOS 2 DEFECTOS REALES (evidencia de Alex, 2026-10-06):
//
//   1) PostgreSQL cataloga las columnas de salida de un RETURNS TABLE con
//      proargmodes = 't' (tabla), nunca 'o' (OUT de un parametro OUT
//      declarado suelto). La migracion y el verificador de Ronda 10
//      esperaban 'o' -- nunca habrian reconocido como identica la propia
//      funcion que la migracion crea, y una segunda ejecucion real habria
//      abortado por "divergente" en vez de conservar.
//
//   2) El driver "pg" no trae un parser de array registrado para
//      "char"[] (proargmodes) ni oid[] (proallargtypes) -- a diferencia
//      de text[]/int4[], que si tiene. Sin normalizar ambos lados al
//      mismo formato (text[] via unnest(...)::text, del lado SQL), la
//      comparacion JSON.stringify() fallaba SIEMPRE, sin relacion alguna
//      con si los valores semanticos coincidian.
//
//   3) privilege_type en information_schema.role_table_grants es del
//      dominio information_schema.character_data -- array_agg(...ORDER
//      BY privilege_type) sobre ese dominio fallo en una ejecucion real;
//      castear a ::text antes de agregar y ordenar lo resuelve.
//
// POR QUE ESTOS 3 DEFECTOS NUNCA SE DETECTARON ANTES (punto 6 del
// pedido -- revision de las pruebas existentes):
//
//   - reconstruccionRlsAuthGrants.test.ts es ESTATICO por diseno (lee
//     migration.sql como texto, nunca abre una conexion -- ver su propia
//     cabecera). Su prueba de la Seccion C solo confirma que el texto
//     "v_proargmodes IS DISTINCT FROM v_proargmodes_esperado" ESTA
//     PRESENTE en el archivo -- nunca evaluo el VALOR real de
//     v_proargmodes_esperado contra ningun catalogo real, asi que no
//     tenia forma estructural de detectar que ese valor era 'o' en vez
//     de 't'. Esta entrega le agrega una aserción de VALOR (ver ese
//     archivo) como guardia de regresion minima, pero una aserción de
//     texto nunca reemplaza una ejecucion real -- por eso existe este
//     archivo.
//
//   - reconstruccionEntornoVacio.integration.test.ts SI ejecuta
//     login_lookup() funcionalmente, pero solo DESPUES de la PRIMERA
//     aplicacion de la migracion completa (rama v_conteo = 0, "crear") --
//     esa rama nunca lee ni compara proargmodes, simplemente crea la
//     funcion. El bug vive exclusivamente en la rama v_conteo = 1
//     ("conservar"), que ese archivo nunca ejercita porque nunca aplica
//     la migracion dos veces.
//
//   - reconstruccionRlsAuthGrantsRamas.integration.test.ts EXCLUYE la
//     Seccion C a proposito de su fragmento de canonicalizacion (ver su
//     propia cabecera, "Seccion C tiene un problema adicional y
//     distinto") -- su chequeo de cardinalidad es una busqueda GLOBAL en
//     el catalogo, no aislable a un esquema de prueba descartable como
//     _test_ramas. Esa exclusion esta bien fundada por una razon de
//     aislamiento totalmente distinta (evitar mutar o depender de un
//     login_lookup real), pero tuvo el efecto colateral de dejar la rama
//     "conservar" de la Seccion C sin ninguna prueba real en todo el
//     proyecto -- exactamente el hueco que este archivo cierra.
//
// TECNICA: los grupos 1-4 de abajo usan objetos descartables propios
// (un esquema/funcion/tabla de prueba, nunca login_lookup real) para
// poder ejercitar el comportamiento real de Postgres y del driver sin
// tocar nada de "public". El grupo 5 es la excepcion inevitable: la
// Seccion C de la migracion opera sobre "public" sin calificar (ver la
// razon documentada arriba), asi que ese grupo SI crea y borra
// login_lookup real -- pero solo despues de confirmar en su propio
// beforeAll que no existe todavia, y lo deja borrado al terminar.
//
// RONDA 14 (2026-10-07, seguridad del arnes de pruebas, sin tocar
// codigo productivo ni migraciones -- ver tambien RONDA 14 en
// confirmarNoDependeDeOtraConfirmacion.integration.test.ts): se
// encontro que el afterAll de este Grupo 5 hacia
// "DROP FUNCTION IF EXISTS public.login_lookup(text)" de forma
// INCONDICIONAL. Vitest ejecuta afterAll aunque beforeAll del mismo
// describe haya lanzado una excepcion -- si este archivo se corriera
// contra una base donde login_lookup() YA existe legitimamente (por
// ejemplo chainpulse_reconstruccion_r12, validada como evidencia en
// Ronda 13), el beforeAll aborta con el mensaje de "YA EXISTE" pero
// el afterAll de todos modos se ejecutaba y DESTRUIA la funcion real
// compartida. Correccion de dos capas, ninguna dependiente de la otra:
//
//   (a) Grupo 5 completo queda detras de describe.skipIf(...), por
//       defecto SALTEADO (ninguna conexion se abre, ningun chequeo de
//       existencia corre, ningun DROP es posible) salvo que se exporte
//       explicitamente la variable de entorno
//       CHAINPULSE_CONFIRMAR_BASE_VACIA_GRUPO5 con el valor exacto
//       "confirmo-base-vacia-sin-migracion-25-aplicada".
//
//   (b) Aun si se habilita explicitamente, una bandera de modulo
//       "creadoPorEstaSuite" solo se pone en true inmediatamente
//       despues de que el CREATE real (primera corrida) tiene exito;
//       el afterAll solo hace DROP si esa bandera es true -- nunca
//       toca login_lookup si esta corrida no fue la que lo creo.
//
// PRECONDICION EXACTA para habilitar este Grupo 5: la base conectada
// via SEED_DATABASE_URL debe ser una base donde la migracion
// 20261005120000_reconstruccion_rls_auth_grants TODAVIA NO fue
// aplicada (public.login_lookup no debe existir). NUNCA habilitar
// contra chainpulse_reconstruccion_r12 (evidencia intacta de Ronda 13)
// ni contra produccion. Los Grupos 1-4 y 6 no tienen esta precondicion
// -- ya usan exclusivamente esquemas/funciones/roles descartables
// propios, nunca public.login_lookup, y no se modificaron en esta
// ronda.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const RUTA_MIGRACION = join(
  __dirname,
  "../../../../prisma/migrations/20261005120000_reconstruccion_rls_auth_grants/migration.sql",
);

// RONDA 14: gate explicito de opt-in para el Grupo 5 (prueba exclusiva
// de base vacia). Por defecto (variable no exportada o con otro
// valor), el Grupo 5 completo queda salteado por describe.skipIf.
const VARIABLE_CONFIRMACION_BASE_VACIA = "CHAINPULSE_CONFIRMAR_BASE_VACIA_GRUPO5";
const VALOR_CONFIRMACION_BASE_VACIA = "confirmo-base-vacia-sin-migracion-25-aplicada";

function extraerSeccionC(): string {
  const sql = readFileSync(RUTA_MIGRACION, "utf8");
  const idxC = sql.indexOf("SECCION C");
  const idxD = sql.indexOf("SECCION D");
  if (idxC === -1 || idxD === -1 || idxD <= idxC) {
    throw new Error(
      "No se pudo extraer la Seccion C de migration.sql -- revisar los marcadores de texto ('SECCION C' / 'SECCION D'); es probable que la migracion haya cambiado de forma incompatible con esta prueba.",
    );
  }
  const fragmento = sql.slice(idxC, idxD);
  return `BEGIN;\n\n${fragmento}\nCOMMIT;\n`;
}

async function conectarComoNeondbOwner(): Promise<Client> {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado -- esta prueba necesita el rol neondb_owner (CREATE FUNCTION/GRANT/REVOKE, igual que la Seccion C de la migracion).",
    );
  }
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

describe("Ronda 11 -- identidad real de login_lookup() y normalizacion del verificador contra PostgreSQL 18.6", () => {
  describe("Grupo 1 -- RETURNS TABLE se cataloga con proargmodes 't', no 'o' (reproduce el hallazgo 1 de Alex, aislado en un esquema descartable)", () => {
    let client: Client;

    beforeAll(async () => {
      client = await conectarComoNeondbOwner();
      await client.query("DROP SCHEMA IF EXISTS _test_login_lookup_ronda11 CASCADE");
      await client.query("CREATE SCHEMA _test_login_lookup_ronda11");
      await client.query(`
        CREATE FUNCTION _test_login_lookup_ronda11.f_retorna_tabla(p_entrada text)
        RETURNS TABLE (col_a text, col_b integer)
        LANGUAGE sql
        STABLE
        AS $BODY$ SELECT p_entrada, 1 $BODY$;
      `);
    }, 30000);

    afterAll(async () => {
      await client?.query("DROP SCHEMA IF EXISTS _test_login_lookup_ronda11 CASCADE").catch(() => {});
      await client?.end();
    }, 30000);

    it("proargmodes real es {i,t,t} -- 1 entrada + 2 columnas de RETURNS TABLE, ninguna como 'o'", async () => {
      const r = await client.query(
        `SELECT proargmodes FROM pg_proc WHERE pronamespace = '_test_login_lookup_ronda11'::regnamespace AND proname = 'f_retorna_tabla'`,
      );
      // Postgres devuelve "char"[] como literal de texto sin parsear via
      // el driver "pg" (ver Grupo 2) -- se compara aca con el literal
      // crudo esperado, no con un array de JS, precisamente para no
      // esconder el comportamiento real detras de una normalizacion
      // prematura dentro de la propia prueba.
      expect(r.rows[0].proargmodes).toBe("{i,t,t}");
      expect(r.rows[0].proargmodes).not.toContain("o");
    });
  });

  describe("Grupo 2 -- normalizacion de proargmodes/proallargtypes antes de comparar (reproduce el hallazgo 2 de Alex: por que la comparacion JSON.stringify fallaba siempre)", () => {
    let client: Client;

    beforeAll(async () => {
      client = await conectarComoNeondbOwner();
      await client.query("DROP SCHEMA IF EXISTS _test_login_lookup_ronda11 CASCADE");
      await client.query("CREATE SCHEMA _test_login_lookup_ronda11");
      await client.query(`
        CREATE FUNCTION _test_login_lookup_ronda11.f_retorna_tabla(p_entrada text)
        RETURNS TABLE (col_a text, col_b integer)
        LANGUAGE sql
        STABLE
        AS $BODY$ SELECT p_entrada, 1 $BODY$;
      `);
    }, 30000);

    afterAll(async () => {
      await client?.query("DROP SCHEMA IF EXISTS _test_login_lookup_ronda11 CASCADE").catch(() => {});
      await client?.end();
    }, 30000);

    it("sin normalizar, proargmodes/proallargtypes crudos NO son comparables por JSON.stringify contra un array de JS, sin importar si los valores semanticos coinciden", async () => {
      const r = await client.query(
        `SELECT proargmodes, proallargtypes FROM pg_proc WHERE pronamespace = '_test_login_lookup_ronda11'::regnamespace AND proname = 'f_retorna_tabla'`,
      );
      const esperadoModos = ["i", "t", "t"];
      // El driver "pg" no tiene parser para "char"[]/oid[] -- llegan como
      // el literal de array de Postgres sin parsear (string), nunca como
      // array de JS. JSON.stringify de un string nunca es igual a
      // JSON.stringify de un array, aunque el contenido semantico
      // coincida exactamente -- este es, literalmente, el bug que
      // Ronda 10 tenia (agravado ahi ademas por el valor 'o' incorrecto).
      expect(typeof r.rows[0].proargmodes).toBe("string");
      expect(JSON.stringify(r.rows[0].proargmodes)).not.toBe(JSON.stringify(esperadoModos));
    });

    it("normalizados del lado SQL via unnest(...)::text, SI son comparables por JSON.stringify contra el mismo array de JS", async () => {
      const r = await client.query(
        `SELECT
            (SELECT array_agg(m::text ORDER BY ord) FROM unnest(proargmodes) WITH ORDINALITY AS u(m, ord)) AS modos_texto,
            (SELECT array_agg(t::text ORDER BY ord) FROM unnest(proallargtypes) WITH ORDINALITY AS u(t, ord)) AS tipos_texto
           FROM pg_proc WHERE pronamespace = '_test_login_lookup_ronda11'::regnamespace AND proname = 'f_retorna_tabla'`,
      );
      const esperadoModos = ["i", "t", "t"];
      // RONDA 17 (corrige una expectativa real contra PostgreSQL 18.6):
      // proallargtypes lista el tipo de CADA argumento, en el mismo
      // orden que proargmodes -- no solo las columnas de RETURNS TABLE.
      // f_retorna_tabla(p_entrada text) RETURNS TABLE (col_a text,
      // col_b integer) tiene 1 entrada + 2 columnas (ver el test del
      // Grupo 1, "proargmodes real es {i,t,t}"), asi que proallargtypes
      // tiene 3 elementos, no 2: [text (p_entrada), text (col_a),
      // integer (col_b)]. La version anterior de esta prueba esperaba
      // solo ["text", "integer"] (2 elementos, solo las columnas de
      // salida) y fallaba por longitud de array contra el valor real de
      // 3 elementos.
      const esperadoTiposR = await client.query(
        `SELECT array_agg(to_regtype(t)::oid::text ORDER BY ord) AS oids FROM unnest($1::text[]) WITH ORDINALITY AS u(t, ord)`,
        [["text", "text", "integer"]],
      );
      expect(Array.isArray(r.rows[0].modos_texto)).toBe(true);
      expect(r.rows[0].modos_texto).toEqual(esperadoModos);
      expect(r.rows[0].tipos_texto).toHaveLength(3);
      expect(r.rows[0].tipos_texto).toEqual(esperadoTiposR.rows[0].oids);
    });
  });

  describe("Grupo 3 -- agregacion de privilege_type normalizada a texto (reproduce el hallazgo 3 de Alex: por que la consulta agregada de grants fallaba)", () => {
    let client: Client;

    beforeAll(async () => {
      client = await conectarComoNeondbOwner();
      await client.query('DROP TABLE IF EXISTS public._test_grants_ronda11');
      await client.query('CREATE TABLE public._test_grants_ronda11 (id text PRIMARY KEY)');
      await client.query('GRANT SELECT, INSERT ON public._test_grants_ronda11 TO chainpulse_app');
    }, 30000);

    afterAll(async () => {
      await client?.query('DROP TABLE IF EXISTS public._test_grants_ronda11').catch(() => {});
      await client?.end();
    }, 30000);

    it("sin castear a ::text, array_agg(privilege_type ORDER BY privilege_type) no lanza excepcion -- devuelve el literal crudo de Postgres sin parsear (dominio information_schema.character_data, sin parser de array registrado en \"pg\")", async () => {
      // RONDA 17 (corrige una expectativa real contra PostgreSQL 18.6,
      // evidencia de Alex): la version anterior de esta prueba asumia
      // que la consulta lanzaba una excepcion (.rejects.toThrow()).
      // Eso es falso -- array_agg(...) sobre el dominio
      // information_schema.character_data es SQL valido, la consulta
      // se ejecuta sin error. Lo que realmente ocurre es que el driver
      // "pg" no tiene un parser de array registrado para el OID de ese
      // dominio (dataTypeID real observado: 13289), asi que devuelve el
      // literal crudo de Postgres como string de JavaScript sin
      // parsear -- el mismo mecanismo ya probado en este archivo para
      // "char"[] (proargmodes) y oid[] (proallargtypes). Valor real
      // observado por Alex: privilegios === "{INSERT,SELECT}" (string).
      const r = await client.query(
        `SELECT table_name, array_agg(privilege_type ORDER BY privilege_type) AS privilegios
           FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND table_name = '_test_grants_ronda11' AND grantee = 'chainpulse_app'
           GROUP BY table_name`,
      );
      expect(r.rows).toHaveLength(1);
      const valorSinCast = r.rows[0].privilegios;
      expect(typeof valorSinCast).toBe("string");
      expect(valorSinCast).toBe("{INSERT,SELECT}");
    });

    it("casteando a ::text antes de agregar y ordenar, la misma consulta funciona y devuelve los grants reales de chainpulse_app", async () => {
      const r = await client.query(
        `SELECT table_name, array_agg(privilege_type::text ORDER BY privilege_type::text) AS privilegios
           FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND table_name = '_test_grants_ronda11' AND grantee = 'chainpulse_app'
           GROUP BY table_name`,
      );
      expect(r.rows).toHaveLength(1);
      // RONDA 17: con el cast, "pg" si tiene parser para text[] --
      // devuelve un array de JavaScript normal (no el string crudo del
      // test anterior), que es la misma representacion que usa el
      // verificador real para comparar valores.
      expect(Array.isArray(r.rows[0].privilegios)).toBe(true);
      expect(r.rows[0].privilegios).toEqual(["INSERT", "SELECT"]);
    });
  });

  describe("Grupo 4 -- ausencia de grants a PUBLIC (misma tabla descartable del Grupo 3, sin ningun GRANT a PUBLIC)", () => {
    let client: Client;

    beforeAll(async () => {
      client = await conectarComoNeondbOwner();
      await client.query('DROP TABLE IF EXISTS public._test_grants_ronda11');
      await client.query('CREATE TABLE public._test_grants_ronda11 (id text PRIMARY KEY)');
      await client.query('GRANT SELECT, INSERT ON public._test_grants_ronda11 TO chainpulse_app');
    }, 30000);

    afterAll(async () => {
      await client?.query('DROP TABLE IF EXISTS public._test_grants_ronda11').catch(() => {});
      await client?.end();
    }, 30000);

    it("la consulta de PUBLIC (misma normalizacion a ::text) no devuelve ninguna fila para la tabla descartable", async () => {
      const r = await client.query(
        `SELECT table_name, array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) AS privilegios
           FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND table_name = '_test_grants_ronda11' AND grantee = 'PUBLIC'
           GROUP BY table_name`,
      );
      expect(r.rows).toHaveLength(0);
    });
  });

  describe.skipIf(process.env[VARIABLE_CONFIRMACION_BASE_VACIA] !== VALOR_CONFIRMACION_BASE_VACIA)("Grupo 5 -- segunda ejecucion REAL de la Seccion C contra PostgreSQL (reproduce el hallazgo 1 de punta a punta, no solo analisis estatico -- unico grupo que toca public.login_lookup)", () => {
    let client: Client;
    // RONDA 14: solo true si ESTA corrida creo login_lookup; el
    // afterAll de abajo usa esta bandera para no borrar nunca una
    // funcion real que esta suite no creo.
    let creadoPorEstaSuite = false;

    beforeAll(async () => {
      client = await conectarComoNeondbOwner();
      const existe = await client.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'login_lookup'`);
      if (existe.rows[0].n !== 0) {
        throw new Error(
          "public.login_lookup YA EXISTE antes de empezar esta prueba -- esta prueba necesita partir de ausencia total para poder probar la rama de CREACION y despues la de CONSERVACION de forma inequivoca. Este Grupo 5 es EXCLUSIVO de base vacia (ver RONDA 14): solo debe habilitarse, via " + VARIABLE_CONFIRMACION_BASE_VACIA + ", contra una base donde la migracion 20261005120000 todavia NO fue aplicada. NUNCA contra chainpulse_reconstruccion_r12 (evidencia de Ronda 13) ni produccion -- si esta excepcion se dispara de todos modos, la funcion real NO se toca: el afterAll de este grupo solo hace DROP si esta misma corrida la creo (ver creadoPorEstaSuite).",
        );
      }
    }, 30000);

    afterAll(async () => {
      if (creadoPorEstaSuite) {
        await client?.query('DROP FUNCTION IF EXISTS public.login_lookup(text)').catch(() => {});
      }
      await client?.end();
    }, 30000);

    it("primera corrida real: crea login_lookup (rama v_conteo = 0)", async () => {
      await client.query(extraerSeccionC());
      creadoPorEstaSuite = true;
      const r = await client.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'login_lookup'`);
      expect(r.rows[0].n).toBe(1);
    });

    it("la funcion recien creada cataloga sus 11 columnas de RETURNS TABLE con modo 't', nunca 'o' -- confirma el hallazgo 1 contra el objeto REAL que la migracion crea", async () => {
      const r = await client.query(
        `SELECT (SELECT array_agg(m::text ORDER BY ord) FROM unnest(proargmodes) WITH ORDINALITY AS u(m, ord)) AS modos_texto
           FROM pg_proc WHERE proname = 'login_lookup'`,
      );
      expect(r.rows[0].modos_texto).toEqual(["i", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t"]);
    });

    it("segunda corrida real, mismo texto verbatim: NO lanza ninguna excepcion -- antes de la correccion de Ronda 11, esto abortaba con RECONSTRUCCION_AUTH_DIVERGENTE por comparar 't' real contra 'o' esperado", async () => {
      await expect(client.query(extraerSeccionC())).resolves.toBeDefined();
    });

    it("tras la segunda corrida, sigue existiendo exactamente 1 login_lookup -- prueba positiva de que se conservo, no de que simplemente no hubo error", async () => {
      const r = await client.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'login_lookup'`);
      expect(r.rows[0].n).toBe(1);
    });

    it("RONDA 12 -- tras la segunda corrida, el conjunto de EXECUTE grants es exactamente {chainpulse_app, neondb_owner} -- confirma el hallazgo 3 contra el objeto REAL que la migracion conserva (antes de esta correccion, la query de 'segunda corrida real' de arriba habria lanzado RECONSTRUCCION_AUTH_DIVERGENTE en este mismo punto)", async () => {
      const r = await client.query(
        `SELECT grantee FROM information_schema.routine_privileges
           WHERE routine_name = 'login_lookup' AND privilege_type = 'EXECUTE' ORDER BY grantee`,
      );
      const grantees = r.rows.map((f) => f.grantee).sort();
      expect(grantees).toEqual(["chainpulse_app", "neondb_owner"]);
    });
  });

  describe("Grupo 6 -- RONDA 12: conjunto esperado de EXECUTE grants es {chainpulse_app, propietario}, nunca chainpulse_app solo (reproduce el hallazgo 3 de Alex, aislado en una funcion descartable)", () => {
    let client: Client;

    beforeAll(async () => {
      client = await conectarComoNeondbOwner();
      await client.query("DROP SCHEMA IF EXISTS _test_execute_grants_ronda12 CASCADE");
      await client.query("CREATE SCHEMA _test_execute_grants_ronda12");
      await client.query(`
        CREATE FUNCTION _test_execute_grants_ronda12.f_test()
        RETURNS void
        LANGUAGE sql
        STABLE
        AS $BODY$ SELECT NULL $BODY$;
      `);
      await client.query("REVOKE ALL ON FUNCTION _test_execute_grants_ronda12.f_test() FROM PUBLIC");
      await client.query("GRANT EXECUTE ON FUNCTION _test_execute_grants_ronda12.f_test() TO chainpulse_app");
    }, 30000);

    afterAll(async () => {
      await client?.query("DROP SCHEMA IF EXISTS _test_execute_grants_ronda12 CASCADE").catch(() => {});
      await client?.end();
    }, 30000);

    async function grantsDeFTest(client: Client): Promise<string[]> {
      const r = await client.query(
        `SELECT grantee FROM information_schema.routine_privileges
           WHERE routine_schema = '_test_execute_grants_ronda12' AND routine_name = 'f_test' AND privilege_type = 'EXECUTE'
           ORDER BY grantee`,
      );
      return r.rows.map((f) => f.grantee).sort();
    }

    it("con GRANT EXECUTE solo a chainpulse_app y REVOKE ALL FROM PUBLIC ya aplicado, information_schema reporta IGUAL a neondb_owner (el propietario) como grantee, sin ningun GRANT explicito a su nombre -- confirma el hallazgo 3 de punta a punta", async () => {
      const grantees = await grantsDeFTest(client);
      expect(grantees).toEqual(["chainpulse_app", "neondb_owner"]);
    });

    it("agregar GRANT EXECUTE a PUBLIC hace que el conjunto deje de coincidir con el esperado -- PUBLIC sigue siendo divergencia real, esta correccion no la relaja", async () => {
      await client.query("GRANT EXECUTE ON FUNCTION _test_execute_grants_ronda12.f_test() TO PUBLIC");
      try {
        const grantees = await grantsDeFTest(client);
        expect(grantees).toContain("PUBLIC");
        expect(grantees).not.toEqual(["chainpulse_app", "neondb_owner"]);
      } finally {
        await client.query("REVOKE EXECUTE ON FUNCTION _test_execute_grants_ronda12.f_test() FROM PUBLIC");
      }
    });

    it("agregar un tercer rol (ademas de chainpulse_app y el propietario) hace que el conjunto deje de coincidir con el esperado -- un tercer rol sigue siendo divergencia real", async () => {
      await client.query("DROP ROLE IF EXISTS _test_rol_ronda12");
      await client.query("CREATE ROLE _test_rol_ronda12");
      try {
        await client.query("GRANT EXECUTE ON FUNCTION _test_execute_grants_ronda12.f_test() TO _test_rol_ronda12");
        const grantees = await grantsDeFTest(client);
        expect(grantees).toHaveLength(3);
        expect(grantees).not.toEqual(["chainpulse_app", "neondb_owner"]);
      } finally {
        await client.query("REVOKE EXECUTE ON FUNCTION _test_execute_grants_ronda12.f_test() FROM _test_rol_ronda12").catch(() => {});
        await client.query("DROP ROLE IF EXISTS _test_rol_ronda12").catch(() => {});
      }
    });

    it("la comparacion es por CONJUNTO (ambos lados ordenados), no por orden de aparicion -- un array esperado escrito en otro orden tambien debe reconocerse como el mismo conjunto una vez ordenado, mientras que sin ordenar NO coincidiria", async () => {
      const grantees = await grantsDeFTest(client);
      const esperadoOrdenA = ["chainpulse_app", "neondb_owner"].sort();
      const esperadoOrdenB = ["neondb_owner", "chainpulse_app"].sort();
      // Una vez ordenados, ambos literales representan el mismo conjunto
      // y ambos deben coincidir con lo encontrado.
      expect(grantees).toEqual(esperadoOrdenA);
      expect(grantees).toEqual(esperadoOrdenB);
      expect(esperadoOrdenA).toEqual(esperadoOrdenB);
      // Sin ordenar, el literal en el otro orden NO coincidiria por
      // igualdad posicional -- confirma por que la implementacion real
      // (verificarDriftReconstruccion.ts) ordena explicitamente ambos
      // lados antes de comparar, en vez de asumir un orden fijo.
      expect(["neondb_owner", "chainpulse_app"]).not.toEqual(grantees);
    });
  });
});
