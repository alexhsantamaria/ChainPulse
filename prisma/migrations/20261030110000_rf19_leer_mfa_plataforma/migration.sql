DROP FUNCTION IF EXISTS public.leer_mfa_plataforma(text);

CREATE FUNCTION public.leer_mfa_plataforma(p_usuario_id text)
RETURNS TABLE("mfaSecret" text, "mfaHabilitado" boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT "mfaSecret", "mfaHabilitado"
  FROM public.usuarios_plataforma
  WHERE id = p_usuario_id;
$$;

ALTER FUNCTION public.leer_mfa_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.leer_mfa_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leer_mfa_plataforma(text) TO chainpulse_app;
