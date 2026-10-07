-- ChainPulse — Reconstruccion reproducible de RLS/auth/grants manuales
-- (Ronda 6 especificacion -> Ronda 7 implementacion -> Ronda 8 revision
-- -> Ronda 9 correccion de 4 hallazgos de la Ronda 8 -> Ronda 10
-- eliminacion de la tabla de bitacora propia -> Ronda 11 correccion de
-- proargmodes esperado de login_lookup() -> Ronda 12, esta version:
-- correccion del conjunto esperado de EXECUTE grants de login_lookup()
-- tras segunda ejecucion real en PostgreSQL 18.6, 2026-10-06).
--
-- ALCANCE EXACTO de esta migracion (no mas que esto):
--   0) Precondiciones de rol a nivel Neon para chainpulse_app
--      (atributos y membresia) -- verificar-y-abortar, NUNCA modificar:
--      esto vive en el nivel de rol/branch de Neon, no en una migracion
--      Prisma (ver el documento de planificacion, Seccion 5, "B. Neon
--      ... NO una migracion SQL").
--   A) Las 5 politicas RLS de columna directa que HOY SOLO viven en
--      prisma/rls.sql (empresas/usuarios/eslabones/conexiones/ciclos_pulso)
--      -- las otras 9 tablas con RLS de columna directa (consentimientos_
--      cuenta, cadenas, nodos, conexiones_cadena, hallazgos_cadena,
--      respuestas_cadena, observaciones_kpi, importaciones_csv,
--      observaciones_cobertura) YA estan versionadas en sus propias
--      migraciones historicas -- esta migracion no las toca.
--   B) Las 5 politicas RLS por subconsulta que HOY SOLO viven en
--      prisma/rls.sql (respuestas_crudas/resultados_conexion/
--      resultados_ciclo/metricas_cuestionario/recomendaciones_ejecutadas)
--      -- la sexta tabla hija por subconsulta (flujos_conexion_cadena) YA
--      esta versionada en 20260920040000_incremento3_mapa_bloque_a; no se
--      toca aqui.
--   C) La funcion login_lookup() que HOY SOLO vive en
--      prisma/auth_functions.sql -- con verificacion de identidad
--      completa (esquema, firma, tipos de retorno) antes de comparar
--      contenido, nunca solo "existe con 1 argumento" (ver Seccion C).
--   D) El GRANT base de las 14 tablas que HOY no tienen ningun GRANT en
--      ningun archivo del repositorio (documento de planificacion,
--      Ronda 6, Seccion 4.1) -- incluye "conexiones" y "ciclos_pulso",
--      que son ademas una DEPENDENCIA DE TIEMPO DE EJECUCION de las
--      politicas de la Seccion B -- mas la ausencia de privilegios a
--      PUBLIC sobre esas mismas 14 tablas.
--   E) El privilegio de esquema "public": USAGE indispensable para
--      chainpulse_app (se crea si falta, igual que un GRANT de tabla) y
--      ausencia de CREATE tanto para chainpulse_app como para PUBLIC.
--
-- FUERA de alcance a proposito (sin excepciones):
--   - Nada de pg-boss (schema, tablas, colas, grants) -- eso sigue
--     siendo exclusivamente scripts/bootstrapPgBoss.ts, un bootstrap
--     separado y versionado aparte, nunca esta migracion.
--   - Nada de MFA, revocacion de sesion (sessionVersion) ni mantenimiento
--     de contraseñas -- cambios no relacionados que ya estan en el
--     arbol de trabajo, no se mezclan aqui.
--   - No se modifica ninguna de las 23 migraciones historicas ya
--     aplicadas, ni la migracion sin commitear
--     20261003080000_incremento_revocacion_sesion.
--   - Los privilegios de PUBLIC/ausencia de exceso sobre las OTRAS 19
--     tablas ya confirmadas en migraciones historicas, y sobre las OTRAS
--     10 politicas RLS ya versionadas, son responsabilidad del
--     verificador de drift (scripts/verificarDriftReconstruccion.ts),
--     no de esta migracion -- esta migracion solo audita lo que ella
--     misma gestiona (mismo limite de alcance que ya regia en la Ronda 7).
--
-- DISEÑO: verificar-o-abortar, nunca sobrescribir en silencio.
-- Para cada objeto (rol, politica, funcion, grant): si no existe (y
-- corresponde crearlo), se crea; si existe y coincide exactamente con lo
-- esperado, se conserva sin tocarlo; si existe pero difiere en
-- expresion, operacion, rol, propietario, seguridad, volatilidad o
-- permisos, esta migracion ABORTA con un error fijo y descriptivo
-- (RAISE EXCEPTION), sin modificar nada. Los privilegios/atributos que
-- NO son creables desde una migracion (atributos de rol, membresia,
-- CREATE inesperado sobre un esquema) se verifican y abortan igual, pero
-- NUNCA se intentan corregir con ALTER ROLE/REVOKE automatico -- revisar
-- manualmente es siempre la salida, nunca una correccion silenciosa.
--
-- No se usa DROP ... CASCADE en ningun punto de este archivo.
--
-- CREATE OR REPLACE FUNCTION no se usa en ningun punto (ver Seccion C):
-- un CREATE OR REPLACE nunca falla solo porque el cuerpo sea distinto al
-- esperado (Postgres lo acepta igual, salvo cambio de tipo de retorno) --
-- exactamente la sobrescritura silenciosa que esta migracion existe para
-- evitar. El patron de verificar-o-abortar ya decide explicitamente
-- entre crear/conservar/abortar antes de llegar a cualquier CREATE.
--
-- TRANSACCION EXPLICITA (corregido en la Ronda 9 -- antes esta cabecera
-- afirmaba, sin haberlo verificado, que Postgres envuelve el archivo
-- completo en una transaccion implicita con cualquier motor de
-- migraciones). Investigado contra la documentacion/blog oficial de
-- Prisma: "PostgreSQL: You can opt-in by adding BEGIN; and COMMIT; to
-- the generated schema migrations. By default, Migrate does not wrap
-- migrations in a transaction." (prisma.io/blog/prisma-migrate-dx-
-- primitives) -- confirma que agregar BEGIN/COMMIT explicito es el
-- mecanismo oficialmente documentado por Prisma para este caso exacto,
-- no una improvisacion. Por eso este archivo ya NO depende de ningun
-- comportamiento implicito: envuelve TODO su contenido en BEGIN;/COMMIT;
-- explicitos (primera y ultima instruccion efectiva del archivo). Ningun
-- comando de este archivo esta en la lista de comandos que PostgreSQL
-- prohibe dentro de un bloque de transaccion (esa lista son operaciones
-- como CREATE DATABASE/TABLESPACE, CREATE INDEX CONCURRENTLY/REINDEX
-- CONCURRENTLY, VACUUM, ALTER SYSTEM -- ninguna aparece aqui): todo lo
-- que este archivo usa (CREATE TEMP TABLE, CREATE POLICY, ALTER TABLE
-- ... ENABLE ROW LEVEL SECURITY, CREATE FUNCTION, GRANT, REVOKE, INSERT,
-- DROP TABLE, bloques DO) es DDL/DML transaccional estandar. Con un
-- BEGIN/COMMIT explicito, si Postgres TAMBIEN envuelve el archivo en una
-- transaccion implicita (el caso tipico documentado para el protocolo
-- simple de consultas), el BEGIN interno es un no-op que solo emite un
-- aviso ("WARNING: there is already a transaction in progress") y el
-- COMMIT interno confirma esa misma transaccion en el mismo punto donde
-- el archivo termina de todos modos -- mismo resultado. Si Postgres NO
-- la envolviera implicitamente (el escenario que esta sesion no pudo
-- descartar para este proyecto por su configuracion engineType="client"
-- -- ver la Ronda 8), el BEGIN/COMMIT explicito es lo unico que sigue
-- garantizando "todo o nada". Nunca puede quedar peor que antes; en el
-- peor caso explorado, queda exactamente igual de bien; en el caso que
-- la Ronda 8 señalo como no verificado, queda estrictamente mejor.
--
-- RIESGO ABIERTO QUE SIGUE VIGENTE, documentado explicitamente (ver
-- tambien el documento de planificacion, Secciones Ronda 8): la
-- comparacion de las expresiones de politica RLS (Secciones A y B) usa
-- pg_get_expr(), que RECONSTRUYE (deparsea) la expresion desde el arbol
-- ya parseado -- no conserva el texto original de CREATE POLICY. Para no
-- depender de un string adivinado a mano contra ese deparse, cada
-- comparacion canonicaliza la expresion ESPERADA corriendo la misma
-- fuente SQL contra una tabla temporal descartable (CREATE TEMP TABLE,
-- se borra dentro de la misma transaccion) y comparando deparse-contra-
-- deparse. Esta ronda agrega una prueba de integracion PREPARADA (no
-- ejecutada) que ejercita esto contra Postgres real cuando se autorice
-- (ver src/infra/prisma/__tests__/reconstruccionRlsAuthGrantsRamas.
-- integration.test.ts) -- la PRIMERA corrida real de ESA prueba sigue
-- siendo la que confirma en vivo que el diseño funciona como se espera.
--
-- CORRECCION ADICIONAL (Ronda 9, encontrada al diseñar esa misma prueba,
-- no pedida explicitamente pero dentro del alcance del punto 3 de la
-- Ronda 9 -- "privilegios"): la Seccion D comparaba los privilegios
-- ACTUALES de chainpulse_app siempre contra el esquema "public" explicito
-- (information_schema.role_table_grants WHERE table_schema = 'public'),
-- pero el GRANT de CORRECCION se emitia sin calificar el esquema (GRANT
-- ... ON %I ...), es decir, resuelto por search_path en tiempo de
-- ejecucion -- lectura fija a "public", escritura dependiente de
-- search_path. En la conexion de produccion normal (search_path default)
-- ambas coinciden, pero la inconsistencia es real: con un search_path no
-- default, la decision de "falta/coincide/diverge" se toma mirando una
-- tabla y el GRANT podria aplicarse sobre una tabla distinta del mismo
-- nombre en otro esquema anterior en el search_path. Se corrigio
-- calificando tambien la escritura (GRANT ... ON public.%I ...) para que
-- lectura y escritura de la Seccion D siempre coincidan, sin depender de
-- search_path. Este hallazgo es ademas la razon por la que la prueba de
-- Ramas (parrafo anterior) NO ejecuta esta Seccion D contra el esquema de
-- prueba aislado: a diferencia de las Secciones A/B (RLS, consistentemente
-- resueltas por search_path en lectura Y escritura via ::regclass/%I), la
-- Seccion D opera siempre sobre privilegios REALES de "public" por diseño
-- -- aislarla en una prueba automatizada implicaria o bien mutar permisos
-- reales como efecto de una prueba (inaceptable) o simular ese estado real
-- (no seria una prueba fiel). Las Secciones C/E tienen el mismo diseño
-- (dependen de objetos/privilegios reales globales o de "public"
-- explicito) por la misma razon no se ejercitan en la prueba de Ramas.

