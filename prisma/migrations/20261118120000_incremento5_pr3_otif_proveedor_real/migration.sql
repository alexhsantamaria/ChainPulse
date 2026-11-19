-- Incremento 5 PR3 -- OTIF Proveedor real (I5-02). Tabla DEDICADA para la
-- observacion de OTIF por proveedor, nunca una extension de
-- observaciones_kpi (ver el comentario de cabecera del modelo
-- ObservacionOtifProveedor en schema.prisma para el razonamiento
-- completo sobre por que no se reutiliza esa tabla ni su restriccion
-- unica). CREATE TABLE puro: cero filas previas, ninguna migracion de
-- datos.

-- CreateTable
CREATE TABLE "observaciones_otif_proveedor" (
    "id"                  TEXT NOT NULL,
    "empresaId"           TEXT NOT NULL,
    "cadenaId"            TEXT NOT NULL,
    "definicionKpiId"     TEXT NOT NULL,
    "periodoInicio"       TIMESTAMP(3) NOT NULL,
    "periodoFin"          TIMESTAMP(3) NOT NULL,
    "proveedorAlias"      TEXT NOT NULL,
    "proveedorAliasClave" TEXT NOT NULL,
    "valor"               DOUBLE PRECISION,
    "numerador"           DOUBLE PRECISION,
    "denominador"         DOUBLE PRECISION,
    "fuente"              TEXT NOT NULL,
    "estado"              "EstadoDato" NOT NULL DEFAULT 'DECLARADO',
    "ruleVersion"         TEXT NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observaciones_otif_proveedor_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "observaciones_otif_proveedor" ADD CONSTRAINT "observaciones_otif_proveedor_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "observaciones_otif_proveedor" ADD CONSTRAINT "observaciones_otif_proveedor_cadenaId_fkey"
  FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "observaciones_otif_proveedor" ADD CONSTRAINT "observaciones_otif_proveedor_definicionKpiId_fkey"
  FOREIGN KEY ("definicionKpiId") REFERENCES "definicion_kpis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "observaciones_otif_proveedor_empresaId_idx" ON "observaciones_otif_proveedor"("empresaId");
CREATE INDEX "observaciones_otif_proveedor_cadenaId_idx" ON "observaciones_otif_proveedor"("cadenaId");
CREATE INDEX "observaciones_otif_proveedor_definicionKpiId_idx" ON "observaciones_otif_proveedor"("definicionKpiId");

-- Identidad SIN `fuente` (Alex, 2026-11-18, correccion obligatoria sobre
-- el diseno original): reconfirmar el mismo proveedor+periodo desde otra
-- fuente actualiza la MISMA fila (ver confirmarObservacionOtifProveedor(),
-- persistir.ts) -- nunca crea una segunda. proveedorAliasClave (no
-- proveedorAlias) es la columna de identidad: ya normalizada (trim +
-- colapso de espacios + case folding estable), asi que "Proveedor A" y
-- "proveedor   a" resuelven a la MISMA fila.
CREATE UNIQUE INDEX "observaciones_otif_proveedor_cadenaId_definicionKpiId_peri_key"
  ON "observaciones_otif_proveedor"("cadenaId", "definicionKpiId", "periodoInicio", "periodoFin", "proveedorAliasClave");

-- CHECK -- backstop de base de datos (Alex, 2026-11-18, punto 7). No
-- representables en schema.prisma, mismo criterio que
-- uq_definicion_kpi_publicada (20260924020000_incremento4_kpis_bloque_a)
-- -- no los borres en un futuro `prisma migrate dev` por "drift".
ALTER TABLE "observaciones_otif_proveedor"
  ADD CONSTRAINT "chk_otif_proveedor_periodo_valido"
  CHECK ("periodoInicio" <= "periodoFin");

ALTER TABLE "observaciones_otif_proveedor"
  ADD CONSTRAINT "chk_otif_proveedor_numerador_no_negativo"
  CHECK ("numerador" IS NULL OR "numerador" >= 0);

-- denominador nunca negativo NI CERO: calcularRatio() (src/engine/kpis/
-- compartido.ts) jamas persiste un denominador literal 0 -- devuelve NULL
-- en cuanto no hay ninguna fila evaluable con contribucion positiva. Un
-- 0 real en esta columna seria un dato corrupto, no un caso de negocio
-- valido (esto cubre a la vez "no negativo" y "coherencia para
-- denominador cero" del punto 7 de Alex).
ALTER TABLE "observaciones_otif_proveedor"
  ADD CONSTRAINT "chk_otif_proveedor_denominador_coherente"
  CHECK ("denominador" IS NULL OR "denominador" > 0);

ALTER TABLE "observaciones_otif_proveedor"
  ADD CONSTRAINT "chk_otif_proveedor_numerador_no_mayor_que_denominador"
  CHECK ("numerador" IS NULL OR "denominador" IS NULL OR "numerador" <= "denominador");

ALTER TABLE "observaciones_otif_proveedor"
  ADD CONSTRAINT "chk_otif_proveedor_valor_rango"
  CHECK ("valor" IS NULL OR ("valor" >= 0 AND "valor" <= 1));

-- RLS (docs/PATRONES.md Seccion 5 -- politica en la MISMA migracion que
-- crea la tabla, mismo criterio que observaciones_kpi y toda tabla
-- tenant-scoped nueva de este repositorio). "observaciones_otif_proveedor"
-- tiene empresaId propio: comparacion directa.
ALTER TABLE "observaciones_otif_proveedor" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_observaciones_otif_proveedor ON "observaciones_otif_proveedor"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- Grants -- mismo motivo que toda tabla nueva (sin esto, chainpulse_app
-- -- el rol de runtime -- no hereda privilegios y cualquier consulta de
-- la aplicacion contra ella falla con "permission denied").
GRANT SELECT, INSERT, UPDATE, DELETE ON "observaciones_otif_proveedor" TO chainpulse_app;
