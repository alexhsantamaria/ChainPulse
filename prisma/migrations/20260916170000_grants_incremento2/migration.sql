-- R5-16 (Ronda 5, ALTO) -- la migracion del Incremento 2
-- (20260916150000_incremento2_evaluacion_expres_v2) crea 9 tablas nuevas
-- pero solo dos ("consentimientos_expres", "consentimientos_cuenta")
-- reciben un GRANT explicito hacia chainpulse_app (el patron
-- REVOKE UPDATE, DELETE + GRANT INSERT, SELECT del "recibo" append-only).
-- Las 7 tablas restantes quedan sin ningun GRANT propio en el repositorio:
-- las migraciones corren con el rol `neondb_owner` (ver PLAN-DE-TRABAJO.md
-- Seccion sobre P3014/roles), que es el dueño de las tablas nuevas por
-- defecto -- chainpulse_app (el rol restringido que usa la aplicacion en
-- runtime, DATABASE_URL) NO hereda privilegios sobre una tabla nueva solo
-- por existir: sin un GRANT explicito (o ALTER DEFAULT PRIVILEGES, que
-- tampoco esta documentado en este repo), cualquier consulta de la
-- aplicacion contra estas tablas fallaria con "permission denied" en
-- cuanto exista codigo que las use.
--
-- Privilegios de lectura/escritura normales (SELECT, INSERT, UPDATE,
-- DELETE) -- mismo nivel que el resto de las tablas "de aplicacion" del
-- proyecto (eslabones, conexiones, etc., cuyo GRANT vive fuera de este
-- repositorio, en la configuracion inicial del rol en Neon). Las dos
-- tablas de "recibo" append-only ya tienen su propio GRANT mas restrictivo
-- en la migracion del Incremento 2 y no se repiten aca.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "usuarios_plataforma",
  "cuestionario_versiones",
  "pregunta_versiones",
  "evaluaciones_expres_v2",
  "respuestas",
  "hallazgos_expres",
  "hallazgos_expres_traza"
TO chainpulse_app;