-- RONDA 10 (2026-10-05) -- ELIMINACION DE LA TABLA DE BITACORA PROPIA.
-- La Ronda 9 habia agregado "_bitacora_reconstruccion_rls_auth_grants"
-- (una tabla CREATE TABLE IF NOT EXISTS, sin GRANT a nadie salvo su
-- propietario) para registrar, objeto por objeto, si esta migracion lo
-- creo o lo encontro ya conservado -- pensada como insumo para un
-- eventual rollback dirigido. Decision explicita de Alex en esta ronda:
-- eliminarla, salvo que se pudiera demostrar una necesidad tecnica que
-- "_prisma_migrations" (el registro de Prisma de que este archivo ya se
-- aplico) y la transaccion BEGIN/COMMIT de este mismo archivo no
-- cubrieran ya. No se encontro ninguna: la unica razon de ser de la
-- bitacora era servir de fuente para un rollback automatico dirigido por
-- objeto -- y esta misma ronda decide, de forma independiente, NO
-- implementar nunca ese tipo de rollback (ver el parrafo siguiente). Sin
-- ese consumidor, la bitacora no aportaba nada que "_prisma_migrations"
-- (si este archivo se aplico o no) y la transaccion (si el archivo
-- aplico completo o no aplico nada en absoluto) no resolvieran ya.
-- Ademas, su diseno original (INSERT simple, sin ON CONFLICT, clave primaria fija
-- por objeto+migracion) tenia un defecto real: una segunda corrida
-- directa de esta migracion contra una base donde ya habia corrido antes
-- habria fallado con "duplicate key value violates unique constraint" en
-- el primer INSERT -- no por ninguna divergencia real de RLS/privilegios,
-- sino por la bitacora misma. Al eliminarla, ese defecto desaparece junto
-- con la tabla: las Secciones 0/A/B/C/D/E, sin la bitacora, vuelven a ser
-- SQL plano verificar-o-abortar, sin ningun efecto secundario no
-- idempotente -- confirmado seccion por seccion (ver tambien la cabecera
-- de reconstruccionRlsAuthGrantsRamas.integration.test.ts, que ahora
-- ejercita esto con una prueba de repeticion directa ademas de la prueba
-- principal de conservacion).
--
-- QUE SIGUE IGUAL: el patron verificar-o-abortar sigue decidiendo, para
-- cada objeto, entre crear (ausente), conservar (idéntico) o abortar
-- (divergente) -- esta ronda NO toco esa logica en ninguna seccion, solo
-- le quito la linea de bitacora a cada rama CREADO/CONSERVADO. BEGIN;/
-- COMMIT; explicitos se conservan sin cambios.
--
-- ESTRATEGIA DE ROLLBACK, EXPLICITA A PARTIR DE ESTA RONDA:
--   1) Durante la aplicacion: si cualquier seccion aborta (RAISE
--      EXCEPTION), Postgres revierte TODA la transaccion de este archivo
--      -- todo lo que esta migracion haya hecho hasta ese punto en esa
--      misma corrida, sin excepcion. Esto depende unicamente de la
--      transaccion de PostgreSQL (BEGIN/COMMIT explicitos de este mismo
--      archivo), nunca de ningun registro propio.
--   2) Despues de un COMMIT exitoso: esta migracion NO implementa, y no
--      va a implementar, un rollback posterior que borre automaticamente
--      las politicas, la funcion o los GRANT que adopto o creo. Revertir
--      esta migracion una vez aplicada con exito requiere escribir una
--      migracion CORRECTIVA NUEVA (un archivo Prisma nuevo, con su propio
--      DROP POLICY / DROP FUNCTION / REVOKE explicitos sobre los objetos
--      puntuales a revertir) -- nunca un mecanismo automatico que lea un
--      registro propio y borre en base a el.
--   3) Nunca se deben borrar objetos preexistentes basandose en una
--      bitacora propia de esta migracion -- ni esta migracion ni ninguna
--      futura deberian asumir que "creado por mi" es seguro de inferir
--      de un registro que esta migracion mantiene sola; la unica fuente
--      confiable de que paso es el estado real de la base (pg_policy,
--      pg_proc, information_schema.role_table_grants, etc.), igual que
--      ya hace el verificador de drift.

