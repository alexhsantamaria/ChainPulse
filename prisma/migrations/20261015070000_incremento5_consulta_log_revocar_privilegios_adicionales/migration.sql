-- Correctivo de privilegios para "consultas_log" (Incremento 5),
-- posterior a la migracion 20261015060000_incremento5_consulta_log, que
-- NO se modifica: esa migracion creo la tabla y otorgo explicitamente
-- `GRANT SELECT, INSERT ON "consultas_log" TO chainpulse_app;` (el mismo
-- patron append-only ya usado en consentimientos_expres /
-- consentimientos_cuenta, Incremento 2, migracion
-- 20260916150000_incremento2_evaluacion_expres_v2).
--
-- Diagnostico confirmado por Alex sobre la rama temporal: el privilegio
-- EFECTIVO de chainpulse_app sobre "consultas_log" resulto
-- SELECT, INSERT, UPDATE, DELETE -- es decir, con dos privilegios
-- adicionales (UPDATE, DELETE) que la migracion original nunca otorgo de
-- forma explicita. La causa no es un error en ese GRANT: en PostgreSQL,
-- GRANT es aditivo, nunca restrictivo. chainpulse_app puede llegar a
-- tener un privilegio sobre una tabla nueva por una via distinta a los
-- GRANT versionados en este repositorio -- por ejemplo, un grant o un
-- ALTER DEFAULT PRIVILEGES configurado a nivel de rol/esquema
-- directamente en Neon, fuera del control de versiones (ver el
-- comentario de 20260916170000_grants_incremento2, que ya documenta
-- explicitamente que la configuracion inicial del rol chainpulse_app en
-- Neon no esta documentada en este repositorio). El GRANT explicito de
-- SELECT, INSERT de 20261015060000 se SUMO a ese privilegio preexistente
-- en lugar de limitarlo, porque GRANT nunca retira nada.
--
-- Esta migracion no repite ni modifica el GRANT de 20261015060000 (sigue
-- intacto: SELECT, INSERT permanecen). Unicamente retira, de forma
-- explicita y versionada, los dos privilegios que esa via externa anadio
-- y que violan el contrato append-only ya documentado para esta tabla
-- (ningun UPDATE/DELETE desde la aplicacion sobre un registro de
-- auditoria ya escrito -- la aplicacion solo necesita registrar y leer,
-- nunca modificar ni borrar lo ya escrito). Tras aplicarse, el privilegio
-- efectivo de chainpulse_app sobre "consultas_log" debe quedar
-- exactamente en SELECT, INSERT.

BEGIN;

REVOKE UPDATE, DELETE
ON TABLE "consultas_log"
FROM chainpulse_app;

COMMIT;
