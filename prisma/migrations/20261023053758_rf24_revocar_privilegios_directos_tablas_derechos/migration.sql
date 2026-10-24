-- Correctivo de privilegios para RF24 (derechos/retiro), posterior a las
-- 3 migraciones de 2026-10-22 (20261022080000_rf24_enum_bucket_limite_tasa,
-- 20261022090000_rf24_tabla_solicitud_derechos,
-- 20261022100000_rf24_funciones_controladas), que NO se modifican.
--
-- Diagnostico confirmado por Alex sobre la rama temporal real: el
-- privilegio EFECTIVO de chainpulse_app sobre las 2 tablas nuevas de RF24
-- resulto SELECT, INSERT, UPDATE, DELETE -- es decir, acceso CRUD directo
-- completo -- a pesar de que 20261022090000_rf24_tabla_solicitud_derechos
-- documenta explicitamente, en su propio header y con
-- "REVOKE ALL ON ... FROM PUBLIC" al final, la decision de diseno de que
-- estas 2 tablas NO deben recibir ningun privilegio directo: toda
-- interaccion debe pasar exclusivamente por las funciones SECURITY
-- DEFINER de 20261022100000_rf24_funciones_controladas.
--
-- Auditoria de solo lectura (Alex, este correctivo) antes de escribir
-- esta migracion, en ese orden:
--   1. Se releyeron literalmente las 3 migraciones de RF24: ninguna
--      contiene un GRANT directo (ni una sola palabra "GRANT" fuera de
--      los GRANT EXECUTE sobre funciones, que son un objeto distinto) a
--      chainpulse_app sobre "solicitudes_derechos" ni sobre
--      "intentos_solicitud_derechos_descartados". El unico GRANT/REVOKE
--      de nivel tabla en las 3 migraciones es precisamente el
--      "REVOKE ALL ... FROM PUBLIC" ya mencionado, en la direccion
--      opuesta a lo que se observo.
--   2. Se busco, en todo el repositorio, cada ALTER DEFAULT PRIVILEGES
--      versionado: existe exactamente uno
--      (scripts/bootstrapPgBoss.ts, "ALTER DEFAULT PRIVILEGES FOR ROLE
--      neondb_owner IN SCHEMA "pgboss" GRANT SELECT, INSERT, UPDATE,
--      DELETE ON TABLES TO chainpulse_app"), explicitamente limitado al
--      esquema "pgboss" -- NO al esquema "public" donde viven las 2
--      tablas de RF24. Este hallazgo es NEGATIVO: descarta esa
--      instruccion puntual como la causa DIRECTA de esta fuga, aunque
--      confirma que este mismo equipo ya configuro antes, para el mismo
--      par de roles y el mismo conjunto exacto de privilegios
--      (SELECT, INSERT, UPDATE, DELETE), un ALTER DEFAULT PRIVILEGES
--      real -- es decir, el mecanismo en si no es ajeno a este proyecto.
--   3. El mismo patron -- un privilegio EFECTIVO mayor al unico GRANT
--      explicito versionado -- ya ocurrio antes, de forma idéntica en
--      el conjunto de privilegios exacto (SELECT, INSERT, UPDATE,
--      DELETE), con "consultas_log"
--      (20261015070000_incremento5_consulta_log_revocar_privilegios_adicionales,
--      que a su vez cita 20260916170000_grants_incremento2 como el
--      primer caso documentado de esta clase de hallazgo). En ese
--      precedente, la causa se atribuyo a "un grant o un ALTER DEFAULT
--      PRIVILEGES configurado a nivel de rol/esquema directamente en
--      Neon, fuera del control de version". No existe acceso de base de
--      datos desde este entorno para confirmar EMPIRICAMENTE, contra
--      pg_default_acl, que existe hoy un ALTER DEFAULT PRIVILEGES
--      analogo para el esquema "public" -- por eso
--      src/infra/rf24/orquestarValidacionRamaTemporal.ts incorpora, en
--      esta misma ronda, un diagnostico de SOLO LECTURA y NUNCA
--      bloqueante contra pg_default_acl/aclexplode (ver
--      diagnosticarDefaultAclTablasNeondbOwner()) para que la PROXIMA
--      ejecucion real confirme o refute esto directamente. Lo que SI
--      esta confirmado, por auditoria literal de codigo (puntos 1 y 2
--      de arriba): el origen NO esta en ninguna migracion de RF24 ni en
--      ningun GRANT versionado de este repositorio.
--   4. Por instruccion explicita de Alex, esta migracion NO toca ningun
--      default privilege global (podrian ser intencionales para otras
--      tablas futuras de neondb_owner) -- se limita exactamente a
--      revocar, de forma puntual y versionada, los 8 privilegios
--      confirmados sobre estas 2 tablas especificas, sin tocar nada mas.
--
-- Efecto de esta migracion: tras aplicarse, chainpulse_app vuelve a
-- tener CERO privilegios directos sobre "solicitudes_derechos" y sobre
-- "intentos_solicitud_derechos_descartados" -- exactamente la intencion
-- original de 20261022090000_rf24_tabla_solicitud_derechos. El acceso
-- autorizado sigue disponible, sin cambios, a traves de las 11 funciones
-- publicas SECURITY DEFINER de 20261022100000_rf24_funciones_controladas
-- (que son owned por neondb_owner y conservan su propio GRANT EXECUTE a
-- chainpulse_app, no tocado aqui).
--
-- Se usa REVOKE explicito de los 4 privilegios exactos confirmados
-- (SELECT, INSERT, UPDATE, DELETE) en vez de "REVOKE ALL" -- Alex
-- autorizo esta forma explicita "si la auditoria confirma que esos son
-- exactamente los privilegios concedidos"; el hallazgo reportado los
-- confirma de forma literal, en ambas tablas, sin ningun otro privilegio
-- (TRUNCATE, REFERENCES, TRIGGER) presente.

BEGIN;

REVOKE SELECT, INSERT, UPDATE, DELETE
ON TABLE "solicitudes_derechos"
FROM chainpulse_app;

REVOKE SELECT, INSERT, UPDATE, DELETE
ON TABLE "intentos_solicitud_derechos_descartados"
FROM chainpulse_app;

COMMIT;
