-- Incremento 4 Bloque B (preparacion de schema, sin R2 ni importador
-- todavia) -- ImportacionCsv (generica por KPI, hoy solo la usa
-- Cobertura) + ObservacionCobertura (una fila por SKU+ubicacion+fecha de
-- corte, ver PLAN-DE-TRABAJO.md para el razonamiento completo de las 3
-- claves de idempotencia y los 4 casos de correccion con ejemplos).
-- CONFIRMADO por Alex el 2026-09-24, incluyendo dos precisiones sobre la
-- propuesta original: normalizacion de SKU/ubicacion preserva espacios
-- internos (solo mayusculas + trim de extremos, con el valor original
-- guardado aparte) y el alcance de una correccion exige ubicaciones
-- incluidas ademas del rango de fechas, nunca un rango de fechas solo.
-- CREATE TYPE/CREATE TABLE puros: ninguna migracion de datos, no existen
-- filas previas. Escrita a mano porque `prisma migrate dev` no puede
-- correr en el entorno de Claude (bloqueo de red a binaries.prisma.sh,
-- ver README.md) -- pendiente de validar con `prisma migrate dev` y
-- `prisma validate` reales en Windows antes de darla por cerrada.

-- CreateEnum
CREATE TYPE "EstadoImportacion" AS ENUM ('PENDIENTE_REVISION', 'CONFIRMADA', 'DESCARTADA', 'ERROR');

-- CreateEnum
CREATE TYPE "EstrategiaImportacionCsv" AS ENUM ('CARGA_PARCIAL', 'REEMPLAZO_ALCANCE');

-- CreateEnum
CREATE TYPE "EstadoObservacionCobertura" AS ENUM ('CALCULADA', 'SIN_CONSUMO_REFERENCIA', 'DATOS_INCOMPLETOS', 'VALOR_NEGATIVO', 'UNIDADES_INCOMPATIBLES');

-- CreateTable
CREATE TABLE "importaciones_csv" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "definicionKpiId" TEXT NOT NULL,
    "objetoStorageKey" TEXT NOT NULL,
    "mapeoColumnas" JSONB,
    "filasDetectadas" INTEGER NOT NULL DEFAULT 0,
    "filasConError" INTEGER NOT NULL DEFAULT 0,
    "erroresMuestra" JSONB,
    "estado" "EstadoImportacion" NOT NULL DEFAULT 'PENDIENTE_REVISION',
    "estrategia" "EstrategiaImportacionCsv" NOT NULL DEFAULT 'CARGA_PARCIAL',
    "alcanceFechaCorteInicio" DATE,
    "alcanceFechaCorteFin" DATE,
    "alcanceUbicaciones" JSONB,
    "confirmadaPorId" TEXT,
    "confirmadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "importaciones_csv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observaciones_cobertura" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "definicionKpiId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "skuOriginal" TEXT NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "ubicacionOriginal" TEXT NOT NULL,
    "fechaCorte" DATE NOT NULL,
    "zonaHorariaReferencia" TEXT NOT NULL,
    "inventarioDisponible" DOUBLE PRECISION,
    "unidadInventario" TEXT NOT NULL,
    "consumoDiarioEsperado" DOUBLE PRECISION,
    "unidadConsumoDiario" TEXT NOT NULL,
    "fuenteConsumo" TEXT NOT NULL,
    "periodoReferenciaConsumoInicio" DATE,
    "periodoReferenciaConsumoFin" DATE,
    "coberturaDias" DOUBLE PRECISION,
    "estado" "EstadoObservacionCobertura" NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "fuente" TEXT NOT NULL,
    "importId" TEXT,
    "numeroFila" INTEGER,
    "contenidoHash" TEXT NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "reemplazadaPorId" TEXT,
    "reemplazadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observaciones_cobertura_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey (importaciones_csv)
ALTER TABLE "importaciones_csv" ADD CONSTRAINT "importaciones_csv_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "importaciones_csv" ADD CONSTRAINT "importaciones_csv_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "importaciones_csv" ADD CONSTRAINT "importaciones_csv_definicionKpiId_fkey" FOREIGN KEY ("definicionKpiId") REFERENCES "definicion_kpis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importaciones_csv" ADD CONSTRAINT "importaciones_csv_confirmadaPorId_fkey" FOREIGN KEY ("confirmadaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (observaciones_cobertura)
ALTER TABLE "observaciones_cobertura" ADD CONSTRAINT "observaciones_cobertura_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "observaciones_cobertura" ADD CONSTRAINT "observaciones_cobertura_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "observaciones_cobertura" ADD CONSTRAINT "observaciones_cobertura_definicionKpiId_fkey" FOREIGN KEY ("definicionKpiId") REFERENCES "definicion_kpis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "observaciones_cobertura" ADD CONSTRAINT "observaciones_cobertura_importId_fkey" FOREIGN KEY ("importId") REFERENCES "importaciones_csv"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Auto-referencia (correccion con historial, ver PLAN-DE-TRABAJO.md) --
-- ON DELETE RESTRICT a proposito: no se puede borrar una fila que es "el
-- reemplazo" de otra mientras esa otra siga apuntandole (preserva la
-- cadena de historial en vez de romperla en silencio con un SET NULL).
ALTER TABLE "observaciones_cobertura" ADD CONSTRAINT "observaciones_cobertura_reemplazadaPorId_fkey" FOREIGN KEY ("reemplazadaPorId") REFERENCES "observaciones_cobertura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (importaciones_csv)
CREATE INDEX "importaciones_csv_empresaId_idx" ON "importaciones_csv"("empresaId");
CREATE INDEX "importaciones_csv_cadenaId_idx" ON "importaciones_csv"("cadenaId");
CREATE INDEX "importaciones_csv_definicionKpiId_idx" ON "importaciones_csv"("definicionKpiId");

