-- Incremento 3, Bloque B (extension post-RF34) -- persistencia de la
-- posicion de cada Nodo en el canvas del mapa. PLAN-DE-TRABAJO.md dejo
-- estas columnas explicitamente pendientes ("fuera de alcance de este
-- primer paso... necesitaria una migracion nueva cuando se construya la
-- edicion interactiva") hasta que existiera la edicion interactiva sobre
-- el canvas (RF34, commit 71b5d27), que ya existe. Columnas nullable:
-- todo nodo existente hoy no tiene posicion elegida por el usuario, y
-- MapaCadenaCanvas.tsx ya sabe calcular un layout en grilla cuando
-- faltan -- sin backfill, sin default artificial.

-- AlterTable
ALTER TABLE "nodos" ADD COLUMN "posX" DOUBLE PRECISION,
ADD COLUMN "posY" DOUBLE PRECISION;
