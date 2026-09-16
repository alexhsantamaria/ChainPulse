-- CreateEnum
CREATE TYPE "BucketLimiteTasa" AS ENUM ('INICIO_EVALUACION', 'DESBLOQUEO_DETALLE');

-- CreateTable
CREATE TABLE "limite_tasa" (
    "id" TEXT NOT NULL,
    "huellaOrigenHash" TEXT NOT NULL,
    "bucket" "BucketLimiteTasa" NOT NULL,
    "ventanaInicio" TIMESTAMP(3) NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "limite_tasa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "limite_tasa_huellaOrigenHash_bucket_ventanaInicio_key" ON "limite_tasa"("huellaOrigenHash", "bucket", "ventanaInicio");

-- CreateIndex
CREATE INDEX "limite_tasa_ventanaInicio_idx" ON "limite_tasa"("ventanaInicio");
