REVOKE INSERT, UPDATE, DELETE ON public.usuarios_plataforma FROM chainpulse_app;
REVOKE SELECT ON public.usuarios_plataforma FROM chainpulse_app;

DROP FUNCTION IF EXISTS public.login_lookup_plataforma(text);
CREATE FUNCTION public.login_lookup_plataforma(p_email text)
RETURNS TABLE(
  id text, "passwordHash" text, "mfaSecret" text, "mfaHabilitado" boolean,
  rol text, "intentosFallidos" integer, "bloqueadoHasta" timestamp,
  "sessionVersion" integer, activo boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, "passwordHash", "mfaSecret", "mfaHabilitado", rol::text,
         "intentosFallidos", "bloqueadoHasta", "sessionVersion", activo
  FROM public.usuarios_plataforma
  WHERE lower(btrim(email)) = lower(btrim(p_email));
$$;
ALTER FUNCTION public.login_lookup_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.login_lookup_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_lookup_plataforma(text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.registrar_intento_fallido_plataforma(text);
CREATE FUNCTION public.registrar_intento_fallido_plataforma(p_usuario_id text)
RETURNS TABLE("intentosFallidos" integer, "bloqueadoHasta" timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_max_intentos CONSTANT integer := 5;
  v_minutos_bloqueo CONSTANT integer := 15;
BEGIN
  RETURN QUERY
  UPDATE public.usuarios_plataforma AS u
  SET "intentosFallidos" = u."intentosFallidos" + 1,
      "bloqueadoHasta" = CASE
        WHEN u."intentosFallidos" + 1 >= v_max_intentos
          THEN now() + (v_minutos_bloqueo || ' minutes')::interval
        ELSE u."bloqueadoHasta"
      END
  WHERE u.id = p_usuario_id
  RETURNING u."intentosFallidos", u."bloqueadoHasta";
END;
$$;
ALTER FUNCTION public.registrar_intento_fallido_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.registrar_intento_fallido_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_intento_fallido_plataforma(text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.restablecer_intentos_plataforma(text);
CREATE FUNCTION public.restablecer_intentos_plataforma(p_usuario_id text)
RETURNS TABLE(restablecido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET "intentosFallidos" = 0, "bloqueadoHasta" = NULL
  WHERE id = p_usuario_id;
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;
ALTER FUNCTION public.restablecer_intentos_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.restablecer_intentos_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restablecer_intentos_plataforma(text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.leer_estado_sesion_plataforma(text);
CREATE FUNCTION public.leer_estado_sesion_plataforma(p_usuario_id text)
RETURNS TABLE(activo boolean, rol text, "sessionVersion" integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT activo, rol::text, "sessionVersion"
  FROM public.usuarios_plataforma WHERE id = p_usuario_id;
$$;
ALTER FUNCTION public.leer_estado_sesion_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.leer_estado_sesion_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leer_estado_sesion_plataforma(text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.incrementar_version_sesion_plataforma(text);
CREATE FUNCTION public.incrementar_version_sesion_plataforma(p_usuario_id text)
RETURNS TABLE("sessionVersion" integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_nueva_version integer;
BEGIN
  UPDATE public.usuarios_plataforma AS u
  SET "sessionVersion" = u."sessionVersion" + 1
  WHERE u.id = p_usuario_id
  RETURNING u."sessionVersion" INTO v_nueva_version;
  RETURN QUERY SELECT v_nueva_version;
END;
$$;
ALTER FUNCTION public.incrementar_version_sesion_plataforma(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.incrementar_version_sesion_plataforma(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.incrementar_version_sesion_plataforma(text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.desactivar_usuario_plataforma(text, text);
CREATE FUNCTION public.desactivar_usuario_plataforma(p_usuario_id text, p_actor_id text)
RETURNS TABLE(desactivado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET activo = false, "sessionVersion" = "sessionVersion" + 1
  WHERE id = p_usuario_id AND activo = true;
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;
ALTER FUNCTION public.desactivar_usuario_plataforma(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.desactivar_usuario_plataforma(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desactivar_usuario_plataforma(text, text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.reactivar_usuario_plataforma(text, text);
CREATE FUNCTION public.reactivar_usuario_plataforma(p_usuario_id text, p_actor_id text)
RETURNS TABLE(reactivado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma SET activo = true WHERE id = p_usuario_id AND activo = false;
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;
ALTER FUNCTION public.reactivar_usuario_plataforma(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.reactivar_usuario_plataforma(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reactivar_usuario_plataforma(text, text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.enrolar_mfa_plataforma(text, text);
CREATE FUNCTION public.enrolar_mfa_plataforma(p_usuario_id text, p_secreto_candidato text)
RETURNS TABLE(ok boolean, motivo text, "secretoEfectivo" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_habilitado boolean;
  v_secreto_actual text;
BEGIN
  SELECT "mfaHabilitado", "mfaSecret" INTO v_habilitado, v_secreto_actual
  FROM public.usuarios_plataforma WHERE id = p_usuario_id FOR UPDATE;
  IF v_habilitado IS NULL THEN
    RETURN QUERY SELECT false, 'USUARIO_INEXISTENTE', NULL::text; RETURN;
  END IF;
  IF v_habilitado THEN
    RETURN QUERY SELECT false, 'MFA_YA_ACTIVO', NULL::text; RETURN;
  END IF;
  IF v_secreto_actual IS NOT NULL THEN
    RETURN QUERY SELECT true, 'PENDIENTE_EXISTENTE', v_secreto_actual; RETURN;
  END IF;
  UPDATE public.usuarios_plataforma SET "mfaSecret" = p_secreto_candidato WHERE id = p_usuario_id;
  RETURN QUERY SELECT true, 'NUEVO_SECRETO_REGISTRADO', p_secreto_candidato;
END;
$$;
ALTER FUNCTION public.enrolar_mfa_plataforma(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.enrolar_mfa_plataforma(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enrolar_mfa_plataforma(text, text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.activar_mfa_plataforma(text, integer);
CREATE FUNCTION public.activar_mfa_plataforma(p_usuario_id text, p_contador integer)
RETURNS TABLE(activado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET "mfaHabilitado" = true, "mfaUltimoContadorUsado" = p_contador
  WHERE id = p_usuario_id AND "mfaHabilitado" = false AND "mfaSecret" IS NOT NULL
    AND (p_contador > "mfaUltimoContadorUsado" OR "mfaUltimoContadorUsado" IS NULL);
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;
ALTER FUNCTION public.activar_mfa_plataforma(text, integer) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.activar_mfa_plataforma(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activar_mfa_plataforma(text, integer) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.consumir_contador_totp_plataforma(text, integer);
CREATE FUNCTION public.consumir_contador_totp_plataforma(p_usuario_id text, p_contador integer)
RETURNS TABLE(consumido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.usuarios_plataforma
  SET "mfaUltimoContadorUsado" = p_contador
  WHERE id = p_usuario_id AND "mfaHabilitado" = true
    AND (p_contador > "mfaUltimoContadorUsado" OR "mfaUltimoContadorUsado" IS NULL);
  IF FOUND THEN RETURN QUERY SELECT true; ELSE RETURN QUERY SELECT false; END IF;
END;
$$;
ALTER FUNCTION public.consumir_contador_totp_plataforma(text, integer) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.consumir_contador_totp_plataforma(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consumir_contador_totp_plataforma(text, integer) TO chainpulse_app;