BEGIN;

-- =============================================================
-- SECCION 0 — Precondiciones de rol a nivel Neon (chainpulse_app).
-- SOLO verificar-y-abortar: estos atributos no se crean ni se corrigen
-- desde una migracion de Prisma (documento de planificacion, Seccion 5,
-- "B. Neon ... NO una migracion SQL"). Si esto aborta, corregir en la
-- consola de Neon (Roles -> chainpulse_app) y recien despues reintentar
-- esta migracion -- nunca editar este bloque para "pasar" el chequeo.
-- =============================================================
DO $$
DECLARE
  v_rolsuper boolean;
  v_rolbypassrls boolean;
  v_rolcreaterole boolean;
  v_rolcreatedb boolean;
  v_membresias text[];
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
    INTO v_rolsuper, v_rolbypassrls, v_rolcreaterole, v_rolcreatedb
    FROM pg_roles WHERE rolname = 'chainpulse_app';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECONSTRUCCION_PRECONDICION_ROL: el rol "chainpulse_app" no existe -- se crea a nivel de Neon (consola), nunca por esta migracion. Abortando sin crear ni modificar nada.';
  END IF;

  IF v_rolsuper OR v_rolbypassrls OR v_rolcreaterole OR v_rolcreatedb THEN
    RAISE EXCEPTION 'RECONSTRUCCION_PRECONDICION_ROL: chainpulse_app tiene atributos de rol excesivos (rolsuper=%, rolbypassrls=%, rolcreaterole=%, rolcreatedb=%) -- se esperan los cuatro en false. Esto es un atributo de rol a nivel Neon, no corregible desde esta migracion -- corregir en la consola de Neon (Roles) y reintentar. Abortando sin crear ni modificar nada.',
      v_rolsuper, v_rolbypassrls, v_rolcreaterole, v_rolcreatedb;
  END IF;

  SELECT array_agg(r.rolname ORDER BY r.rolname) INTO v_membresias
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid
    JOIN pg_roles m2 ON m2.oid = m.member
    WHERE m2.rolname = 'chainpulse_app';

  IF v_membresias IS NOT NULL THEN
    RAISE EXCEPTION 'RECONSTRUCCION_PRECONDICION_ROL: chainpulse_app es miembro de otro(s) rol(es) (%) -- se espera que no sea miembro de ningun rol (ninguna herencia de privilegio administrativo). Esto es un atributo de rol a nivel Neon, no corregible desde esta migracion -- corregir en la consola de Neon y reintentar. Abortando sin crear ni modificar nada.',
      v_membresias;
  END IF;
