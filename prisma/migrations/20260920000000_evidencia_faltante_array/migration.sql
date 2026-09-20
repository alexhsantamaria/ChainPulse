-- Incremento 2 — HallazgoExpres.evidenciaFaltante: String? -> String[]
-- (deuda tecnica documentada desde el Bloque C en
-- pendientes-tecnicos-incremento2.md). El campo se guardaba serializado
-- con " | " como separador porque DiagnosticFinding.missingEvidence es
-- string[] y el modelo Prisma tenia String? -- ahora se persiste el
-- array real, sin el workaround de join/split que tenian
-- persistirHallazgos.ts/formatearHallazgo.ts/ordenarHallazgosPersistidos.ts.
-- Convierte filas existentes dividiendo por el mismo separador que se
-- usaba al escribirlas, para no perder datos ya guardados (aplicar con
-- `prisma migrate deploy` en Windows, mismo flujo que las migraciones
-- anteriores de este proyecto).

ALTER TABLE "hallazgos_expres"
  ALTER COLUMN "evidenciaFaltante" TYPE TEXT[]
    USING (
      CASE
        WHEN "evidenciaFaltante" IS NULL OR "evidenciaFaltante" = '' THEN ARRAY[]::TEXT[]
        ELSE string_to_array("evidenciaFaltante", ' | ')
      END
    ),
  ALTER COLUMN "evidenciaFaltante" SET NOT NULL;
