// Pruebas — verificacion ESTATICA (sin base, sin red, sin conexion) de
// la migracion de reconstruccion RLS/auth/grants y de su verificador de
// drift (Ronda 6 de planificacion/implementacion, 2026-10-05 -> extendido
// en Ronda 9, 2026-10-05, punto 1 y 2 del pedido: transaccion explicita e
// identidad completa de login_lookup -> extendido en Ronda 10, 2026-10-05:
// se quito la tabla de bitacora propia por decision explicita de Alex, y
// se agrego un guardia generico contra ramas IF/ELSIF/ELSE vacias -- el
// riesgo real que esa misma eliminacion produjo al quitar el INSERT que
// era la UNICA sentencia de dos ramas, Seccion D y Seccion E). No importa ninguno de los dos
// archivos: la migracion es SQL puro, y el verificador
// (scripts/verificarDriftReconstruccion.ts) llama a main() de forma
// incondicional al cargarse (mismo patron que scripts/bootstrapPgBoss.ts)
// -- importarlo intentaria abrir una conexion real. Por eso ambos se leen
// como TEXTO y se verifican invariantes estructurales con aserciones de
// texto, nunca ejecutando ninguno de los dos.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUTA_MIGRACION = join(
  __dirname,
  "../../../../prisma/migrations/20261005120000_reconstruccion_rls_auth_grants/migration.sql",
);
const RUTA_VERIFICADOR = join(__dirname, "../../../../scripts/verificarDriftReconstruccion.ts");

function sinLineasDeComentario(texto: string): string {
  return texto
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n");
}

