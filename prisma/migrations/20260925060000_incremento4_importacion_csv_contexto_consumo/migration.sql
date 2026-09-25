-- Incremento 4 Bloque B, vertical slice de Cobertura -- agrega el
-- contexto de consumo a ImportacionCsv (Alex, 2026-09-25). fuenteConsumo
-- y el periodo de referencia del consumo son obligatorios POR FILA en
-- ObservacionCobertura, pero se piden UNA SOLA VEZ en el formulario de
-- confirmacion y se aplican a todas las filas de la importacion -- no son
-- columnas mapeables del CSV. Se persisten en ImportacionCsv (y no solo
-- se pasan en memoria desde la ruta de confirmar hacia el job) porque el
-- cron de respaldo (src/app/api/internal/jobs/run/route.ts) puede
-- reprocesar esta importacion en un request totalmente separado, sin
-- ningun otro lugar de donde leerlos.
--
-- Migracion puramente aditiva: 3 columnas nullable en una tabla ya
-- existente (creada en 20260924040000_incremento4_kpis_bloque_b_cobertura),
-- sin migracion de datos (ninguna fila de importaciones_csv existe
-- todavia -- el importador CSV recien se esta construyendo) y sin tocar
-- RLS/GRANT (ya cubren toda la tabla, no columnas especificas). Escrita a
-- mano por el mismo motivo que el resto de las migraciones de este
-- incremento: `prisma migrate dev` no puede correr en el entorno de
-- Claude (bloqueo de red a binaries.prisma.sh, ver README.md) -- pendiente
-- de validar con `prisma migrate dev`/`prisma validate` reales en
-- Windows antes de darla por cerrada.

ALTER TABLE "importaciones_csv"
  ADD COLUMN "fuenteConsumo" TEXT,
  ADD COLUMN "periodoReferenciaConsumoInicio" DATE,
  ADD COLUMN "periodoReferenciaConsumoFin" DATE;
