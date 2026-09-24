-- Bloque C (RF36-39, PLAN-DE-TRABAJO.md "Bloque C") -- respuesta
-- individual de un invitado sin cuenta propia a las 6 dimensiones de
-- comparacion multi-rol. Decision explicita de Alex (2026-09-24): el
-- invitado responde via link (mismo mecanismo stateless de RF4), sin
-- crear Usuario -- ver el comentario de cabecera de RespuestaCadena en
-- schema.prisma y de invitacionCadena.ts. CREATE TYPE/CREATE TABLE puros:
-- ninguna migracion de datos, no existen filas previas.

-- CreateEnum
CREATE TYPE "PromesaPrincipalCadena" AS ENUM ('DISPONIBILIDAD', 'RAPIDEZ', 'CUMPLIMIENTO_FECHA_CANTIDAD', 'CALIDAD_CONSISTENCIA', 'PRECIO_EFICIENCIA', 'PERSONALIZACION', 'CONTINUIDAD_INTERRUPCIONES', 'NO_DEFINIDA');

-- CreateEnum
CREATE TYPE "ConocimientoEntradaSalida" AS ENUM ('DEFINIDO_Y_USADO', 'CLARO_PARA_ALGUNAS_AREAS', 'DEPENDE_DE_PERSONAS', 'NO_CLARO', 'NO_SABE');

-- CreateEnum
CREATE TYPE "FuenteDatosCadena" AS ENUM ('SAP_ERP', 'EXCEL', 'WMS_TMS_APS', 'CORREO_MENSAJERIA', 'VARIOS_SISTEMAS', 'SIN_FUENTE_DEFINIDA');

-- CreateTable
CREATE TABLE "respuestas_cadena" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "conexionCadenaId" TEXT,
    "email" TEXT NOT NULL,
    "prioridadElegida" "PromesaPrincipalCadena",
    "nodoCriticoId" TEXT,
    "conocimientoEntradasSalidas" "ConocimientoEntradaSalida",
    "momentoInformacion" "DuracionCategorica",
    "fuenteDatos" "FuenteDatosCadena",
    "tieneAlternativa" BOOLEAN,
    "alternativaProbada" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respuestas_cadena_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "respuestas_cadena" ADD CONSTRAINT "respuestas_cadena_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respuestas_cadena" ADD CONSTRAINT "respuestas_cadena_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respuestas_cadena" ADD CONSTRAINT "respuestas_cadena_conexionCadenaId_fkey" FOREIGN KEY ("conexionCadenaId") REFERENCES "conexiones_cadena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL, no CASCADE: si el Nodo elegido como critico se borra, la
-- respuesta sobrevive (es un registro de percepcion de un invitado, no un
-- dato derivado descartable -- mismo criterio que
-- hallazgos_cadena_conexionCadenaId_fkey en la migracion anterior).
ALTER TABLE "respuestas_cadena" ADD CONSTRAINT "respuestas_cadena_nodoCriticoId_fkey" FOREIGN KEY ("nodoCriticoId") REFERENCES "nodos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "respuestas_cadena_empresaId_idx" ON "respuestas_cadena"("empresaId");

-- CreateIndex
CREATE INDEX "respuestas_cadena_cadenaId_idx" ON "respuestas_cadena"("cadenaId");

-- CreateIndex
CREATE INDEX "respuestas_cadena_conexionCadenaId_idx" ON "respuestas_cadena"("conexionCadenaId");

-- Identidad real "un invitado responde una sola vez por cadena/conexion,
-- reabrir el link actualiza en vez de duplicar" (RF36) -- dos indices
-- UNICOS PARCIALES en vez de un solo @@unique de Prisma, porque
-- conexionCadenaId es nullable y Postgres trata cada NULL como distinto
-- en una unique constraint normal (dos invitaciones a la Cadena completa
-- con el mismo email no chocarian). Mismo patron ya usado por
-- 20260916160000_ciclo_abierto_unico -- no representable en schema.prisma,
-- ver el comentario en RespuestaCadena que remite aca; no los borres en un
-- futuro `prisma migrate dev` por "drift".
CREATE UNIQUE INDEX "respuestas_cadena_cadena_email_key"
  ON "respuestas_cadena" ("cadenaId", "email")
  WHERE "conexionCadenaId" IS NULL;

CREATE UNIQUE INDEX "respuestas_cadena_conexion_email_key"
  ON "respuestas_cadena" ("conexionCadenaId", "email")
  WHERE "conexionCadenaId" IS NOT NULL;

-- RLS (docs/PATRONES.md Seccion 5, con la desviacion ya establecida por
-- 20260920040000_incremento3_mapa_bloque_a de escribir la politica en la
-- MISMA migracion que crea la tabla en vez de en prisma/rls.sql -- mismo
-- criterio, no se repite la discusion aqui). "respuestas_cadena" tiene
-- empresaId propio: comparacion directa, igual que cadenas/nodos/
-- conexiones_cadena/hallazgos_cadena.
ALTER TABLE "respuestas_cadena" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_respuestas_cadena ON "respuestas_cadena"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- Grants -- mismo motivo que el bloque GRANT de
-- 20260920040000_incremento3_mapa_bloque_a (R5-16): sin este GRANT
-- explicito, chainpulse_app (el rol de runtime) no hereda privilegios
-- sobre esta tabla nueva y cualquier consulta de la aplicacion contra
-- ella falla con "permission denied".
GRANT SELECT, INSERT, UPDATE, DELETE ON "respuestas_cadena" TO chainpulse_app;
