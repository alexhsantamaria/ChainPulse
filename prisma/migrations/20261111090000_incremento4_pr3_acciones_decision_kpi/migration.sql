-- Incremento 4 PR3 (Alex, 2026-11-11) -- persistencia y seguimiento de
-- acciones de decision de KPI (AccionDecisionKpi). Ver el comentario de
-- cabecera del modelo en prisma/schema.prisma para el razonamiento
-- completo; esta migracion solo materializa ese diseno.
--
-- Escrita a mano porque `prisma migrate dev` no puede correr en el
-- entorno de Claude (bloqueo de red a binaries.prisma.sh, mismo motivo ya
-- documentado en 20260924040000_incremento4_kpis_bloque_b_cobertura y
-- otras migraciones de este incremento) -- pendiente de validar con
-- `prisma migrate dev` y `prisma validate` reales en Windows antes de
-- aplicarla a ninguna base real. NO EJECUTADA todavia (ni en Neon ni en
-- ningun otro entorno) -- Alex la revisa primero.
--
-- CREATE TYPE/CREATE TABLE puros: ninguna migracion de datos, no existen
-- filas previas en esta tabla (no existe todavia).

-- CreateEnum
CREATE TYPE "EstadoAccionKpi" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "PrioridadRecomendacionKpi" AS ENUM ('ALTA', 'MEDIA', 'BAJA');

-- CreateTable
CREATE TABLE "acciones_decision_kpi" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "observacionKpiId" TEXT,
    "importacionCsvId" TEXT,
    "ruleVersionOrigen" TEXT NOT NULL,
    "prioridadOrigen" "PrioridadRecomendacionKpi" NOT NULL,
    "descripcionAccion" TEXT NOT NULL,
    "responsableId" TEXT NOT NULL,
    "fechaObjetivo" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoAccionKpi" NOT NULL DEFAULT 'PENDIENTE',
    "creadaPorId" TEXT NOT NULL,
    "finalizadaEn" TIMESTAMP(3),
    "finalizadaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Solo fecha de auditoria (ver prisma/schema.prisma) -- ya NO es
    -- parte del control de concurrencia, correccion de ronda de
    -- revision (3ra vuelta): su precision de milisegundo dejaba una
    -- ventana de colision real que "version" (abajo) no tiene.
    "updatedAt" TIMESTAMP(3) NOT NULL,
    -- Control de concurrencia optimista -- reemplaza el intento
    -- anterior de usar "updatedAt" en el WHERE del UPDATE (ver el
    -- comentario de "version" en prisma/schema.prisma). Arranca en 1,
    -- se incrementa en 1 en cada actualizarAccionDecisionKpi() exitoso.
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "acciones_decision_kpi_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "acciones_decision_kpi" ADD CONSTRAINT "acciones_decision_kpi_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acciones_decision_kpi" ADD CONSTRAINT "acciones_decision_kpi_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acciones_decision_kpi" ADD CONSTRAINT "acciones_decision_kpi_observacionKpiId_fkey" FOREIGN KEY ("observacionKpiId") REFERENCES "observaciones_kpi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acciones_decision_kpi" ADD CONSTRAINT "acciones_decision_kpi_importacionCsvId_fkey" FOREIGN KEY ("importacionCsvId") REFERENCES "importaciones_csv"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acciones_decision_kpi" ADD CONSTRAINT "acciones_decision_kpi_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acciones_decision_kpi" ADD CONSTRAINT "acciones_decision_kpi_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acciones_decision_kpi" ADD CONSTRAINT "acciones_decision_kpi_finalizadaPorId_fkey" FOREIGN KEY ("finalizadaPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "acciones_decision_kpi_empresaId_idx" ON "acciones_decision_kpi"("empresaId");
CREATE INDEX "acciones_decision_kpi_cadenaId_estado_idx" ON "acciones_decision_kpi"("cadenaId", "estado");
CREATE INDEX "acciones_decision_kpi_responsableId_estado_idx" ON "acciones_decision_kpi"("responsableId", "estado");
CREATE INDEX "acciones_decision_kpi_observacionKpiId_idx" ON "acciones_decision_kpi"("observacionKpiId");
CREATE INDEX "acciones_decision_kpi_importacionCsvId_idx" ON "acciones_decision_kpi"("importacionCsvId");

-- CHECK -- exactamente UN origen (XOR), no representable en schema.prisma
-- (sin @@check multi-columna habilitado en esta version de Prisma, mismo
-- motivo que chk_importacion_csv_alcance_reemplazo de
-- 20260924040000_incremento4_kpis_bloque_b_cobertura). La validacion de
-- aplicacion (src/infra/kpis/acciones/validacion.ts) debe correr
-- SIEMPRE antes de cualquier create/update -- este CHECK es la segunda
-- capa, defensa en profundidad, nunca el unico mecanismo.
ALTER TABLE "acciones_decision_kpi"
  ADD CONSTRAINT "chk_accion_decision_kpi_un_origen"
  CHECK (
    ((("observacionKpiId" IS NOT NULL))::int + (("importacionCsvId" IS NOT NULL))::int) = 1
  );

-- CHECK -- consistencia estado/finalizadaEn/finalizadaPorId: ambos
-- presentes en estado terminal (COMPLETADA/DESCARTADA), ambos ausentes
-- en cualquier otro estado (PENDIENTE/EN_PROGRESO). Misma regla aplicada
-- en la capa de servicio antes de cualquier update de estado.
ALTER TABLE "acciones_decision_kpi"
  ADD CONSTRAINT "chk_accion_decision_kpi_finalizacion_consistente"
  CHECK (
    (
      "estado" IN ('COMPLETADA', 'DESCARTADA')
      AND "finalizadaEn" IS NOT NULL
      AND "finalizadaPorId" IS NOT NULL
    )
    OR (
      "estado" NOT IN ('COMPLETADA', 'DESCARTADA')
      AND "finalizadaEn" IS NULL
      AND "finalizadaPorId" IS NULL
    )
  );

-- RLS (docs/PATRONES.md Seccion 5, politica en la MISMA migracion que
-- crea la tabla -- mismo criterio que todas las migraciones de este
-- incremento). "acciones_decision_kpi" tiene empresaId propio:
-- comparacion directa, igual que observaciones_kpi/importaciones_csv/
-- observaciones_cobertura.
ALTER TABLE "acciones_decision_kpi" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_acciones_decision_kpi ON "acciones_decision_kpi"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- Grants -- mismo motivo que el bloque GRANT de todas las migraciones
-- anteriores de este incremento: sin este GRANT explicito, chainpulse_app
-- (el rol de runtime) no hereda privilegios sobre una tabla nueva y
-- cualquier consulta de la aplicacion contra ella falla con "permission
-- denied".
GRANT SELECT, INSERT, UPDATE, DELETE ON "acciones_decision_kpi" TO chainpulse_app;
