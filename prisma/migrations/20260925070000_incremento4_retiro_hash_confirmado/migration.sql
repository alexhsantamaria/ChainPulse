-- Incremento 4 Bloque B -- persiste el hash de la vista previa de retiro
-- (REEMPLAZO_ALCANCE) que el usuario acepto al confirmar, para que el job
-- (procesarUnaImportacionCsv) pueda recomprobarlo antes de retirar
-- registros o publicar resultados como definitivos (Alex, 2026-09-25,
-- condiciones de cierre, "Opcion A"). Columna nueva, nullable, puramente
-- aditiva -- no migra datos existentes, no toca RLS/GRANT (ya cubiertos
-- por el GRANT de "importaciones_csv" de la migracion
-- 20260924040000_incremento4_kpis_bloque_b_cobertura).
ALTER TABLE "importaciones_csv" ADD COLUMN "retiroHashConfirmado" TEXT;
