-- ChainPulse — politicas Row-Level Security (RNF1, segunda capa de
-- aislamiento multi-tenant, ADR-0001 "Mitigacion de riesgo de aislamiento").
--
-- COMO SE APLICA: Prisma Migrate no expresa RLS en schema.prisma, asi que
-- este archivo es SQL a mano. Flujo: 1) `npm run prisma:migrate` crea las
-- tablas a partir de schema.prisma; 2) se aplica este archivo contra la
-- misma base (psql -f prisma/rls.sql, o pegandolo como una migracion mas
-- con `prisma migrate dev --create-only` y copiando este contenido dentro).
-- No se pudo ejecutar contra una base real desde este entorno (sin acceso
-- a un Postgres), asi que esta capa queda escrita y lista pero SIN
-- verificar en vivo — el criterio de "listo" del Incremento 1 (ADR-0002)
-- exige correrla con datos reales antes de dar el MVP por validado.
--
-- Regla de aplicacion: el rol de la app (chainpulse_app en .env.example)
-- NUNCA debe tener el atributo BYPASSRLS ni ser superusuario — si lo es,
-- estas politicas se ignoran silenciosamente.

-- Cada conexion de la app fija esta variable de sesion antes de consultar
-- (ver src/infra/prisma/tenantClient.ts). Sin ella, current_setting()
-- devuelve NULL y ninguna fila coincide — falla cerrado, no abierto.

ALTER TABLE "empresas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eslabones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conexiones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ciclos_pulso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "respuestas_crudas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resultados_conexion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resultados_ciclo" ENABLE ROW LEVEL SECURITY;
-- RNF9 (instrumentacion minima, agregado 2026-09-14): mismas dos tablas
-- sin empresaId propio, mismo patron de subconsulta que las de arriba.
ALTER TABLE "metricas_cuestionario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recomendaciones_ejecutadas" ENABLE ROW LEVEL SECURITY;

-- Tablas con empresaId propio: comparan directo contra la variable de sesion.
CREATE POLICY tenant_isolation_empresas ON "empresas"
  USING (id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_usuarios ON "usuarios"
  USING ("empresaId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_eslabones ON "eslabones"
  USING ("empresaId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_conexiones ON "conexiones"
  USING ("empresaId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_ciclos_pulso ON "ciclos_pulso"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- Tablas sin empresaId propio: se filtran por join implicito contra su
-- padre tenant-scoped, via subconsulta (RespuestaCruda -> Conexion,
-- ResultadoConexion -> Conexion, ResultadoCiclo -> CicloPulso).
CREATE POLICY tenant_isolation_respuestas_crudas ON "respuestas_crudas"
  USING (
    "conexionId" IN (
      SELECT id FROM "conexiones"
      WHERE "empresaId" = current_setting('app.tenant_id', true)
    )
  );

CREATE POLICY tenant_isolation_resultados_conexion ON "resultados_conexion"
  USING (
    "conexionId" IN (
      SELECT id FROM "conexiones"
      WHERE "empresaId" = current_setting('app.tenant_id', true)
    )
  );

CREATE POLICY tenant_isolation_resultados_ciclo ON "resultados_ciclo"
  USING (
    "cicloPulsoId" IN (
      SELECT id FROM "ciclos_pulso"
      WHERE "empresaId" = current_setting('app.tenant_id', true)
    )
  );

-- RNF9 (agregado 2026-09-14): mismas dos tablas hijas sin empresaId
-- propio, mismo patron de subconsulta via CicloPulso que ya usan
-- RespuestaCruda/ResultadoConexion/ResultadoCiclo arriba.
CREATE POLICY tenant_isolation_metricas_cuestionario ON "metricas_cuestionario"
  USING (
    "cicloPulsoId" IN (
      SELECT id FROM "ciclos_pulso"
      WHERE "empresaId" = current_setting('app.tenant_id', true)
    )
  );

CREATE POLICY tenant_isolation_recomendaciones_ejecutadas ON "recomendaciones_ejecutadas"
  USING (
    "cicloPulsoId" IN (
      SELECT id FROM "ciclos_pulso"
      WHERE "empresaId" = current_setting('app.tenant_id', true)
    )
  );

-- EvaluacionExpres y sus hijas NO tienen politica de tenant (adenda de
-- ADR-0001): son el caso explicito de tenant nulo, accesibles sin sesion
-- de empresa. Se protegen en cambio por RF15/RF17 (rate limiting) y por
-- no compartir tablas con los datos de cuentas registradas (RNF7) — nunca
-- deben llevar empresaId ni entrar en las politicas de arriba.

-- Bloque A del Incremento 2 (PLAN-DE-TRABAJO.md Seccion 18.1.C): "limite_tasa"
-- es el mismo caso de tenant nulo explicito de arriba — protege el propio
-- flujo anonimo (RF15/RF17), asi que no tiene sentido aislarla por tenant.
-- Nunca debe llevar empresaId ni politica de tenant.

-- Incremento 2 del Bloque de evaluacion expres V2 (PLAN-DE-TRABAJO.md
-- Seccion 18.2.B/18.2.C, migracion
-- 20260916150000_incremento2_evaluacion_expres_v2): mismo caso de tenant
-- nulo explicito de arriba. NUNCA agregar empresaId ni politica RLS a:
--   "usuarios_plataforma", "cuestionario_versiones", "pregunta_versiones",
--   "evaluaciones_expres_v2", "respuestas", "consentimientos_expres",
--   "hallazgos_expres", "hallazgos_expres_traza"
-- Se protegen por RF25 (rate limiting), por cascada desde
-- evaluaciones_expres_v2, y por no compartir tabla con datos de cuentas
-- registradas (RNF7).
--
-- "consentimientos_cuenta" es la EXCEPCION de este bloque: SI tiene
-- empresaId propio y SI lleva politica RLS (misma que
-- tenant_isolation_conexiones de arriba) — ya aplicada en la propia
-- migracion 20260916150000_incremento2_evaluacion_expres_v2, no aqui,
-- porque esta era la primera tabla tenant-scoped nueva desde el
-- Incremento 1 y su politica va versionada junto con su CREATE TABLE
-- (regla de docs/PATRONES.md).
