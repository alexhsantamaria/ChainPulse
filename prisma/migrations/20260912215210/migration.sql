-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMINISTRADOR', 'RESPONSABLE');

-- CreateEnum
CREATE TYPE "GradoDependencia" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');

-- CreateEnum
CREATE TYPE "DuracionCategorica" AS ENUM ('CORTO', 'MEDIO', 'LARGO');

-- CreateEnum
CREATE TYPE "EstadoDato" AS ENUM ('DECLARADO', 'INFERIDO', 'VERIFICADO');

-- CreateEnum
CREATE TYPE "NivelImpacto" AS ENUM ('BAJO', 'MEDIO', 'ALTO', 'CRITICO');

-- CreateEnum
CREATE TYPE "EstadoCiclo" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "DimensionDiagnostico" AS ENUM ('SALUD', 'CRITICIDAD', 'DEPENDENCIA', 'RIESGO');

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "eslabonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eslabones" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "esProveedorExterno" BOOLEAN NOT NULL DEFAULT false,
    "tipoFlujo" TEXT,
    "estado" "EstadoDato" NOT NULL DEFAULT 'DECLARADO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eslabones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conexiones" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "origenId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "gradoDependencia" "GradoDependencia",
    "impactoPromesaCliente" "NivelImpacto",
    "tieneAlternativa" BOOLEAN,
    "tiempoTolerable" "DuracionCategorica",
    "tiempoRecuperacion" "DuracionCategorica",
    "criticidadConfirmadaEn" TIMESTAMP(3),
    "tipoFlujo" TEXT,
    "estado" "EstadoDato" NOT NULL DEFAULT 'DECLARADO',
    "completa" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conexiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ciclos_pulso" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "estado" "EstadoCiclo" NOT NULL DEFAULT 'ABIERTO',
    "abiertoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoEn" TIMESTAMP(3),
    "coberturaRespuesta" DOUBLE PRECISION,

    CONSTRAINT "ciclos_pulso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respuestas_crudas" (
    "id" TEXT NOT NULL,
    "cicloPulsoId" TEXT NOT NULL,
    "conexionId" TEXT NOT NULL,
    "responsableId" TEXT NOT NULL,
    "valor" INTEGER,
    "noSabe" BOOLEAN NOT NULL DEFAULT false,
    "noAplica" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "respuestas_crudas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultados_conexion" (
    "id" TEXT NOT NULL,
    "cicloPulsoId" TEXT NOT NULL,
    "conexionId" TEXT NOT NULL,
    "salud" DOUBLE PRECISION NOT NULL,
    "criticidadSnapshot" JSONB NOT NULL,
    "gradoDependenciaSnapshot" "GradoDependencia" NOT NULL,
    "riesgo" DOUBLE PRECISION NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_conexion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultados_ciclo" (
    "id" TEXT NOT NULL,
    "cicloPulsoId" TEXT NOT NULL,
    "indiceIntegracion" DOUBLE PRECISION NOT NULL,
    "eslabonesMasDebilesIds" TEXT[],
    "ruleVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_ciclo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluaciones_expres" (
    "id" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "saludPromedio" DOUBLE PRECISION NOT NULL,
    "criticidadPromedio" DOUBLE PRECISION NOT NULL,
    "dependenciaPromedio" DOUBLE PRECISION NOT NULL,
    "riesgoPromedio" DOUBLE PRECISION NOT NULL,
    "indiceIntegracion" DOUBLE PRECISION NOT NULL,
    "dimensionMasDebil" "DimensionDiagnostico" NOT NULL,
    "detalleDesbloqueado" BOOLEAN NOT NULL DEFAULT false,
    "detalleDesbloqueadoEn" TIMESTAMP(3),
    "correo" TEXT,
    "nombreCompleto" TEXT,
    "empresaNombre" TEXT,
    "telefono" TEXT,
    "consentimientoEnvio" BOOLEAN NOT NULL DEFAULT false,
    "consentimientoMejoraAlgoritmo" BOOLEAN NOT NULL DEFAULT false,
    "huellaOrigen" TEXT NOT NULL,
    "huellaOrigenPurgadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluaciones_expres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluaciones_expres_eslabones" (
    "id" TEXT NOT NULL,
    "evaluacionExpresId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoFlujo" TEXT,
    "estado" "EstadoDato" NOT NULL DEFAULT 'DECLARADO',

    CONSTRAINT "evaluaciones_expres_eslabones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluaciones_expres_conexiones" (
    "id" TEXT NOT NULL,
    "evaluacionExpresId" TEXT NOT NULL,
    "origenNombre" TEXT NOT NULL,
    "destinoNombre" TEXT NOT NULL,
    "gradoDependencia" "GradoDependencia" NOT NULL,
    "impactoPromesaCliente" "NivelImpacto",
    "tieneAlternativa" BOOLEAN,
    "tiempoTolerable" "DuracionCategorica",
    "tiempoRecuperacion" "DuracionCategorica",
    "descripcionLibre" TEXT,
    "salud" DOUBLE PRECISION,

    CONSTRAINT "evaluaciones_expres_conexiones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usuarios_empresaId_idx" ON "usuarios"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_empresaId_email_key" ON "usuarios"("empresaId", "email");

-- CreateIndex
CREATE INDEX "eslabones_empresaId_idx" ON "eslabones"("empresaId");

-- CreateIndex
CREATE INDEX "conexiones_empresaId_idx" ON "conexiones"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "conexiones_origenId_destinoId_key" ON "conexiones"("origenId", "destinoId");

-- CreateIndex
CREATE INDEX "ciclos_pulso_empresaId_idx" ON "ciclos_pulso"("empresaId");

-- CreateIndex
CREATE INDEX "respuestas_crudas_cicloPulsoId_idx" ON "respuestas_crudas"("cicloPulsoId");

-- CreateIndex
CREATE UNIQUE INDEX "respuestas_crudas_cicloPulsoId_conexionId_responsableId_key" ON "respuestas_crudas"("cicloPulsoId", "conexionId", "responsableId");

-- CreateIndex
CREATE INDEX "resultados_conexion_cicloPulsoId_idx" ON "resultados_conexion"("cicloPulsoId");

-- CreateIndex
CREATE UNIQUE INDEX "resultados_conexion_cicloPulsoId_conexionId_key" ON "resultados_conexion"("cicloPulsoId", "conexionId");

-- CreateIndex
CREATE UNIQUE INDEX "resultados_ciclo_cicloPulsoId_key" ON "resultados_ciclo"("cicloPulsoId");

-- CreateIndex
CREATE INDEX "evaluaciones_expres_huellaOrigen_idx" ON "evaluaciones_expres"("huellaOrigen");

-- CreateIndex
CREATE INDEX "evaluaciones_expres_createdAt_idx" ON "evaluaciones_expres"("createdAt");

-- CreateIndex
CREATE INDEX "evaluaciones_expres_eslabones_evaluacionExpresId_idx" ON "evaluaciones_expres_eslabones"("evaluacionExpresId");

-- CreateIndex
CREATE INDEX "evaluaciones_expres_conexiones_evaluacionExpresId_idx" ON "evaluaciones_expres_conexiones"("evaluacionExpresId");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_eslabonId_fkey" FOREIGN KEY ("eslabonId") REFERENCES "eslabones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eslabones" ADD CONSTRAINT "eslabones_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexiones" ADD CONSTRAINT "conexiones_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexiones" ADD CONSTRAINT "conexiones_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "eslabones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexiones" ADD CONSTRAINT "conexiones_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "eslabones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ciclos_pulso" ADD CONSTRAINT "ciclos_pulso_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respuestas_crudas" ADD CONSTRAINT "respuestas_crudas_cicloPulsoId_fkey" FOREIGN KEY ("cicloPulsoId") REFERENCES "ciclos_pulso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respuestas_crudas" ADD CONSTRAINT "respuestas_crudas_conexionId_fkey" FOREIGN KEY ("conexionId") REFERENCES "conexiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respuestas_crudas" ADD CONSTRAINT "respuestas_crudas_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_conexion" ADD CONSTRAINT "resultados_conexion_cicloPulsoId_fkey" FOREIGN KEY ("cicloPulsoId") REFERENCES "ciclos_pulso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_conexion" ADD CONSTRAINT "resultados_conexion_conexionId_fkey" FOREIGN KEY ("conexionId") REFERENCES "conexiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_ciclo" ADD CONSTRAINT "resultados_ciclo_cicloPulsoId_fkey" FOREIGN KEY ("cicloPulsoId") REFERENCES "ciclos_pulso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_expres_eslabones" ADD CONSTRAINT "evaluaciones_expres_eslabones_evaluacionExpresId_fkey" FOREIGN KEY ("evaluacionExpresId") REFERENCES "evaluaciones_expres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_expres_conexiones" ADD CONSTRAINT "evaluaciones_expres_conexiones_evaluacionExpresId_fkey" FOREIGN KEY ("evaluacionExpresId") REFERENCES "evaluaciones_expres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
