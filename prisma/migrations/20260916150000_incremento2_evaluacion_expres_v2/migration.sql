-- Incremento 2 — Evaluacion expres V2 (requirements.md Seccion 13, RF19-RF26;
-- PLAN-DE-TRABAJO.md Seccion 18). CREATE TYPE/CREATE TABLE puros: ninguna
-- sentencia de esta migracion toca una tabla del Incremento 1 (Bloque A
-- incluido). Aplicar con `prisma migrate deploy` en Windows (Task #78),
-- mismo flujo ya usado para 20260916140000_limite_tasa.

-- CreateEnum
CREATE TYPE "RolUsuarioPlataforma" AS ENUM ('CURADOR_METODOLOGICO', 'ADMINISTRADOR_PLATAFORMA');

-- CreateEnum
CREATE TYPE "EstadoVersionContenido" AS ENUM ('BORRADOR', 'PUBLICADA', 'RETIRADA');

-- CreateEnum
CREATE TYPE "DimensionDiagnosticoV2" AS ENUM ('ALINEACION', 'COORDINACION', 'INTEGRACION', 'EVIDENCIA', 'RESILIENCIA');

-- CreateEnum
CREATE TYPE "EstadoEvidencia" AS ENUM ('DECLARADO', 'CONFIRMADO_POR_OTROS', 'VERIFICADO_CON_DATOS');

-- CreateEnum
CREATE TYPE "FinalidadConsentimiento" AS ENUM ('DIAGNOSTICO', 'INVESTIGACION', 'ESTADISTICAS_COMERCIALES', 'CONTACTO_COMERCIAL');

-- CreateEnum
CREATE TYPE "MetodoRetiro" AS ENUM ('NINGUNO', 'FORMULARIO_PUBLICO', 'SOLICITUD_SOPORTE');

-- CreateTable
CREATE TABLE "usuarios_plataforma" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaSecret" TEXT,
    "mfaHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "rol" "RolUsuarioPlataforma" NOT NULL,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuestionario_versiones" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" "EstadoVersionContenido" NOT NULL DEFAULT 'BORRADOR',
    "publicadaEn" TIMESTAMP(3),
    "retiradaEn" TIMESTAMP(3),
    "curadorId" TEXT,
    "notasCambio" TEXT,

    CONSTRAINT "cuestionario_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregunta_versiones" (
    "id" TEXT NOT NULL,
    "cuestionarioVersionId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "dimension" "DimensionDiagnosticoV2" NOT NULL,
    "opciones" JSONB NOT NULL,
    "esNoPuntuable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pregunta_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluaciones_expres_v2" (
    "id" TEXT NOT NULL,
    "cuestionarioVersionId" TEXT NOT NULL,
    "pais" TEXT NOT NULL DEFAULT 'PE',
    "region" TEXT,
    "sector" TEXT,
    "subsector" TEXT,
    "rangoTamano" TEXT,
    "rolParticipante" TEXT,
    "productoServicio" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFin" TIMESTAMP(3) NOT NULL,
    "tipoOperacion" TEXT NOT NULL,
    "detalleDesbloqueado" BOOLEAN NOT NULL DEFAULT false,
    "detalleDesbloqueadoEn" TIMESTAMP(3),
    "correo" TEXT,
    "nombreCompleto" TEXT,
    "empresaNombre" TEXT,
    "telefono" TEXT,
    "huellaOrigen" TEXT NOT NULL,
    "huellaOrigenPurgadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluaciones_expres_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respuestas" (
    "id" TEXT NOT NULL,
    "evaluacionExpresV2Id" TEXT NOT NULL,
    "preguntaVersionId" TEXT NOT NULL,
    "opcionSeleccionada" TEXT,
    "noSabe" BOOLEAN NOT NULL DEFAULT false,
    "contextoLibre" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "respuestas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimientos_expres" (
    "id" TEXT NOT NULL,
    "evaluacionExpresV2Id" TEXT NOT NULL,
    "finalidad" "FinalidadConsentimiento" NOT NULL,
    "aceptado" BOOLEAN NOT NULL,
    "textoVersion" TEXT NOT NULL,
    "textoSnapshot" TEXT NOT NULL,
    "jurisdiccion" TEXT NOT NULL DEFAULT 'PE',
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodoRetiro" "MetodoRetiro" NOT NULL DEFAULT 'NINGUNO',
    "retiradoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentimientos_expres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimientos_cuenta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "finalidad" "FinalidadConsentimiento" NOT NULL,
    "aceptado" BOOLEAN NOT NULL,
    "textoVersion" TEXT NOT NULL,
    "textoSnapshot" TEXT NOT NULL,
    "jurisdiccion" TEXT NOT NULL DEFAULT 'PE',
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodoRetiro" "MetodoRetiro" NOT NULL DEFAULT 'NINGUNO',
    "retiradoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentimientos_cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hallazgos_expres" (
    "id" TEXT NOT NULL,
    "evaluacionExpresV2Id" TEXT NOT NULL,
    "dimension" "DimensionDiagnosticoV2" NOT NULL,
    "estadoCategoria" TEXT NOT NULL,
    "enunciado" TEXT NOT NULL,
    "evidenceState" "EstadoEvidencia" NOT NULL,
    "coberturaConfianza" DOUBLE PRECISION NOT NULL,
    "evidenciaFaltante" TEXT,
    "siguienteVerificacion" TEXT,
    "ruleVersion" TEXT NOT NULL,
    "contextoSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hallazgos_expres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hallazgos_expres_traza" (
    "id" TEXT NOT NULL,
    "hallazgoExpresId" TEXT NOT NULL,
    "respuestaIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hallazgos_expres_traza_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_plataforma_email_key" ON "usuarios_plataforma"("email");

-- CreateIndex
CREATE UNIQUE INDEX "cuestionario_versiones_codigo_numero_key" ON "cuestionario_versiones"("codigo", "numero");

-- RF20/Seccion 18.3.A — backstop de base de datos: una version PUBLICADA
-- nunca convive con otra PUBLICADA del mismo codigo, incluso si el modulo
-- de escritura de la aplicacion tuviera un bug. Indice unico PARCIAL
-- (nunca uno completo, que impediria tener varias BORRADOR/RETIRADA del
-- mismo codigo a la vez).
CREATE UNIQUE INDEX "uq_cuestionario_version_publicada" ON "cuestionario_versiones"("codigo") WHERE "estado" = 'PUBLICADA';

-- CreateIndex
CREATE UNIQUE INDEX "pregunta_versiones_cuestionarioVersionId_codigo_key" ON "pregunta_versiones"("cuestionarioVersionId", "codigo");

-- CreateIndex
CREATE INDEX "evaluaciones_expres_v2_huellaOrigen_idx" ON "evaluaciones_expres_v2"("huellaOrigen");

-- CreateIndex
CREATE INDEX "evaluaciones_expres_v2_createdAt_idx" ON "evaluaciones_expres_v2"("createdAt");

-- CreateIndex
CREATE INDEX "evaluaciones_expres_v2_cuestionarioVersionId_idx" ON "evaluaciones_expres_v2"("cuestionarioVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "respuestas_evaluacionExpresV2Id_preguntaVersionId_key" ON "respuestas"("evaluacionExpresV2Id", "preguntaVersionId");

-- CreateIndex
CREATE INDEX "consentimientos_expres_evaluacionExpresV2Id_finalidad_idx" ON "consentimientos_expres"("evaluacionExpresV2Id", "finalidad");

-- CreateIndex
CREATE INDEX "consentimientos_cuenta_empresaId_usuarioId_finalidad_idx" ON "consentimientos_cuenta"("empresaId", "usuarioId", "finalidad");

-- CreateIndex
CREATE INDEX "hallazgos_expres_evaluacionExpresV2Id_idx" ON "hallazgos_expres"("evaluacionExpresV2Id");

-- CreateIndex
CREATE UNIQUE INDEX "hallazgos_expres_traza_hallazgoExpresId_key" ON "hallazgos_expres_traza"("hallazgoExpresId");

-- AddForeignKey
ALTER TABLE "cuestionario_versiones" ADD CONSTRAINT "cuestionario_versiones_curadorId_fkey" FOREIGN KEY ("curadorId") REFERENCES "usuarios_plataforma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregunta_versiones" ADD CONSTRAINT "pregunta_versiones_cuestionarioVersionId_fkey" FOREIGN KEY ("cuestionarioVersionId") REFERENCES "cuestionario_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_expres_v2" ADD CONSTRAINT "evaluaciones_expres_v2_cuestionarioVersionId_fkey" FOREIGN KEY ("cuestionarioVersionId") REFERENCES "cuestionario_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respuestas" ADD CONSTRAINT "respuestas_evaluacionExpresV2Id_fkey" FOREIGN KEY ("evaluacionExpresV2Id") REFERENCES "evaluaciones_expres_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respuestas" ADD CONSTRAINT "respuestas_preguntaVersionId_fkey" FOREIGN KEY ("preguntaVersionId") REFERENCES "pregunta_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos_expres" ADD CONSTRAINT "consentimientos_expres_evaluacionExpresV2Id_fkey" FOREIGN KEY ("evaluacionExpresV2Id") REFERENCES "evaluaciones_expres_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos_cuenta" ADD CONSTRAINT "consentimientos_cuenta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos_cuenta" ADD CONSTRAINT "consentimientos_cuenta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hallazgos_expres" ADD CONSTRAINT "hallazgos_expres_evaluacionExpresV2Id_fkey" FOREIGN KEY ("evaluacionExpresV2Id") REFERENCES "evaluaciones_expres_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hallazgos_expres_traza" ADD CONSTRAINT "hallazgos_expres_traza_hallazgoExpresId_fkey" FOREIGN KEY ("hallazgoExpresId") REFERENCES "hallazgos_expres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Seccion 18.2.B/18.3.B) — "consentimientos_cuenta" es la PRIMERA
-- tabla tenant-scoped nueva desde el Incremento 1: primer punto real donde
-- se aplica la regla "toda tabla tenant nueva lleva su politica RLS en la
-- misma migracion que la crea" (docs/PATRONES.md). Mismo patron de columna
-- directa que ya usan empresas/usuarios/eslabones/conexiones/ciclos_pulso
-- en prisma/rls.sql.
ALTER TABLE "consentimientos_cuenta" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_consentimientos_cuenta ON "consentimientos_cuenta"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- usuarios_plataforma, cuestionario_versiones, pregunta_versiones,
-- evaluaciones_expres_v2, respuestas, consentimientos_expres,
-- hallazgos_expres y hallazgos_expres_traza NO llevan RLS (adenda de
-- ADR-0001, extendida por Seccion 18.2.B/18.2.C de PLAN-DE-TRABAJO.md):
-- mismo regimen de tenant nulo explicito que "evaluaciones_expres" en
-- prisma/rls.sql. Se protegen por RF25 (rate limiting), por cascada desde
-- evaluaciones_expres_v2, y por no compartir tabla con datos de cuentas
-- registradas (RNF7) — nunca deben llevar empresaId ni politica de
-- tenant. Reflejar esta lista en el bloque de comentario final de
-- prisma/rls.sql en la misma sesion que se aplique esta migracion.

-- RF23/RF24 (Seccion 18.2.A) — append-only real a nivel de permisos de
-- Postgres, no solo de disciplina de aplicacion: retirar un consentimiento
-- es un INSERT de una fila nueva (aceptado=false, retiradoEn=now()),
-- nunca un UPDATE/DELETE sobre la fila original. chainpulse_app pierde el
-- privilegio de modificar/borrar estas dos tablas; el historial completo
-- queda garantizado por el motor de base de datos, no por convencion.
REVOKE UPDATE, DELETE ON "consentimientos_expres", "consentimientos_cuenta" FROM chainpulse_app;
GRANT INSERT, SELECT ON "consentimientos_expres", "consentimientos_cuenta" TO chainpulse_app;