END;
$$;

-- =============================================================
-- SECCION A — RLS de columna directa (5 tablas, solo las que HOY
-- viven unicamente en prisma/rls.sql).
-- =============================================================
DO $$
DECLARE
  rec record;
  v_policy_name text;
  v_expr_fuente text;
  v_expr_esperado text;
  v_expr_actual text;
  v_policy_exists boolean;
  v_rls_enabled boolean;
  v_rls_forced boolean;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('empresas', 'id'),
    ('usuarios', '"empresaId"'),
    ('eslabones', '"empresaId"'),
    ('conexiones', '"empresaId"'),
    ('ciclos_pulso', '"empresaId"')
  ) AS t(tabla, columna)
  LOOP
    v_policy_name := 'tenant_isolation_' || rec.tabla;
    v_expr_fuente := rec.columna || ' = current_setting(''app.tenant_id'', true)';

    EXECUTE format('CREATE TEMP TABLE _calib (%s text)', rec.columna);
    EXECUTE format('CREATE POLICY _calib_pol ON _calib USING (%s)', v_expr_fuente);
    SELECT pg_get_expr(polqual, polrelid) INTO v_expr_esperado
      FROM pg_policy WHERE polname = '_calib_pol' AND polrelid = '_calib'::regclass;
    EXECUTE 'DROP TABLE _calib';

    SELECT relrowsecurity, relforcerowsecurity INTO v_rls_enabled, v_rls_forced
      FROM pg_class WHERE oid = rec.tabla::regclass;

    SELECT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = v_policy_name AND polrelid = rec.tabla::regclass
    ) INTO v_policy_exists;

    IF NOT v_policy_exists THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tabla);
      EXECUTE format('CREATE POLICY %I ON %I USING (%s)', v_policy_name, rec.tabla, v_expr_fuente);
    ELSE
      SELECT pg_get_expr(polqual, polrelid) INTO v_expr_actual
        FROM pg_policy WHERE polname = v_policy_name AND polrelid = rec.tabla::regclass;

      IF v_expr_actual IS DISTINCT FROM v_expr_esperado
         OR v_rls_enabled IS DISTINCT FROM true
         OR v_rls_forced IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'RECONSTRUCCION_RLS_DIVERGENTE: la politica "%" sobre "%" ya existe pero difiere de lo esperado (expresion y/o relrowsecurity/relforcerowsecurity). Esperada: % (rls=true, force=false). Encontrada: % (rls=%, force=%). Abortando sin modificar nada -- revisar manualmente antes de reintentar.',
          v_policy_name, rec.tabla, v_expr_esperado, v_expr_actual, v_rls_enabled, v_rls_forced;
      END IF;

    END IF;
  END LOOP;
END;
$$;

