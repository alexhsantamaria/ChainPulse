-- DropForeignKey
ALTER TABLE "respuestas_crudas" DROP CONSTRAINT "respuestas_crudas_responsableId_fkey";

-- CreateTable
CREATE TABLE "metricas_cuestionario" (
    "id" TEXT NOT NULL,
    "cicloPulsoId" TEXT NOT NULL,
    "responsableId" TEXT NOT NULL,
    "duracionSegundos" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metricas_cuestionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recomendaciones_ejecutadas" (
    "id" TEXT NOT NULL,
    "cicloPulsoId" TEXT NOT NULL,
    "conexionId" TEXT NOT NULL,
    "marcadaPorId" TEXT NOT NULL,
    "marcadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recomendaciones_ejecutadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metricas_cuestionario_cicloPulsoId_idx" ON "metricas_cuestionario"("cicloPulsoId");

-- CreateIndex
CREATE UNIQUE INDEX "recomendaciones_ejecutadas_cicloPulsoId_conexionId_key" ON "recomendaciones_ejecutadas"("cicloPulsoId", "conexionId");

-- AddForeignKey
ALTER TABLE "respuestas_crudas" ADD CONSTRAINT "respuestas_crudas_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metricas_cuestionario" ADD CONSTRAINT "metricas_cuestionario_cicloPulsoId_fkey" FOREIGN KEY ("cicloPulsoId") REFERENCES "ciclos_pulso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metricas_cuestionario" ADD CONSTRAINT "metricas_cuestionario_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recomendaciones_ejecutadas" ADD CONSTRAINT "recomendaciones_ejecutadas_cicloPulsoId_fkey" FOREIGN KEY ("cicloPulsoId") REFERENCES "ciclos_pulso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recomendaciones_ejecutadas" ADD CONSTRAINT "recomendaciones_ejecutadas_conexionId_fkey" FOREIGN KEY ("conexionId") REFERENCES "conexiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recomendaciones_ejecutadas" ADD CONSTRAINT "recomendaciones_ejecutadas_marcadaPorId_fkey" FOREIGN KEY ("marcadaPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
