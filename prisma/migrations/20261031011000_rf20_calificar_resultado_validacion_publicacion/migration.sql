-- RF20: corrige la ambiguedad PL/pgSQL entre el parametro de salida
-- `motivo` de publicar_cuestionario_version() y la columna `motivo`
-- devuelta por validar_estructura_opciones_pregunta().
-- Hallazgo confirmado exclusivamente en la rama temporal Neon del PR 7.

DO $migration$
DECLARE
  v_firma regprocedure;
  v_definicion text;
  v_fragmento_anterior text := E'    SELECT valido, motivo INTO v_opciones_validas, v_motivo_opciones\n    FROM public.validar_estructura_opciones_pregunta(v_pregunta.opciones);';
  v_fragmento_corregido text := E'    SELECT validacion.valido, validacion.motivo\n    INTO v_opciones_validas, v_motivo_opciones\n    FROM public.validar_estructura_opciones_pregunta(v_pregunta.opciones) AS validacion;';
BEGIN
  v_firma := to_regprocedure(
    'public.publicar_cuestionario_version(text,text,text,text,text)'
  );

  IF v_firma IS NULL THEN
    RAISE EXCEPTION 'RF20_PUBLICAR_FUNCION_INEXISTENTE';
  END IF;

  SELECT pg_get_functiondef(v_firma) INTO v_definicion;
  -- La funcion pudo haberse creado desde un checkout Windows. Normalizar
  -- solo el DDL reconstruido evita que CRLF impida encontrar el fragmento.
  v_definicion := replace(v_definicion, E'\r\n', E'\n');

  IF strpos(v_definicion, v_fragmento_corregido) > 0 THEN
    RAISE NOTICE 'RF20_PUBLICAR_RESULTADO_VALIDACION_YA_CALIFICADO';
    RETURN;
  END IF;

  IF strpos(v_definicion, v_fragmento_anterior) = 0 THEN
    RAISE EXCEPTION 'RF20_PUBLICAR_FRAGMENTO_ESPERADO_AUSENTE';
  END IF;

  IF strpos(
    substr(
      v_definicion,
      strpos(v_definicion, v_fragmento_anterior) + length(v_fragmento_anterior)
    ),
    v_fragmento_anterior
  ) > 0 THEN
    RAISE EXCEPTION 'RF20_PUBLICAR_FRAGMENTO_ESPERADO_DUPLICADO';
  END IF;

  v_definicion := replace(
    v_definicion,
    v_fragmento_anterior,
    v_fragmento_corregido
  );

  EXECUTE v_definicion;
END;
$migration$;

ALTER FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) TO chainpulse_app;