-- =============================================================
-- SECCION B — RLS por subconsulta (5 tablas hijas sin empresaId propio,
-- solo las que HOY viven unicamente en prisma/rls.sql).
--
-- Cadena exacta de obtencion del tenant: para una fila de, por ejemplo,
-- "respuestas_crudas", Postgres evalua
--   "conexionId" IN (SELECT id FROM "conexiones" WHERE "empresaId" = current_setting('app.tenant_id', true))
-- chainpulse_app necesita, como minimo, SELECT real sobre "conexiones"
-- (respuestas_crudas, resultados_conexion) y sobre "ciclos_pulso"
-- (resultados_ciclo, metricas_cuestionario, recomendaciones_ejecutadas)
-- -- la Seccion D de ESTA MISMA migracion se lo otorga. La politica de
-- la tabla padre compara unicamente su PROPIA columna "empresaId" contra
-- current_setting() -- no hay ciclo posible entre padre e hija, ni
-- bypass (chainpulse_app evalua la subconsulta con sus propios
-- privilegios, no SECURITY DEFINER).
-- =============================================================
DO $$
DECLARE
  rec record;
  v_policy_name text;
  v_expr_fuente text;
  v_expr_esperado text;
  v_expr_actual text;
  v_policy_exists boolean;
  v_rls_enabled boolean;
  v_rls_forced boolean;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('respuestas_crudas', '"conexionId"', '"conexiones"'),
    ('resultados_conexion', '"conexionId"', '"conexiones"'),
    ('resultados_ciclo', '"cicloPulsoId"', '"ciclos_pulso"'),
    ('metricas_cuestionario', '"cicloPulsoId"', '"ciclos_pulso"'),
    ('recomendaciones_ejecutadas', '"cicloPulsoId"', '"ciclos_pulso"')
  ) AS t(tabla, fk_columna, tabla_padre)
  LOOP
    v_policy_name := 'tenant_isolation_' || rec.tabla;
    v_expr_fuente := rec.fk_columna
      || ' IN (SELECT id FROM ' || rec.tabla_padre
      || ' WHERE "empresaId" = current_setting(''app.tenant_id'', true))';

    EXECUTE format('CREATE TEMP TABLE _calib (%s text)', rec.fk_columna);
    EXECUTE format('CREATE POLICY _calib_pol ON _calib USING (%s)', v_expr_fuente);
    SELECT pg_get_expr(polqual, polrelid) INTO v_expr_esperado
      FROM pg_policy WHERE polname = '_calib_pol' AND polrelid = '_calib'::regclass;
    EXECUTE 'DROP TABLE _calib';

    SELECT relrowsecurity, relforcerowsecurity INTO v_rls_enabled, v_rls_forced
      FROM pg_class WHERE oid = rec.tabla::regclass;

    SELECT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = v_policy_name AND polrelid = rec.tabla::regclass
    ) INTO v_policy_exists;

    IF NOT v_policy_exists THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tabla);
      EXECUTE format('CREATE POLICY %I ON %I USING (%s)', v_policy_name, rec.tabla, v_expr_fuente);
    ELSE
      SELECT pg_get_expr(polqual, polrelid) INTO v_expr_actual
        FROM pg_policy WHERE polname = v_policy_name AND polrelid = rec.tabla::regclass;

      IF v_expr_actual IS DISTINCT FROM v_expr_esperado
         OR v_rls_enabled IS DISTINCT FROM true
         OR v_rls_forced IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'RECONSTRUCCION_RLS_DIVERGENTE: la politica "%" sobre "%" ya existe pero difiere de lo esperado (expresion y/o relrowsecurity/relforcerowsecurity). Esperada: % (rls=true, force=false). Encontrada: % (rls=%, force=%). Abortando sin modificar nada -- revisar manualmente antes de reintentar.',
          v_policy_name, rec.tabla, v_expr_esperado, v_expr_actual, v_rls_enabled, v_rls_forced;
      END IF;

    END IF;
  END LOOP;
END;
$$;

