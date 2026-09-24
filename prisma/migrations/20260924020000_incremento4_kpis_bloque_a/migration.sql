-- Incremento 4 Bloque A (RF-KPI, MVP-DEFINITIVO Seccion 6.3/Especificacion
-- V2 Seccion 11.1) -- catalogo de plataforma de los 10 KPIs iniciales
-- (DefinicionKpi, sin empresaId, sin RLS -- mismo regimen que
-- cuestionario_versiones) + la observacion tenant-scoped que lo
-- referencia (ObservacionKpi, con RLS). CREATE TYPE/CREATE TABLE puros:
-- ninguna migracion de datos, no existen filas previas. Ver el comentario
-- de cabecera de ambos modelos en schema.prisma para el razonamiento
-- completo.

-- CreateTable
CREATE TABLE "definicion_kpis" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" "EstadoVersionContenido" NOT NULL DEFAULT 'BORRADOR',
    "publicadaEn" TIMESTAMP(3),
    "retiradaEn" TIMESTAMP(3),
    "curadorId" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "periodoDefecto" TEXT NOT NULL,
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Lima',
    "reglasExclusion" JSONB,
    "notasCambio" TEXT,

    CONSTRAINT "definicion_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observaciones_kpi" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "definicionKpiId" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFin" TIMESTAMP(3) NOT NULL,
    "valor" DOUBLE PRECISION,
    "numerador" DOUBLE PRECISION,
    "denominador" DOUBLE PRECISION,
    "fuente" TEXT NOT NULL,
    "estado" "EstadoDato" NOT NULL DEFAULT 'DECLARADO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observaciones_kpi_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "definicion_kpis" ADD CONSTRAINT "definicion_kpis_curadorId_fkey" FOREIGN KEY ("curadorId") REFERENCES "usuarios_plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observaciones_kpi" ADD CONSTRAINT "observaciones_kpi_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observaciones_kpi" ADD CONSTRAINT "observaciones_kpi_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observaciones_kpi" ADD CONSTRAINT "observaciones_kpi_definicionKpiId_fkey" FOREIGN KEY ("definicionKpiId") REFERENCES "definicion_kpis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "definicion_kpis_curadorId_idx" ON "definicion_kpis"("curadorId");

-- CreateIndex
CREATE UNIQUE INDEX "definicion_kpis_codigo_numero_key" ON "definicion_kpis"("codigo", "numero");

-- CreateIndex
CREATE INDEX "observaciones_kpi_empresaId_idx" ON "observaciones_kpi"("empresaId");

-- CreateIndex
CREATE INDEX "observaciones_kpi_cadenaId_idx" ON "observaciones_kpi"("cadenaId");

-- CreateIndex
CREATE INDEX "observaciones_kpi_definicionKpiId_idx" ON "observaciones_kpi"("definicionKpiId");

-- CreateIndex
CREATE UNIQUE INDEX "observaciones_kpi_cadenaId_definicionKpiId_periodoInicio_p_key" ON "observaciones_kpi"("cadenaId", "definicionKpiId", "periodoInicio", "periodoFin", "fuente");

-- RF20/Seccion 18.3.A (compartido con CuestionarioVersion, ver el
-- comentario de cabecera de DefinicionKpi en schema.prisma) -- backstop de
-- base de datos: una version PUBLICADA nunca convive con otra PUBLICADA
-- del mismo codigo, incluso si el modulo de escritura fallara en
-- validarlo. Indice unico PARCIAL, no representable en schema.prisma
-- (mismo patron que uq_cuestionario_version_publicada de
-- 20260916150000_incremento2_evaluacion_expres_v2) -- no lo borres en un
-- futuro `prisma migrate dev` por "drift".
CREATE UNIQUE INDEX "uq_definicion_kpi_publicada" ON "definicion_kpis"("codigo") WHERE "estado" = 'PUBLICADA';

-- RLS (docs/PATRONES.md Seccion 5, con la desviacion ya establecida de
-- escribir la politica en la MISMA migracion que crea la tabla en vez de
-- en prisma/rls.sql -- mismo criterio que 20260924000000_respuesta_cadena,
-- no se repite la discusion aqui). "observaciones_kpi" tiene empresaId
-- propio: comparacion directa, igual que cadenas/nodos/conexiones_cadena/
-- hallazgos_cadena/respuestas_cadena.
--
-- "definicion_kpis" NO lleva RLS: es catalogo de plataforma sin
-- empresaId, mismo regimen de tenant nulo que cuestionario_versiones/
-- usuarios_plataforma (Seccion 18.2.B) -- nunca entra en
-- TENANT_SCOPED_MODELS ni aca.
ALTER TABLE "observaciones_kpi" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_observaciones_kpi ON "observaciones_kpi"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- Grants -- mismo motivo que el bloque GRANT de 20260916170000_grants_incremento2
-- (R5-16) y 20260924000000_respuesta_cadena: sin este GRANT explicito,
-- chainpulse_app (el rol de runtime) no hereda privilegios sobre una
-- tabla nueva y cualquier consulta de la aplicacion contra ella falla con
-- "permission denied". "definicion_kpis" tambien lo necesita pese a no
-- tener RLS -- mismo criterio que cuestionario_versiones/
-- usuarios_plataforma en esa misma migracion de grants (catalogo de
-- plataforma, pero igual leido/escrito por chainpulse_app en runtime).
GRANT SELECT, INSERT, UPDATE, DELETE ON "definicion_kpis", "observaciones_kpi" TO chainpulse_app;
