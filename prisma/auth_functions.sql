-- ChainPulse — funcion de autenticacion (ADR-0003, segunda capa de
-- aislamiento multi-tenant, mismo criterio que prisma/rls.sql).
--
-- PROBLEMA: el login recibe solo un email, sin saber a que empresa
-- (tenant) pertenece de antemano — y las politicas RLS de "usuarios"
-- (prisma/rls.sql) exigen que app.tenant_id ya este fijado para poder
-- leer cualquier fila. Sin esta funcion, el rol restringido chainpulse_app
-- no podria encontrar el usuario para autenticarlo.
--
-- SOLUCION: una unica funcion SECURITY DEFINER (corre con los privilegios
-- de quien la crea — el dueño de las tablas, no de quien la invoca), que
-- expone SOLO los campos que la autenticacion necesita, para UN usuario
-- por email. No es un bypass general de RLS: chainpulse_app puede
-- ejecutar esta funcion puntual, pero sigue sin poder hacer
-- SELECT * FROM usuarios directo sin tenant — el resto de cada request,
-- una vez resuelto el tenant, vuelve a pasar por tenantClient() (RLS
-- normal). Ver src/infra/auth/loginLookup.ts.
--
-- COMO SE APLICA: pegar y correr en el SQL Editor de Neon, igual que
-- prisma/rls.sql (requiere que las tablas ya existan, incluyendo las
-- columnas nuevas de Usuario — correr prisma:migrate primero).

CREATE OR REPLACE FUNCTION login_lookup(p_email text)
RETURNS TABLE (
  id text,
  "empresaId" text,
  email text,
  nombre text,
  rol "RolUsuario",
  "passwordHash" text,
  "mfaSecret" text,
  "mfaHabilitado" boolean,
  "intentosFallidos" integer,
  "bloqueadoHasta" timestamp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, "empresaId", email, nombre, rol, "passwordHash", "mfaSecret",
         "mfaHabilitado", "intentosFallidos", "bloqueadoHasta"
  FROM usuarios
  WHERE email = p_email
  LIMIT 1;
$$;

-- Solo chainpulse_app puede ejecutarla — nadie mas (ni PUBLIC).
REVOKE ALL ON FUNCTION login_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_lookup(text) TO chainpulse_app;