-- =============================================================
-- SECCION C — login_lookup() (hoy solo vive en prisma/auth_functions.sql)
--
-- Corregido en la Ronda 9 (hallazgos de la Ronda 8): ya NO alcanza con
-- "SELECT ... INTO ... WHERE proname='login_lookup' AND pronargs=1" --
-- sin STRICT, PL/pgSQL toma la primera fila de varias y descarta el
-- resto EN SILENCIO (no aborta) ante una sobrecarga inesperada. La
-- correccion no es simplemente agregar STRICT -- es verificar primero,
-- de forma explicita y con mensajes distintos por causa, que existe
-- EXACTAMENTE una funcion con la IDENTIDAD esperada (esquema, firma
-- completa de entrada/salida) antes de comparar su contenido (cuerpo,
-- seguridad, propietario, ACL). STRICT se usa ademas como defensa en
-- profundidad en la lectura puntual, convertido a nuestro propio mensaje
-- fijo si se dispara.
--
-- Los tipos esperados de cada columna se resuelven con to_regtype() en
-- vez de comparar contra el texto que produciria format_type() -- evita
-- tener que adivinar como Postgres formatea un tipo compuesto/enum
-- (p. ej. si antepone comillas a "RolUsuario"); comparar OIDs de tipo
-- directamente es exacto sin tener que adivinar un formato de texto.
--
-- Volatilidad: STABLE (no VOLATILE, el default sin declarar). La
-- funcion solo lee datos dentro de una unica sentencia SELECT y no
-- modifica la base -- STABLE es la anotacion semanticamente correcta
-- (mismo resultado para los mismos argumentos dentro de una misma
-- sentencia/transaccion) y es lo que esta migracion ahora declara y
-- verifica.
DO $$
DECLARE
  v_conteo integer;
  v_oid oid;
  v_esquema text;
  v_proargnames text[];
  v_proargmodes "char"[];
  v_proallargtypes oid[];
  v_prosrc_actual text;
  v_prosecdef boolean;
  v_provolatile "char";
  v_proconfig text[];
  v_owner text;
  v_execute_grantees text[];
  -- RONDA 12: corregido tras ejecucion real contra PostgreSQL 18.6 (ver
  -- diagnostico de Alex, 2026-10-06, 106 chequeos: 105 OK + 1
  -- divergencia). information_schema.routine_privileges cataloga a
  -- neondb_owner (el propietario) como grantee de EXECUTE aunque nunca
  -- se le haya otorgado explicitamente y aunque REVOKE ALL FROM PUBLIC
  -- ya se haya aplicado -- el propietario de una funcion conserva sus
  -- facultades inherentes sobre ella, eso no es un GRANT adicional que
  -- REVOKE pueda quitar. Exigir "exactamente chainpulse_app" es
  -- incompatible con exigir simultaneamente, en la misma condicion,
  -- "owner = neondb_owner": el conjunto efectivo real y correcto es
  -- {chainpulse_app, neondb_owner}, nunca uno solo. PUBLIC o cualquier
  -- tercer rol siguen siendo divergencia real -- esto NO relaja el
  -- chequeo, lo hace coincidir con el comportamiento real de Postgres.
  v_execute_grantees_esperado text[] := ARRAY['chainpulse_app','neondb_owner'];
  v_proargnames_esperado text[] := ARRAY[
    'p_email', 'id', 'empresaId', 'email', 'nombre', 'rol', 'passwordHash',
    'mfaSecret', 'mfaHabilitado', 'intentosFallidos', 'bloqueadoHasta', 'eslabonId'
  ];
  -- RONDA 11: corregido tras ejecucion real contra PostgreSQL 18.6 (ver
  -- diagnostico de Alex, 2026-10-06). El modo esperado para las 11
  -- columnas de salida de RETURNS TABLE es 't' (tabla), no 'o' (out) --
  -- 'o' es el modo de un parametro OUT declarado suelto (CREATE FUNCTION
  -- f(OUT x int)), mientras que 't' es el modo real que Postgres cataloga
  -- en pg_proc.proargmodes para cada columna de un RETURNS TABLE (visto
  -- directamente via SELECT proargmodes FROM pg_proc, no inferido). La
  -- migracion aplicada en Ronda 10 declaraba 'o' y por lo tanto NUNCA
  -- habria reconocido como identica la funcion que ella misma crea --
  -- una segunda ejecucion real habria abortado por falso divergente en
  -- vez de conservar.
  v_proargmodes_esperado "char"[] := ARRAY['i','t','t','t','t','t','t','t','t','t','t','t']::"char"[];
  v_proallargtypes_esperado oid[] := ARRAY[
    to_regtype('text'), to_regtype('text'), to_regtype('text'), to_regtype('text'),
    to_regtype('text'), to_regtype('"RolUsuario"'), to_regtype('text'), to_regtype('text'),
    to_regtype('boolean'), to_regtype('integer'), to_regtype('timestamp'), to_regtype('text')
  ]::oid[];
  v_prosrc_esperado text := '
  SELECT id, "empresaId", email, nombre, rol, "passwordHash", "mfaSecret",
         "mfaHabilitado", "intentosFallidos", "bloqueadoHasta", "eslabonId"
  FROM usuarios
  WHERE email = p_email
  LIMIT 1;