-- CreateIndex (observaciones_cobertura)
CREATE INDEX "observaciones_cobertura_empresaId_idx" ON "observaciones_cobertura"("empresaId");
CREATE INDEX "observaciones_cobertura_cadenaId_idx" ON "observaciones_cobertura"("cadenaId");
CREATE INDEX "observaciones_cobertura_definicionKpiId_idx" ON "observaciones_cobertura"("definicionKpiId");
CREATE INDEX "observaciones_cobertura_importId_idx" ON "observaciones_cobertura"("importId");
-- Consulta real: "dame la cobertura vigente de este SKU/ubicacion/fecha".
-- Nombre explicito (`map` en schema.prisma) -- el auto-generado por
-- Prisma para esta combinacion de columnas mide 76 caracteres, supera el
-- limite de 63 de Postgres y se truncaria de un modo que no podemos
-- verificar sin el engine de Prisma (bloqueado en el Mac) -- mismo riesgo
-- que ya causo el problema real de "uq_..._pe_key" con curadorId en
-- 20260924020000_incremento4_kpis_bloque_a. Nombrarlo a mano en ambos
-- lados evita el drift por completo, en vez de confiar en adivinar el
-- truncamiento de Prisma.
CREATE INDEX "idx_observaciones_cobertura_vigente_lookup" ON "observaciones_cobertura"("cadenaId", "sku", "ubicacion", "fechaCorte", "fuente", "vigente");

-- reemplazadaPorId es 1:1 (una fila nueva reemplaza a lo sumo una fila
-- vieja) -- @unique de schema.prisma.
CREATE UNIQUE INDEX "observaciones_cobertura_reemplazadaPorId_key" ON "observaciones_cobertura"("reemplazadaPorId");

-- Los DOS indices unicos parciales de idempotencia (PLAN-DE-TRABAJO.md,
-- Incremento 4 Bloque B) -- NO representables como un solo @@unique de
-- Prisma: Postgres trata cada NULL como distinto, asi que un unico
-- indice sobre (cadenaId, sku, ubicacion, fechaCorte, fuente, importId,
-- numeroFila) NO impediria que dos filas manuales (importId/numeroFila
-- ambos NULL) del mismo SKU+ubicacion+fecha se duplicaran -- exactamente
-- el mismo problema que ya resolvio "dos @@unique distintos" para
-- ObservacionKpi (H4, Seccion 18.3.F) para manual/pegado vs. CSV. Mismo
-- patron que uq_definicion_kpi_publicada -- no los borres en un futuro
-- `prisma migrate dev` por "drift".
--
-- 1) Manual/pegado: evita reingresar por error la misma observacion
-- (misma clave de negocio) sin pasar por una importacion. Si dos filas
-- del mismo archivo/formulario normalizan a la misma clave pero traen
-- datos distintos, este indice hace que la segunda insercion choque -- el
-- importador debe reportarlo como duplicado, nunca resolverlo en
-- silencio (Alex, 2026-09-24).
CREATE UNIQUE INDEX "uq_observacion_cobertura_manual_pegado" ON "observaciones_cobertura"("cadenaId", "sku", "ubicacion", "fechaCorte", "fuente") WHERE "importId" IS NULL;

-- 2) CSV: retry-safety de un intento de importacion especifico -- el
-- mismo importId+numeroFila reintentado no duplica (INSERT ... ON
-- CONFLICT DO NOTHING, despues SELECT).
CREATE UNIQUE INDEX "uq_observacion_cobertura_intento_csv" ON "observaciones_cobertura"("cadenaId", "importId", "numeroFila") WHERE "importId" IS NOT NULL;

-- CHECK -- no representable en schema.prisma con la version de Prisma de
-- este proyecto (sin @@check habilitado) -- vive solo aca, igual que los
-- indices unicos parciales de arriba. Un rango de fechas por si solo
-- NUNCA autoriza a retirar nada (Alex, 2026-09-24): si estrategia es
-- REEMPLAZO_ALCANCE, el rango de fechas Y la lista de ubicaciones son
-- obligatorios los tres.
ALTER TABLE "importaciones_csv" ADD CONSTRAINT "chk_importacion_csv_alcance_reemplazo" CHECK (
  "estrategia" <> 'REEMPLAZO_ALCANCE'
  OR (
    "alcanceFechaCorteInicio" IS NOT NULL
    AND "alcanceFechaCorteFin" IS NOT NULL
    AND "alcanceUbicaciones" IS NOT NULL
  )
);

-- RLS (docs/PATRONES.md Seccion 5, politica en la misma migracion que
-- crea la tabla, mismo criterio que 20260924020000_incremento4_kpis_bloque_a
-- y las demas migraciones de este incremento) -- ambas tablas tienen
-- empresaId propio: comparacion directa.
ALTER TABLE "importaciones_csv" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_importaciones_csv ON "importaciones_csv"
  USING ("empresaId" = current_setting('app.tenant_id', true));

ALTER TABLE "observaciones_cobertura" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_observaciones_cobertura ON "observaciones_cobertura"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- Grants -- mismo motivo que el bloque GRANT de 20260924020000_incremento4_kpis_bloque_a
-- y las migraciones anteriores: sin este GRANT explicito, chainpulse_app
-- (el rol de runtime) no hereda privilegios sobre una tabla nueva.
GRANT SELECT, INSERT, UPDATE, DELETE ON "importaciones_csv", "observaciones_cobertura" TO chainpulse_app;
