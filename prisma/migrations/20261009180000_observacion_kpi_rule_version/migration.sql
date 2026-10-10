-- Incremento 4 Bloque B, piloto OTIF (Alex, 2026-10-09).
--
-- Agrega ruleVersion obligatorio a observaciones_kpi (motor:
-- src/engine/kpis/constantes.ts, RULE_VERSION_KPIS). Verificacion de solo
-- lectura en produccion, 2026-10-09, conexion directa, rol neondb_owner,
-- transaccion READ ONLY, cobertura RLS demostrada (propietario
-- neondb_owner, relrowsecurity=true, relforcerowsecurity=false,
-- rolbypassrls=true -- el conteo cubre la tabla completa, RLS no puede
-- ocultar filas), cierre con ROLLBACK:
--
--   total de filas en public.observaciones_kpi: 0
--
-- Con la tabla vacia, Postgres valida NOT NULL contra un conjunto vacio:
-- no hace falta DEFAULT transitorio ni backfill. Si esta migracion
-- llegara a fallar por "column contains null values" seria evidencia de
-- que la tabla dejo de estar vacia entre la verificacion y este deploy --
-- en ese caso, DETENER y volver a verificar antes de reintentar; nunca
-- completar la columna por inferencia.
ALTER TABLE "observaciones_kpi"
  ADD COLUMN "ruleVersion" TEXT NOT NULL;