function lineasEfectivas(texto: string): string[] {
  // Sin comentarios y sin lineas vacias -- para encontrar la PRIMERA y la
  // ULTIMA instruccion real del archivo (punto 1 del pedido de Ronda 9:
  // "Agregá una prueba estática que garantice que BEGIN es la primera
  // instrucción efectiva y COMMIT la última").
  return sinLineasDeComentario(texto)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

describe("migracion 20261005120000_reconstruccion_rls_auth_grants (estatico)", () => {
  const sql = readFileSync(RUTA_MIGRACION, "utf8");
  const sqlSinComentarios = sinLineasDeComentario(sql);

  it("envuelve toda la migracion con BEGIN;/COMMIT; explicitos -- BEGIN; es la primera instruccion efectiva del archivo y COMMIT; la ultima (Ronda 9, punto 1: no depender de una transaccion implicita de Prisma)", () => {
    const lineas = lineasEfectivas(sql);
    expect(lineas[0]).toBe("BEGIN;");
    expect(lineas[lineas.length - 1]).toBe("COMMIT;");
  });

  it("no usa ningun comando de la lista de comandos prohibidos dentro de un bloque de transaccion PostgreSQL (CREATE/DROP DATABASE, CREATE/DROP TABLESPACE, *_CONCURRENTLY, VACUUM, ALTER SYSTEM, CREATE/ALTER SUBSCRIPTION)", () => {
    const prohibidos = [
      /CREATE\s+DATABASE/i, /DROP\s+DATABASE/i,
      /CREATE\s+TABLESPACE/i, /DROP\s+TABLESPACE/i,
      /CONCURRENTLY/i,
      /\bVACUUM\b/i,
      /ALTER\s+SYSTEM/i,
      /CREATE\s+SUBSCRIPTION/i, /ALTER\s+SUBSCRIPTION/i,
    ];
    for (const patron of prohibidos) {
      expect(patron.test(sqlSinComentarios)).toBe(false);
    }
  });

  it("nunca usa DROP ... CASCADE", () => {
    expect(/DROP[^;]*CASCADE/i.test(sqlSinComentarios)).toBe(false);
  });

  it("nunca usa CREATE OR REPLACE FUNCTION fuera de un comentario explicativo (el patron de aborto decide antes de llegar a un CREATE)", () => {
    // sqlSinComentarios, no "sql" crudo: la cabecera MENCIONA la frase
    // dentro de un comentario, justamente para explicar por que no se usa
    // -- comparar contra el texto crudo daba un falso positivo aqui.
    expect(/CREATE OR REPLACE FUNCTION/i.test(sqlSinComentarios)).toBe(false);
  });

  it("declara el patron de aborto fijo y descriptivo para las 5 categorias de objeto (rol, RLS, auth, grants de tabla, grants de esquema)", () => {
    expect(sql).toContain("RECONSTRUCCION_PRECONDICION_ROL");
    expect(sql).toContain("RECONSTRUCCION_RLS_DIVERGENTE");
    expect(sql).toContain("RECONSTRUCCION_AUTH_DIVERGENTE");
    expect(sql).toContain("RECONSTRUCCION_AUTH_SOBRECARGA_INESPERADA");
    expect(sql).toContain("RECONSTRUCCION_GRANTS_DIVERGENTE");
    expect(sql).toContain("RECONSTRUCCION_GRANTS_EXCESO_PUBLIC");
    expect(sql).toContain("RECONSTRUCCION_GRANTS_EXCESO_SCHEMA");
  });

  it("no opera sobre ningun objeto real de pgboss (solo lo menciona en comentarios para declarar que esta fuera de alcance)", () => {
    expect(sqlSinComentarios.toLowerCase()).not.toContain("pgboss");
  });

  it("tiene exactamente 6 bloques DO $$ (Secciones 0, A, B, C, D, E)", () => {
    const aperturas = sql.match(/^DO \$\$$/gm) ?? [];
    expect(aperturas).toHaveLength(6);
  });

  it("cada CREATE TEMP TABLE _calib de canonicalizacion tiene su propio DROP TABLE _calib", () => {
    const creaciones = sql.match(/CREATE TEMP TABLE _calib/g) ?? [];
    const borrados = sql.match(/DROP TABLE _calib/g) ?? [];
    expect(borrados).toHaveLength(creaciones.length);
    expect(creaciones.length).toBeGreaterThan(0);
  });

  it("Ronda 10: ya NO existe ninguna tabla de bitacora propia -- se elimino por decision explicita (ver cabecera de la migracion, parrafo RONDA 10)", () => {
    expect(sqlSinComentarios).not.toContain("_bitacora_reconstruccion_rls_auth_grants");
    expect(sqlSinComentarios).not.toMatch(/CREATE TABLE IF NOT EXISTS "_bitacora/);
  });

  it("Ronda 10: ninguna rama IF/ELSIF/ELSE queda con un cuerpo vacio (el riesgo real que la Ronda 10 encontro y corrigio al quitar los INSERT a la bitacora)", () => {
    // THEN/ELSIF/ELSE seguido inmediatamente (sin ninguna sentencia real en
    // el medio, solo espacio en blanco/comentarios) de la siguiente palabra
    // clave de control -- exactamente el patron que rompio la Seccion D y la
    // Seccion E en el primer intento de esta ronda (PL/pgSQL no permite una
    // lista de sentencias vacia). sinLineasDeComentario primero: una rama
    // puede tener solo un comentario explicativo y seguir estando vacia en
    // terminos de SQL ejecutable.
    const sinComentarios = sinLineasDeComentario(sql);
    const ramaVacia = /\b(THEN|ELSE)\s*\n\s*(ELSIF|ELSE|END\s+IF)\b/;
    expect(ramaVacia.test(sinComentarios)).toBe(false);
  });

  describe("SECCION 0 -- precondiciones de rol (Ronda 9, nueva)", () => {
    const seccion0 = sql.slice(sql.indexOf("SECCION 0"), sql.indexOf("SECCION A"));

    it("verifica atributos (rolsuper/rolbypassrls/rolcreaterole/rolcreatedb) y membresia de chainpulse_app", () => {
      expect(seccion0).toContain("rolsuper");
      expect(seccion0).toContain("rolbypassrls");
      expect(seccion0).toContain("rolcreaterole");
      expect(seccion0).toContain("rolcreatedb");
      expect(seccion0).toContain("pg_auth_members");
    });

    it("NUNCA corrige estos atributos/membresia -- solo verifica y aborta (ningun ALTER ROLE ni REVOKE en esta seccion)", () => {
      expect(/ALTER\s+ROLE/i.test(seccion0)).toBe(false);
      expect(/\bREVOKE\b/i.test(sinLineasDeComentario(seccion0))).toBe(false);
    });
  });

  it("otorga el GRANT base a exactamente las 14 tablas documentadas como PROPUESTO (Ronda 6, Seccion 4.1), incluidas 'conexiones' y 'ciclos_pulso'", () => {
    const bloque = sql.match(/v_tablas text\[\] := ARRAY\[([\s\S]*?)\];/);
    expect(bloque).not.toBeNull();
    const tablas = (bloque![1]!.match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ""));
    expect(tablas.sort()).toEqual(
      [
        "empresas", "usuarios", "eslabones", "conexiones", "ciclos_pulso",
        "respuestas_crudas", "resultados_conexion", "resultados_ciclo",
        "evaluaciones_expres", "evaluaciones_expres_eslabones", "evaluaciones_expres_conexiones",
        "metricas_cuestionario", "recomendaciones_ejecutadas", "limite_tasa",
      ].sort(),
    );
    expect(tablas).toContain("conexiones");
    expect(tablas).toContain("ciclos_pulso");
  });

  it("agrega RLS exactamente a las 10 tablas que hoy solo viven en prisma/rls.sql (5 directas + 5 por subconsulta), ninguna de las 10 ya versionadas en migraciones historicas", () => {
    const yaVersionadas = [
      "consentimientos_cuenta", "cadenas", "nodos", "conexiones_cadena",
      "hallazgos_cadena", "flujos_conexion_cadena", "respuestas_cadena",
      "observaciones_kpi", "importaciones_csv", "observaciones_cobertura",
    ];
    for (const tabla of yaVersionadas) {
      expect(sqlSinComentarios).not.toContain(`tenant_isolation_${tabla}`);
    }

    const nuevas = [
      "empresas", "usuarios", "eslabones", "conexiones", "ciclos_pulso",
      "respuestas_crudas", "resultados_conexion", "resultados_ciclo",
      "metricas_cuestionario", "recomendaciones_ejecutadas",
    ];
    for (const tabla of nuevas) {
      expect(sql).toContain(`'${tabla}'`);
    }
  });

  describe("SECCION C -- login_lookup() (identidad completa, Ronda 9)", () => {
    const seccionC = sql.slice(sql.indexOf("SECCION C"), sql.indexOf("SECCION D"));

    it("verifica CARDINALIDAD (SELECT count(*)) antes de comparar nada -- cierra el bug de SELECT INTO sin STRICT (no alcanza con agregar STRICT mecanicamente)", () => {
      expect(seccionC).toContain("SELECT count(*) INTO v_conteo FROM pg_proc WHERE proname = 'login_lookup'");
      // La lectura puntual posterior (solo en la rama v_conteo = 1) SI usa
      // STRICT, como defensa en profundidad ante una condicion de carrera
      // -- pero nunca como el UNICO mecanismo de deteccion de sobrecarga.
      expect(seccionC).toContain("INTO STRICT v_oid, v_esquema, v_proargnames, v_proargmodes, v_proallargtypes");
    });

    it("detecta y aborta ante ausencia, mas de una sobrecarga, esquema incorrecto, nombre/tipo de argumento distinto y retorno distinto -- antes de comparar contenido", () => {
      expect(seccionC).toContain("RECONSTRUCCION_AUTH_SOBRECARGA_INESPERADA");
      expect(seccionC).toContain("v_esquema IS DISTINCT FROM 'public'");
      expect(seccionC).toContain("v_proargnames IS DISTINCT FROM v_proargnames_esperado");
      expect(seccionC).toContain("v_proargmodes IS DISTINCT FROM v_proargmodes_esperado");
      expect(seccionC).toContain("v_proallargtypes IS DISTINCT FROM v_proallargtypes_esperado");
    });

    it("RONDA 11 -- el valor esperado de proargmodes es 't' en las 11 columnas de RETURNS TABLE, nunca 'o' (guardia de regresion por VALOR, no solo de texto estructural)", () => {
      // Esta prueba es la correccion directa de un hallazgo real: Ronda 10
      // declaraba ARRAY['i','o','o',...] -- 11 modos 'o' -- y el test de
      // arriba ("detecta y aborta...") pasaba igual, porque solo confirma
      // que el TEXTO "v_proargmodes IS DISTINCT FROM v_proargmodes_esperado"
      // esta presente en el archivo, nunca evaluo el VALOR de
      // v_proargmodes_esperado contra ningun catalogo real. Una ejecucion
      // real contra PostgreSQL 18.6 (2026-10-06) encontro que Postgres
      // cataloga las columnas de salida de un RETURNS TABLE con modo 't'
      // (tabla), nunca 'o' (OUT de un parametro declarado suelto) -- con
      // el valor 'o', la migracion NUNCA habria reconocido como identica
      // la propia funcion que ella misma crea, y una segunda ejecucion
      // real habria abortado por "divergente" en vez de conservar (ver
      // src/infra/prisma/__tests__/loginLookupIdentidadRonda11.integration.test.ts
      // para la prueba de integracion que lo reproduce contra Postgres
      // real). Esta prueba por si sola NUNCA habria sido suficiente --
      // una aserción de texto no reemplaza una ejecucion real -- pero
      // actua como guardia barata contra volver a declarar 'o' por error.
      expect(seccionC).toContain("ARRAY['i','t','t','t','t','t','t','t','t','t','t','t']");
      expect(seccionC).not.toMatch(/ARRAY\['i',\s*'o'/);
    });

    it("RONDA 12 -- el conjunto esperado de EXECUTE grants de login_lookup() es {chainpulse_app, neondb_owner}, nunca chainpulse_app solo (guardia de regresion por VALOR; documenta por que ninguna prueba previa cubria esta linea)", () => {
      // Hallazgo real (ejecucion real contra PostgreSQL 18.6, 2026-10-06,
      // segunda aplicacion real de la Seccion C -- 106 chequeos, 105 OK +
      // 1 divergencia): information_schema.routine_privileges cataloga a
      // neondb_owner (el propietario) como grantee de EXECUTE ademas de
      // chainpulse_app, aunque REVOKE ALL FROM PUBLIC ya este aplicado --
      // el propietario conserva facultades inherentes sobre su propia
      // funcion, eso no es un GRANT adicional que REVOKE pueda quitar.
      // Ronda 10/11 exigian "v_execute_grantees IS DISTINCT FROM
      // ARRAY['chainpulse_app']" en la MISMA condicion que exige
      // "v_owner IS DISTINCT FROM 'neondb_owner'" -- dos exigencias
      // simultaneamente incompatibles: si el propietario es realmente
      // neondb_owner (como la migracion exige), information_schema
      // SIEMPRE va a mostrar tambien a neondb_owner como grantee de
      // EXECUTE, asi que la comparacion contra un array de un solo
      // elemento NUNCA podia pasar en una base real -- la migracion se
      // habria auto-bloqueado en toda segunda ejecucion real, pase lo
      // que pase.
      //
      // Por que ninguna prueba previa lo detecto: ninguna prueba --
      // estatica o de integracion -- hacia NINGUNA aserción sobre
      // "v_execute_grantees" o "execute_grants" antes de esta ronda. La
      // prueba estatica de "preserva SECURITY DEFINER..." mas arriba en
      // este archivo solo confirma el texto del GRANT de la rama de
      // CREACION (v_conteo = 0), que nunca lee ni compara grantees. La
      // prueba de integracion loginLookupIdentidadRonda11.integration.test.ts
      // (Grupo 5) SI ejecuta la Seccion C dos veces -- la rama que
      // contiene este chequeo -- pero fue escrita y nunca ejecutada en
      // Ronda 11 (ver su propia cabecera: "PREPARADA, NO EJECUTADA"); de
      // haberse ejecutado, si habria fallado aqui y expuesto exactamente
      // este hallazgo. El gap real no es de diseño de prueba sino de
      // cobertura: esta linea especifica del OR compuesto nunca tuvo
      // ninguna aserción, ejecutada o no, hasta esta ronda.
      expect(seccionC).toContain("v_execute_grantees_esperado text[] := ARRAY['chainpulse_app','neondb_owner']");
      expect(seccionC).toContain("v_execute_grantees IS DISTINCT FROM v_execute_grantees_esperado");
      expect(seccionC).not.toMatch(/v_execute_grantees IS DISTINCT FROM ARRAY\['chainpulse_app'\]/);
    });

    it("compara tipos de argumento por OID resuelto via to_regtype(), nunca por texto formateado (evita adivinar como Postgres renderiza \"RolUsuario\")", () => {
      expect(seccionC).toContain("to_regtype('\"RolUsuario\"')");
      // sinLineasDeComentario: la cabecera de esta Seccion SI menciona
      // "format_type()" dentro de un comentario, justamente para explicar
      // por que no se usa (mismo patron que el chequeo de "CREATE OR
      // REPLACE FUNCTION" mas arriba) -- comparar contra el texto crudo
      // daria un falso positivo aqui.
      expect(sinLineasDeComentario(seccionC)).not.toContain("format_type(");
    });

    it("adopta STABLE (no VOLATILE ni IMMUTABLE) en la rama de creacion, y lo verifica (provolatile = 's') en la rama de identidad ya existente", () => {
      expect(seccionC).toMatch(/LANGUAGE sql\s+STABLE\s+SECURITY DEFINER/);
      expect(seccionC).toContain("v_provolatile IS DISTINCT FROM 's'");
    });

    it("verifica que chainpulse_app no sea propietaria -- el mensaje de divergencia de contenido documenta explicitamente por que (no tiene ownership ni herencia del rol propietario)", () => {
      expect(seccionC).toContain("v_owner IS DISTINCT FROM 'neondb_owner'");
      expect(seccionC).toContain("chainpulse_app NUNCA puede ser propietaria de esta funcion");
    });

    it("preserva SECURITY DEFINER, search_path fijo y el REVOKE/GRANT minimo en la rama de creacion", () => {
      expect(seccionC).toContain("SECURITY DEFINER");
      expect(seccionC).toContain("SET search_path = public");
      expect(seccionC).toContain("REVOKE ALL ON FUNCTION login_lookup(text) FROM PUBLIC");
      expect(seccionC).toContain("GRANT EXECUTE ON FUNCTION login_lookup(text) TO chainpulse_app");
    });
  });

  describe("SECCION D -- GRANT de tabla (Ronda 9: ausencia de privilegios a PUBLIC + correccion del hallazgo de calificacion de esquema)", () => {
    const seccionD = sql.slice(sql.indexOf("SECCION D"), sql.indexOf("SECCION E"));

    it("verifica ausencia de privilegios a PUBLIC sobre las 14 tablas, ademas de los privilegios de chainpulse_app", () => {
      expect(seccionD).toContain("RECONSTRUCCION_GRANTS_EXCESO_PUBLIC");
      expect(seccionD).toContain("grantee = 'PUBLIC'");
    });

    it("la comparacion de privilegios de chainpulse_app es por igualdad EXACTA de conjunto (detecta faltantes Y excedentes, no solo ausencia)", () => {
      expect(seccionD).toContain("incluye tanto privilegios faltantes como privilegios excedentes");
    });

    it("el GRANT de correccion califica el esquema explicitamente (public.%I) -- debe coincidir con el esquema del chequeo (table_schema = 'public'), nunca depender de search_path para una accion de privilegios (hallazgo propio de esta ronda, ver cabecera de la migracion)", () => {
      expect(seccionD).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO chainpulse_app");
      expect(seccionD).toContain("table_schema = 'public'");
    });
  });

  describe("SECCION E -- privilegios de esquema (Ronda 9, nueva)", () => {
    // sql.indexOf("COMMIT;") a secas encontraria la mencion de "COMMIT;"
    // dentro de un comentario de la cabecera (citando el blog de Prisma),
    // muy ANTES de "SECCION E" -- hay que buscar la primera ocurrencia
    // DESPUES del inicio de esta seccion, no la primera del archivo.
    const idxSeccionE = sql.indexOf("SECCION E");
    const seccionE = sql.slice(idxSeccionE, sql.indexOf("COMMIT;", idxSeccionE));

    it("otorga USAGE si falta (patron de 2 vias: falta -> se otorga, existe -> se conserva, sin rama de 'diverge' para un permiso binario)", () => {
      expect(seccionE).toContain("GRANT USAGE ON SCHEMA public TO chainpulse_app");
    });

    it("verifica y aborta ante CREATE excedente tanto de chainpulse_app como de PUBLIC sobre el esquema public, usando aclexplode()/grantee=0 para PUBLIC", () => {
      expect(seccionE).toContain("RECONSTRUCCION_GRANTS_EXCESO_SCHEMA");
      expect(seccionE).toContain("has_schema_privilege('chainpulse_app', 'public', 'CREATE')");
      expect(seccionE).toContain("aclexplode(n.nspacl)");
      expect(seccionE).toContain("a.grantee = 0");
    });

    it("nunca revoca CREATE automaticamente -- solo lo reporta y aborta", () => {
      expect(/\bREVOKE\b/i.test(sinLineasDeComentario(seccionE))).toBe(false);
    });
  });
});

describe("scripts/verificarDriftReconstruccion.ts (estatico -- no se importa el modulo para no disparar main() con una conexion real)", () => {
  const ts = readFileSync(RUTA_VERIFICADOR, "utf8");

  it("nunca imprime el objeto de error crudo -- usa etiquetaSegura()/registrarFalloSeguro() en todos los catch", () => {
    expect(ts).toContain("etiquetaSegura");
    expect(ts).toContain("registrarFalloSeguro");
    // Ninguna linea de console.*/throw debe interpolar "err" directamente
    // (solo a traves de etiquetaSegura(err), nunca err.message/err.stack/err crudo).
    expect(/console\.(error|log)\([^)]*\berr\.(message|stack)\b/.test(ts)).toBe(false);
    expect(/console\.(error|log)\(\s*err\s*[,)]/.test(ts)).toBe(false);
  });

  it("declara exactamente 20 politicas esperadas (10 nuevas de esta migracion + 10 ya historicas), cada una con su campo origen", () => {
    const bloque = ts.match(/const POLITICAS_ESPERADAS: PoliticaEsperada\[\] = \[([\s\S]*?)\n\];/);
    expect(bloque).not.toBeNull();
    const entradas = bloque![1]!.match(/\{ tipo:/g) ?? [];
    expect(entradas).toHaveLength(20);
    const nuevas = bloque![1]!.match(/origen: "nueva"/g) ?? [];
    const historicas = bloque![1]!.match(/origen: "historica"/g) ?? [];
    expect(nuevas).toHaveLength(10);
    expect(historicas).toHaveLength(10);
  });

  it("declara la matriz de privilegios con exactamente 33 tablas (el total del esquema) y exactamente 2 SOLO_RECIBO", () => {
    const bloque = ts.match(/const PRIVILEGIOS_ESPERADOS: Record<string, "RW" \| "SOLO_RECIBO"> = \{([\s\S]*?)\n\};/);
    expect(bloque).not.toBeNull();
    const rw = bloque![1]!.match(/:\s*"RW"/g) ?? [];
    const soloRecibo = bloque![1]!.match(/:\s*"SOLO_RECIBO"/g) ?? [];
    expect(rw.length + soloRecibo.length).toBe(33);
    expect(soloRecibo).toHaveLength(2);
  });

  it("usa el mismo truco de canonicalizacion por tabla temporal que la migracion, no un string de expresion a mano", () => {
    expect(ts).toContain("canonicalizarExpresion");
    expect(ts).toContain("CREATE TEMP TABLE _calib_drift");
    expect(ts).toContain("DROP TABLE _calib_drift");
  });

  it("verifica la identidad completa de login_lookup (cardinalidad, esquema, nombres/modos/tipos de argumento via to_regtype) antes de comparar contenido, igual que la Seccion C de la migracion", () => {
    expect(ts).toContain("login_lookup.cardinalidad");
    expect(ts).toContain("login_lookup.esquema");
    expect(ts).toContain("login_lookup.nombres_argumentos");
    expect(ts).toContain("login_lookup.modos_argumentos");
    expect(ts).toContain("login_lookup.tipos_argumentos");
    expect(ts).toContain("to_regtype(t)::oid::text");
    expect(ts).not.toContain("format_type(");
  });

  it("verifica volatilidad STABLE y la ausencia de propietario chainpulse_app para login_lookup", () => {
    expect(ts).toContain('provolatile === "s"');
    expect(ts).toContain("login_lookup.no_propietario_chainpulse_app");
  });

  it("verifica privilegios de PUBLIC sobre las 33 tablas (no solo los de chainpulse_app)", () => {
    expect(ts).toContain("GRANT:PUBLIC");
    expect(ts).toContain("grantee = 'PUBLIC'");
  });

  it("verifica privilegios de esquema (USAGE de chainpulse_app, ausencia de CREATE para chainpulse_app y para PUBLIC)", () => {
    expect(ts).toContain("verificarPrivilegiosEsquema");
    expect(ts).toContain("has_schema_privilege");
    expect(ts).toContain("aclexplode");
  });

  it("verifica atributos de rol (sin SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB) y ausencia de membresia de chainpulse_app", () => {
    expect(ts).toContain("verificarRolChainpulseApp");
    expect(ts).toContain("rolbypassrls");
    expect(ts).toContain("pg_auth_members");
  });

  it("separa en el reporte final las 4 categorias de cobertura (historica/nueva/estatica/pendiente de Postgres real)", () => {
    expect(ts).toContain("Cobertura por origen");
    expect(ts).toContain("HISTORICAMENTE VERSIONADA");
    expect(ts).toContain("INCORPORADA AHORA");
    expect(ts).toContain("UNICAMENTE DE FORMA ESTATICA");
    expect(ts).toContain("PENDIENTE DE COMPROBAR EN POSTGRESQL REAL");
  });

  it("no imprime nunca columnas sensibles (passwordHash/mfaSecret) fuera del literal de comparacion de login_lookup, y nunca hace SELECT de filas de usuarios", () => {
    // PROSRC_ESPERADO_LOGIN_LOOKUP SI debe contener estos nombres de
    // columna -- es el texto fijo contra el que se compara el prosrc
    // real (metadato de catalogo), nunca un valor impreso de una fila
    // real. Se recorta ese literal antes de buscar fuera de el, para no
    // confundir "el texto esperado contiene estas palabras" con "el
    // script imprime estas columnas".
    const inicio = ts.indexOf("const PROSRC_ESPERADO_LOGIN_LOOKUP");
    const fin = ts.indexOf("`;", inicio) + 2;
    expect(inicio).toBeGreaterThan(-1);

    // Ronda 9: ademas del literal de prosrc, NOMBRES_ARGUMENTOS_ESPERADOS_
    // LOGIN_LOOKUP (identidad completa de argumentos/columnas de retorno,
    // ver verificarLoginLookup) TAMBIEN debe contener estos nombres de
    // columna de forma legitima -- es el mismo tipo de "texto fijo contra
    // el que se compara", no una columna impresa de una fila real. Se
    // recorta tambien este segundo literal antes de buscar fuera de el.
    const inicio2 = ts.indexOf("const NOMBRES_ARGUMENTOS_ESPERADOS_LOGIN_LOOKUP");
    const fin2 = ts.indexOf("];", inicio2) + 2;
    expect(inicio2).toBeGreaterThan(-1);

    const sinLosLiterales = ts.slice(0, inicio) + ts.slice(fin, inicio2) + ts.slice(fin2);

    expect(sinLosLiterales).not.toContain("passwordHash");
    expect(sinLosLiterales).not.toContain("mfaSecret");
    expect(sinLosLiterales).not.toMatch(/FROM\s+"?usuarios"?\b/i);
  });
});