';
BEGIN
  SELECT count(*) INTO v_conteo FROM pg_proc WHERE proname = 'login_lookup';

  IF v_conteo = 0 THEN
    CREATE FUNCTION login_lookup(p_email text)
    RETURNS TABLE (
      id text,
      "empresaId" text,
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
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $BODY$
  SELECT id, "empresaId", email, nombre, rol, "passwordHash", "mfaSecret",
         "mfaHabilitado", "intentosFallidos", "bloqueadoHasta", "eslabonId"
  FROM usuarios
  WHERE email = p_email
  LIMIT 1;
$BODY$;

    REVOKE ALL ON FUNCTION login_lookup(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION login_lookup(text) TO chainpulse_app;

  ELSIF v_conteo > 1 THEN
    RAISE EXCEPTION 'RECONSTRUCCION_AUTH_SOBRECARGA_INESPERADA: existen % funciones llamadas "login_lookup" en el catalogo (cualquier esquema, cualquier firma) -- se esperaba como maximo 1. Abortando sin modificar nada -- revisar manualmente antes de reintentar.', v_conteo;

  ELSE
    -- v_conteo = 1: verificar IDENTIDAD completa (esquema + firma exacta
    -- de entrada/salida) ANTES de comparar contenido. STRICT como
    -- defensa en profundidad ante una condicion de carrera entre el
    -- conteo de arriba y esta lectura (otra sesion crea/borra una
    -- sobrecarga en el medio) -- convertido a nuestro propio mensaje
    -- fijo en vez de dejar propagar el error generico de Postgres.
    BEGIN
      SELECT p.oid, p.pronamespace::regnamespace::text, p.proargnames, p.proargmodes, p.proallargtypes
        INTO STRICT v_oid, v_esquema, v_proargnames, v_proargmodes, v_proallargtypes
        FROM pg_proc p WHERE p.proname = 'login_lookup';
    EXCEPTION
      WHEN TOO_MANY_ROWS THEN
        RAISE EXCEPTION 'RECONSTRUCCION_AUTH_SOBRECARGA_INESPERADA: se detecto mas de una funcion "login_lookup" entre el conteo inicial y esta verificacion (condicion de carrera) -- abortando sin modificar nada.';
      WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION 'RECONSTRUCCION_AUTH_DIVERGENTE: el conteo inicial indicaba exactamente 1 funcion "login_lookup" pero desaparecio antes de poder leerla (condicion de carrera) -- abortando sin modificar nada. Reintentar esta migracion desde cero.';
    END;

    IF v_esquema IS DISTINCT FROM 'public' THEN
      RAISE EXCEPTION 'RECONSTRUCCION_AUTH_DIVERGENTE: login_lookup existe pero en el esquema "%", no en "public". Abortando sin modificar nada -- revisar manualmente antes de reintentar.', v_esquema;
    END IF;

    IF v_proargnames IS DISTINCT FROM v_proargnames_esperado THEN
      RAISE EXCEPTION 'RECONSTRUCCION_AUTH_DIVERGENTE: login_lookup existe pero sus nombres de argumento/columnas de retorno (%) no coinciden con lo esperado (%) -- nombre de argumento de entrada o columnas de RETURNS TABLE distintas. Abortando sin modificar nada -- revisar manualmente antes de reintentar.',
        v_proargnames, v_proargnames_esperado;
    END IF;

    IF v_proargmodes IS DISTINCT FROM v_proargmodes_esperado THEN
      RAISE EXCEPTION 'RECONSTRUCCION_AUTH_DIVERGENTE: login_lookup existe pero el patron de argumentos de entrada/salida (%) no coincide con lo esperado (%) -- cantidad o posicion de argumentos IN/OUT distinta. Abortando sin modificar nada -- revisar manualmente antes de reintentar.',
        v_proargmodes, v_proargmodes_esperado;
    END IF;

    IF v_proallargtypes IS DISTINCT FROM v_proallargtypes_esperado THEN
      RAISE EXCEPTION 'RECONSTRUCCION_AUTH_DIVERGENTE: login_lookup existe pero el tipo de alguno de sus argumentos/columnas de retorno no coincide con lo esperado (comparacion por OID de tipo via to_regtype, no por texto formateado). Abortando sin modificar nada -- revisar manualmente antes de reintentar.';
    END IF;

    -- Identidad confirmada -- ahora comparar contenido.
    SELECT prosrc, prosecdef, provolatile, proconfig,
           (SELECT rolname FROM pg_roles WHERE oid = proowner)
      INTO v_prosrc_actual, v_prosecdef, v_provolatile, v_proconfig, v_owner
      FROM pg_proc WHERE oid = v_oid;

    SELECT array_agg(grantee::text ORDER BY grantee::text) INTO v_execute_grantees
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public' AND routine_name = 'login_lookup' AND privilege_type = 'EXECUTE';

    IF regexp_replace(v_prosrc_actual, '\s+', ' ', 'g') IS DISTINCT FROM regexp_replace(v_prosrc_esperado, '\s+', ' ', 'g')
       OR v_prosecdef IS DISTINCT FROM true
       OR v_provolatile IS DISTINCT FROM 's'
       OR v_proconfig IS NULL
       OR NOT ('search_path=public' = ANY (v_proconfig))
       OR v_owner IS DISTINCT FROM 'neondb_owner'
       OR v_execute_grantees IS DISTINCT FROM v_execute_grantees_esperado THEN
      RAISE EXCEPTION 'RECONSTRUCCION_AUTH_DIVERGENTE: login_lookup(text) tiene la identidad esperada pero difiere en contenido (cuerpo, volatilidad, SECURITY DEFINER, search_path, propietario o permisos de EXECUTE). Propietario encontrado: % (se espera neondb_owner -- chainpulse_app NUNCA puede ser propietaria de esta funcion, ver Seccion 0 y el chequeo de membresia: no tiene ni ownership ni herencia del rol propietario). SECURITY DEFINER encontrado: %. Volatilidad encontrada: % (se espera s=STABLE). search_path encontrado: %. EXECUTE otorgado a: % (se espera exactamente %, nunca PUBLIC ni un tercer rol -- el propietario conserva EXECUTE inherente sobre su propia funcion, eso no es un GRANT adicional que REVOKE ALL FROM PUBLIC pueda quitar). Abortando sin modificar nada -- revisar manualmente antes de reintentar.',
        v_owner, v_prosecdef, v_provolatile, v_proconfig, v_execute_grantees, v_execute_grantees_esperado;
    END IF;

  END IF;
END;
$$;

-- =============================================================
-- SECCION D — GRANT base de las 14 tablas sin GRANT en el repositorio
-- (Ronda 6, Seccion 4.1), mas (Ronda 9) la ausencia de privilegios a
-- PUBLIC sobre esas mismas 14 tablas -- nunca se revoca automaticamente
-- un privilegio de PUBLIC encontrado: se aborta, porque esta migracion
-- no puede saber con certeza si fue intencional.
-- =============================================================
DO $$
DECLARE
  v_tabla text;
  v_tablas text[] := ARRAY[
    'empresas', 'usuarios', 'eslabones', 'conexiones', 'ciclos_pulso',
    'respuestas_crudas', 'resultados_conexion', 'resultados_ciclo',
    'evaluaciones_expres', 'evaluaciones_expres_eslabones', 'evaluaciones_expres_conexiones',
    'metricas_cuestionario', 'recomendaciones_ejecutadas', 'limite_tasa'
  ];
  v_actual text[];
  v_esperado text[] := ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
  v_public_actual text[];
BEGIN
  FOREACH v_tabla IN ARRAY v_tablas
  LOOP
    SELECT array_agg(privilege_type ORDER BY privilege_type) INTO v_actual
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = v_tabla AND grantee = 'chainpulse_app';

    IF v_actual IS NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO chainpulse_app', v_tabla);
    ELSIF v_actual IS DISTINCT FROM v_esperado THEN
      -- v_actual ya no es NULL en este punto (la rama de arriba lo cubre) --
      -- IS DISTINCT FROM es equivalente aqui a "<>" para dos arrays no
      -- nulos, y evita tener que mantener una tercera rama "coincide, no
      -- hacer nada" (PL/pgSQL no permite una rama con cero sentencias; sin
      -- la bitacora, esa rama no tenia ninguna otra accion que realizar).
      RAISE EXCEPTION 'RECONSTRUCCION_GRANTS_DIVERGENTE: chainpulse_app tiene sobre "%" los privilegios % en vez de los esperados % -- incluye tanto privilegios faltantes como privilegios excedentes (la comparacion es por igualdad exacta de conjunto, no solo "esta el conjunto completo esperado"). Abortando sin modificar nada -- revisar manualmente antes de reintentar.',
        v_tabla, v_actual, v_esperado;
    END IF;

    SELECT array_agg(privilege_type ORDER BY privilege_type) INTO v_public_actual
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = v_tabla AND grantee = 'PUBLIC';

    IF v_public_actual IS NOT NULL THEN
      RAISE EXCEPTION 'RECONSTRUCCION_GRANTS_EXCESO_PUBLIC: la tabla "%" tiene privilegios otorgados a PUBLIC (%) -- se esperaba ninguno (PUBLIC no deberia tener acceso a ninguna tabla de aplicacion; solo chainpulse_app via GRANT explicito). Esto no se revoca automaticamente -- revisar manualmente antes de reintentar. Abortando sin modificar nada mas.',
        v_tabla, v_public_actual;
    END IF;
  END LOOP;
END;
$$;

-- =============================================================
-- SECCION E — Privilegios sobre el esquema "public" (Ronda 9, nuevo).
-- USAGE es indispensable para que chainpulse_app pueda operar sobre
-- cualquier tabla del esquema -- se crea si falta, igual que un GRANT de
-- tabla (patron 3 vias: falta/coincide/diverge no aplica aqui porque
-- USAGE es binario, asi que el patron es 2 vias: falta -> se otorga;
-- existe -> se conserva, sin rama de "diverge" posible para un permiso
-- binario). CREATE inesperado (para chainpulse_app o para PUBLIC) SI
-- usa el patron de verificar-y-abortar, nunca se revoca automaticamente
-- -- un CREATE podria ser intencional por una razon que esta migracion
-- no puede conocer con certeza. La deteccion de CREATE para PUBLIC usa
-- pg_namespace.nspacl + aclexplode() (grantee = 0 significa PUBLIC en la
-- representacion de ACL de Postgres) porque information_schema no expone
-- una vista de privilegios de esquema equivalente a
-- role_table_grants -- a diferencia del chequeo de tabla de la Seccion
-- D, que SI puede usar information_schema porque esa vista especifica
-- representa PUBLIC como el texto literal 'PUBLIC'.
-- =============================================================
DO $$
DECLARE
  v_usage_chainpulse boolean;
  v_create_chainpulse boolean;
  v_create_public boolean;
BEGIN
  v_usage_chainpulse := has_schema_privilege('chainpulse_app', 'public', 'USAGE');
  v_create_chainpulse := has_schema_privilege('chainpulse_app', 'public', 'CREATE');

  SELECT EXISTS (
    SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) INTO v_create_public;

  IF NOT v_usage_chainpulse THEN
    GRANT USAGE ON SCHEMA public TO chainpulse_app;
  END IF;

  IF v_create_chainpulse THEN
    RAISE EXCEPTION 'RECONSTRUCCION_GRANTS_EXCESO_SCHEMA: chainpulse_app tiene CREATE sobre el esquema "public" -- se esperaba que no lo tuviera (podria crear sus propios objetos sin pasar por ninguna migracion, saltandose todo el modelo de verificar-o-abortar). Esto no se revoca automaticamente -- revisar manualmente antes de reintentar. Abortando sin modificar nada mas.';
  END IF;

  IF v_create_public THEN
    RAISE EXCEPTION 'RECONSTRUCCION_GRANTS_EXCESO_SCHEMA: PUBLIC tiene CREATE sobre el esquema "public" -- cualquier rol (incluido chainpulse_app, por pertenencia implicita a PUBLIC) podria crear sus propios objetos. Esto no se revoca automaticamente -- revisar manualmente antes de reintentar. Abortando sin modificar nada mas.';
  END IF;
END;
$$;

COMMIT;

-- Fin de esta migracion. pg-boss, MFA/revocacion de sesion y
-- mantenimiento de contraseñas quedan fuera a proposito (ver cabecera).
