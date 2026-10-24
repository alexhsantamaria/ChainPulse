-- ChainPulse -- RF24 (derechos/retiro), migracion 1 de 3.
--
-- Diseno cerrado, en este orden de autoridad (autorizacion de Alex,
-- 2026-10-22): chainpulse/diseno-v5-final-consolidado-paquete-rf24-
-- derechos-retiro-2026-10-21.md Seccion 18 (orden de migraciones) +
-- addenda-cierre-v5 (retencion de la tabla senuelo) + addenda-2-cierre-v5
-- (fencing, HMAC, idempotencia, timeout del cron) + condiciones de
-- reconciliacion/fencing de la autorizacion de PR-A.
--
-- ALCANCE EXACTO de esta migracion (no mas que esto):
--   Unicamente ALTER TYPE ... ADD VALUE sobre el enum BucketLimiteTasa
--   ya existente, para los dos buckets nuevos de limite de tasa de RF24
--   (SOLICITUD_DERECHOS: 10/hora por origen, 3/24h por evaluacion;
--   CONFIRMAR_DERECHOS: 20/hora por origen -- valores confirmados en
--   src/config/rf24.ts, no en esta migracion).
--
-- POR QUE EN SU PROPIA MIGRACION, AISLADA: Postgres nunca permite usar un
-- valor de enum nuevo en la misma transaccion en la que se agrego (la
-- instantanea de catalogo no lo ve todavia como confirmado) -- no es una
-- limitacion de version antigua, aplica en cualquier version, incluida
-- PostgreSQL 18.6 (version real de este proyecto, confirmada en rondas
-- anteriores). La migracion 3 (funciones) y el codigo de aplicacion que
-- use estos valores dependen de que esta migracion ya haya sido
-- confirmada (COMMIT) en una transaccion anterior y separada.
--
-- FUERA de alcance a proposito: nada de tablas, constraints, funciones ni
-- grants -- eso vive en las migraciones 2 y 3 de este mismo paquete.
--
-- Transaccional: ALTER TYPE ... ADD VALUE SI puede ejecutarse dentro de
-- un bloque de transaccion (BEGIN/COMMIT) en PostgreSQL moderno -- la
-- restriccion es unicamente que el valor nuevo no puede USARSE dentro de
-- esa misma transaccion, no que la propia instruccion deba correr fuera
-- de una transaccion.

BEGIN;

ALTER TYPE "BucketLimiteTasa" ADD VALUE 'SOLICITUD_DERECHOS';
ALTER TYPE "BucketLimiteTasa" ADD VALUE 'CONFIRMAR_DERECHOS';

COMMIT;
