-- prisma/migrations/20261030090000_rf19_rf20_revoke_create_public/migration.sql
-- PostgreSQL 18.6 (Neon). Debe ejecutarse con la credencial neondb_owner,
-- nunca con chainpulse_app -- ver precondicion abajo, que lo verifica y
-- aborta si no se cumple.

-- ============================================================
-- Transaccion explicita: no se asume que prisma migrate deploy (ni una
-- invocacion manual de psql -f) envuelva este archivo en una transaccion
-- implicita. Un RAISE EXCEPTION sin capturar, dentro de cualquiera de los
-- bloques DO $$ ... $$ de abajo, aborta esta transaccion -- el COMMIT
-- final nunca se alcanza en ese caso.
-- ============================================================
BEGIN;

-- ============================================================
-- PRECONDICION (bloqueante): dos comprobaciones independientes.
-- 1) El ejecutor de esta sesion debe ser literalmente neondb_owner.
-- 2) El propietario REAL del esquema public, leido por catalogo (nunca
--    asumido), tambien debe ser neondb_owner. A diferencia de las
--    funciones SECURITY DEFINER de 3.3 (que corrigen su propietario
--    despues con ALTER FUNCTION), un REVOKE no tiene mecanismo de
--    correccion posterior -- de ahi que esta migracion exija ambas
--    condiciones por adelantado, nunca solo una.
-- ============================================================
DO $$
DECLARE
  v_propietario_real name;
BEGIN
  IF current_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'RF19RF20_PRECONDICION_EJECUTOR: esta migracion debe ejecutarse con la credencial neondb_owner, credencial actual: %', current_user;
  END IF;

  SELECT r.rolname
  INTO v_propietario_real
  FROM pg_namespace AS n
  JOIN pg_roles AS r ON r.oid = n.nspowner
  WHERE n.nspname = 'public';

  IF v_propietario_real IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'RF19RF20_PRECONDICION_PROPIETARIO_REAL: el propietario real del esquema public (pg_namespace.nspowner) es %, se esperaba neondb_owner', v_propietario_real;
  END IF;
END;
$$;

-- ============================================================
-- PREAUDITORIA (informativa, nunca bloqueante): enumera, antes de
-- revocar nada, todo rol -- con nombre o PUBLIC -- que hoy conserva
-- CREATE sobre public. Queda en el log de la migracion como
-- evidencia de diagnostico. La decision de abortar es exclusiva de
-- la postcondicion de abajo, nunca de este bloque.
-- ============================================================
DO $$
DECLARE
  v_fila record;
BEGIN
  FOR v_fila IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS nombre_otorgado_a
    FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
  LOOP
    RAISE NOTICE 'RF19RF20_PREAUDITORIA: % conserva CREATE sobre public antes del REVOKE', v_fila.nombre_otorgado_a;
  END LOOP;
END;
$$;

-- ============================================================
-- Los dos REVOKE. Idempotentes: revocar un privilegio no otorgado
-- es un no-op silencioso en PostgreSQL, nunca un error (ver Prueba
-- B, 3.2, que ejecuta este archivo completo, BEGIN/COMMIT incluidos,
-- una segunda vez sobre un estado ya correcto y exige codigo 0).
-- ============================================================
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM chainpulse_app;

-- === INICIO POSTCONDICION RF19RF20 ===
-- ============================================================
-- POSTCONDICION (bloqueante): cuatro comprobaciones independientes.
-- Si cualquiera falla, esta migracion aborta (ROLLBACK de toda la
-- transaccion explicita de arriba) y ninguna migracion posterior de
-- esta adenda se aplica (9, migraciones 5 y 7; 10, PR 2).
-- Los marcadores que envuelven este bloque delimitan exactamente lo
-- que la Prueba D2 (3.2) extrae y ejecuta de forma aislada.
-- ============================================================
DO $$
DECLARE
  v_public_conserva_create boolean;
  v_chainpulse_app_conserva_create boolean;
  v_rol_inesperado record;
  v_hay_rol_inesperado boolean := false;
  v_chainpulse_app_puede_set_neondb_owner boolean;
BEGIN
  -- Comprobacion 1 (sujeto de la Prueba D1, 3.2) -- PUBLIC es un
  -- pseudo-rol representado en la ACL por grantee = 0, nunca por un
  -- nombre: has_schema_privilege('public', 'public', 'CREATE') seria
  -- incorrecto porque el segundo argumento siempre se interpreta
  -- como el nombre de un rol real (uno literalmente llamado
  -- "public", que no existe), nunca como el pseudo-rol PUBLIC.
  SELECT EXISTS (
    SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) INTO v_public_conserva_create;
  IF v_public_conserva_create THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_1_PUBLIC: PUBLIC conserva CREATE sobre public tras el REVOKE';
  END IF;

  -- Comprobacion 2 -- chainpulse_app especificamente. Aqui si es
  -- correcto usar has_schema_privilege: el primer argumento es el
  -- nombre de un rol real, no el pseudo-rol PUBLIC.
  SELECT has_schema_privilege('chainpulse_app', 'public', 'CREATE') INTO v_chainpulse_app_conserva_create;
  IF v_chainpulse_app_conserva_create THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_2_CHAINPULSE_APP: chainpulse_app conserva CREATE sobre public tras el REVOKE';
  END IF;

  -- Comprobacion 3 (sujeto de la Prueba D2, 3.2) -- ningun rol con
  -- nombre, distinto de neondb_owner, conserva CREATE. neondb_owner
  -- es la unica excepcion esperada: tiene CREATE implicito por ser
  -- propietario del esquema, no por un GRANT revocable.
  FOR v_rol_inesperado IN
    SELECT r.rolname
    FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
      AND r.rolname NOT IN ('neondb_owner')
  LOOP
    v_hay_rol_inesperado := true;
    RAISE WARNING 'RF19RF20_POSTCONDICION_3_ROL_INESPERADO: el rol % conserva CREATE sobre public', v_rol_inesperado.rolname;
  END LOOP;
  IF v_hay_rol_inesperado THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_3_ROL_INESPERADO: abortando -- ningun objeto posterior de esta adenda se crea hasta resolver manualmente los roles listados arriba.';
  END IF;

  -- Comprobacion 4 -- defensa adicional contra escalada indirecta:
  -- aunque 1-3 confirmen que CREATE ya no esta otorgado de forma
  -- directa, esta comprobacion confirma que chainpulse_app tampoco
  -- puede recuperar CREATE asumiendo neondb_owner via SET ROLE.
  SELECT pg_has_role('chainpulse_app', 'neondb_owner', 'SET') INTO v_chainpulse_app_puede_set_neondb_owner;
  IF v_chainpulse_app_puede_set_neondb_owner THEN
    RAISE EXCEPTION 'RF19RF20_POSTCONDICION_4_SET_ROLE: chainpulse_app puede ejecutar SET ROLE neondb_owner -- recuperaria CREATE de forma indirecta';
  END IF;
END;
$$;
-- === FIN POSTCONDICION RF19RF20 ===

COMMIT;
