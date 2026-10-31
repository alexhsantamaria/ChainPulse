-- RF20: corrige la ambiguedad PL/pgSQL entre el parametro de salida
-- `numero` de RETURNS TABLE y la columna cuestionario_versiones.numero.
-- Hallazgo confirmado en la primera ejecucion real sobre una rama temporal
-- Neon; ninguna de estas funciones se habia habilitado en produccion.

CREATE OR REPLACE FUNCTION public.crear_cuestionario_version(p_id text, p_codigo text, p_curador_id text)
RETURNS TABLE(numero integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_siguiente_numero integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_codigo));

  SELECT COALESCE(max(cv.numero), 0) + 1 INTO v_siguiente_numero
  FROM public.cuestionario_versiones AS cv WHERE cv.codigo = p_codigo;

  INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado, "curadorId")
  VALUES (p_id, p_codigo, v_siguiente_numero, 'BORRADOR', p_curador_id);

  RETURN QUERY SELECT v_siguiente_numero;
END;
$$;

ALTER FUNCTION public.crear_cuestionario_version(text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.crear_cuestionario_version(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_cuestionario_version(text, text, text) TO chainpulse_app;

CREATE OR REPLACE FUNCTION public.corregir_cuestionario_version(
  p_id_nueva_version text, p_id_evento_correccion text,
  p_version_origen_id text, p_curador_id text
)
RETURNS TABLE(numero integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
  v_siguiente_numero integer;
BEGIN
  SELECT cv.codigo INTO v_codigo FROM public.cuestionario_versiones AS cv
  WHERE cv.id = p_version_origen_id FOR UPDATE;

  IF v_codigo IS NULL THEN
    RAISE EXCEPTION 'RF20_ORIGEN_INEXISTENTE: version origen % no existe', p_version_origen_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_codigo));

  SELECT COALESCE(max(cv.numero), 0) + 1 INTO v_siguiente_numero
  FROM public.cuestionario_versiones AS cv WHERE cv.codigo = v_codigo;

  INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado, "curadorId")
  VALUES (p_id_nueva_version, v_codigo, v_siguiente_numero, 'BORRADOR', p_curador_id);

  INSERT INTO public.bitacora_version_cuestionario
    (id, "cuestionarioVersionId", "actorId", accion, "versionOrigenId", "createdAt")
  VALUES (p_id_evento_correccion, p_id_nueva_version, p_curador_id, 'CORREGIR', p_version_origen_id, now());

  RETURN QUERY SELECT v_siguiente_numero;
END;
$$;

ALTER FUNCTION public.corregir_cuestionario_version(text, text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.corregir_cuestionario_version(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corregir_cuestionario_version(text, text, text, text) TO chainpulse_app;
