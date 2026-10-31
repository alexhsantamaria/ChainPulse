-- RF20: bitacora append-only para las transiciones de gobernanza de versiones.
-- La tabla nace con sus permisos definitivos; no existe una ventana con
-- escritura directa para chainpulse_app.

CREATE TYPE "AccionBitacoraVersion" AS ENUM ('CORREGIR', 'PUBLICAR', 'RETIRAR');

CREATE TABLE "bitacora_version_cuestionario" (
    "id" TEXT NOT NULL,
    "cuestionarioVersionId" TEXT NOT NULL,
    "versionOrigenId" TEXT,
    "actorId" TEXT NOT NULL,
    "accion" "AccionBitacoraVersion" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitacora_version_cuestionario_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bitacora_version_cuestionario_cuestionarioVersionId_fkey"
      FOREIGN KEY ("cuestionarioVersionId") REFERENCES "cuestionario_versiones"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bitacora_version_cuestionario_versionOrigenId_fkey"
      FOREIGN KEY ("versionOrigenId") REFERENCES "cuestionario_versiones"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bitacora_version_cuestionario_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "usuarios_plataforma"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "bitacora_version_cuestionario_cuestionarioVersionId_idx"
  ON "bitacora_version_cuestionario"("cuestionarioVersionId");

CREATE INDEX "bitacora_version_cuestionario_actorId_idx"
  ON "bitacora_version_cuestionario"("actorId");

REVOKE INSERT, UPDATE, DELETE ON "bitacora_version_cuestionario" FROM chainpulse_app;
GRANT SELECT ON "bitacora_version_cuestionario" TO chainpulse_app;
