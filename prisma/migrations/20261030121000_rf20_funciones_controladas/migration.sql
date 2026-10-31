-- RF20: funciones controladas de gobernanza de versiones.
-- Fuente normativa: adenda-diseno-rf19-rf20-v7.md, secciones 7.3-7.8.

REVOKE INSERT, UPDATE, DELETE ON public.cuestionario_versiones FROM chainpulse_app;
REVOKE INSERT, UPDATE, DELETE ON public.pregunta_versiones FROM chainpulse_app;
GRANT SELECT ON public.cuestionario_versiones TO chainpulse_app;
GRANT SELECT ON public.pregunta_versiones TO chainpulse_app;

DROP FUNCTION IF EXISTS public.crear_cuestionario_version(text, text, text);

CREATE FUNCTION public.crear_cuestionario_version(p_id text, p_codigo text, p_curador_id text)
RETURNS TABLE(numero integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_siguiente_numero integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_codigo));

  SELECT COALESCE(max(numero), 0) + 1 INTO v_siguiente_numero
  FROM public.cuestionario_versiones WHERE codigo = p_codigo;

  INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado, "curadorId")
  VALUES (p_id, p_codigo, v_siguiente_numero, 'BORRADOR', p_curador_id);

  RETURN QUERY SELECT v_siguiente_numero;
END;
$$;

ALTER FUNCTION public.crear_cuestionario_version(text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.crear_cuestionario_version(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_cuestionario_version(text, text, text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.corregir_cuestionario_version(text, text, text, text);

CREATE FUNCTION public.corregir_cuestionario_version(
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
  SELECT codigo INTO v_codigo FROM public.cuestionario_versiones
  WHERE id = p_version_origen_id FOR UPDATE;

  IF v_codigo IS NULL THEN
    RAISE EXCEPTION 'RF20_ORIGEN_INEXISTENTE: version origen % no existe', p_version_origen_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_codigo));

  SELECT COALESCE(max(numero), 0) + 1 INTO v_siguiente_numero
  FROM public.cuestionario_versiones WHERE codigo = v_codigo;

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

DROP FUNCTION IF EXISTS public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean);

CREATE FUNCTION public.crear_pregunta_version(
  p_id text, p_version_id text, p_codigo text, p_orden integer, p_texto text,
  p_dimension text, p_opciones jsonb, p_es_no_puntuable boolean
)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_dimension_valida public."DimensionDiagnosticoV2";
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  -- Conversion EXPLICITA y VALIDADA del texto recibido al enum real --
  -- nunca se asume que p_dimension ya es un valor valido: un texto que
  -- no coincide con ningun valor de DimensionDiagnosticoV2 produce un
  -- error de aplicacion identificable, nunca una excepcion cruda de
  -- Postgres propagada sin clasificar.
  BEGIN
    v_dimension_valida := p_dimension::public."DimensionDiagnosticoV2";
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN QUERY SELECT false, 'DIMENSION_INVALIDA'; RETURN;
  END;

  INSERT INTO public.pregunta_versiones
    (id, "cuestionarioVersionId", codigo, orden, texto, dimension, opciones, "esNoPuntuable")
  VALUES (p_id, p_version_id, p_codigo, p_orden, p_texto, v_dimension_valida, p_opciones, p_es_no_puntuable);

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_pregunta_version(text, text, text, integer, text, text, jsonb, boolean) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.editar_pregunta_version(text, text, text, jsonb, boolean);

CREATE FUNCTION public.editar_pregunta_version(
  p_pregunta_id text, p_texto text, p_dimension text, p_opciones jsonb, p_es_no_puntuable boolean
)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_id text;
  v_estado text;
  v_dimension_valida public."DimensionDiagnosticoV2";
BEGIN
  SELECT "cuestionarioVersionId" INTO v_version_id FROM public.pregunta_versiones WHERE id = p_pregunta_id;
  IF v_version_id IS NULL THEN RETURN QUERY SELECT false, 'PREGUNTA_INEXISTENTE'; RETURN; END IF;

  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = v_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  BEGIN
    v_dimension_valida := p_dimension::public."DimensionDiagnosticoV2";
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN QUERY SELECT false, 'DIMENSION_INVALIDA'; RETURN;
  END;

  UPDATE public.pregunta_versiones
  SET texto = p_texto, dimension = v_dimension_valida, opciones = p_opciones, "esNoPuntuable" = p_es_no_puntuable
  WHERE id = p_pregunta_id;

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.editar_pregunta_version(text, text, text, jsonb, boolean) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.editar_pregunta_version(text, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_pregunta_version(text, text, text, jsonb, boolean) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.eliminar_pregunta_version(text);

CREATE FUNCTION public.eliminar_pregunta_version(p_pregunta_id text)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_id text;
  v_estado text;
BEGIN
  SELECT "cuestionarioVersionId" INTO v_version_id FROM public.pregunta_versiones WHERE id = p_pregunta_id;
  IF v_version_id IS NULL THEN RETURN QUERY SELECT false, 'PREGUNTA_INEXISTENTE'; RETURN; END IF;

  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = v_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  DELETE FROM public.pregunta_versiones WHERE id = p_pregunta_id;
  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.eliminar_pregunta_version(text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.eliminar_pregunta_version(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_pregunta_version(text) TO chainpulse_app;


DROP FUNCTION IF EXISTS public.editar_metadata_cuestionario_version(text, text);

CREATE FUNCTION public.editar_metadata_cuestionario_version(p_version_id text, p_notas_cambio text)
RETURNS TABLE(ok boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL THEN RETURN QUERY SELECT false, 'VERSION_INEXISTENTE'; RETURN; END IF;
  IF v_estado <> 'BORRADOR' THEN RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN; END IF;
  UPDATE public.cuestionario_versiones SET "notasCambio" = p_notas_cambio WHERE id = p_version_id;
  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.editar_metadata_cuestionario_version(text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.editar_metadata_cuestionario_version(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_metadata_cuestionario_version(text, text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.reordenar_preguntas_version(text, jsonb);

CREATE FUNCTION public.reordenar_preguntas_version(p_version_id text, p_ordenes jsonb)
RETURNS TABLE(reordenado boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_ids_recibidos text[];
  v_ids_esperados text[];
  v_ordenes_recibidos integer[];
  v_entrada jsonb;
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'BORRADOR' THEN
    RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN;
  END IF;

  IF p_ordenes IS NULL OR jsonb_typeof(p_ordenes) <> 'array' OR jsonb_array_length(p_ordenes) = 0 THEN
    RETURN QUERY SELECT false, 'PAYLOAD_VACIO_O_INVALIDO'; RETURN;
  END IF;

  SELECT array_agg(e->>'id'), array_agg((e->>'orden')::integer)
  INTO v_ids_recibidos, v_ordenes_recibidos
  FROM jsonb_array_elements(p_ordenes) e;

  -- Sin IDs duplicados en el payload recibido.
  IF (SELECT count(DISTINCT x) FROM unnest(v_ids_recibidos) x) <> array_length(v_ids_recibidos, 1) THEN
    RETURN QUERY SELECT false, 'IDS_DUPLICADOS_EN_PAYLOAD'; RETURN;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_ids_esperados
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;

  -- El conjunto recibido debe ser EXACTAMENTE el conjunto de preguntas de
  -- esta version: ni IDs desconocidos, ni preguntas faltantes. Ningun ID
  -- desconocido se ignora silenciosamente: cualquier discrepancia aborta
  -- antes de escribir nada.
  IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_ids_recibidos) x) IS DISTINCT FROM v_ids_esperados THEN
    RETURN QUERY SELECT false, 'CONJUNTO_DE_PREGUNTAS_NO_COINCIDE'; RETURN;
  END IF;

  -- Ordenes: enteros positivos, secuencia exacta 1..N sin huecos ni duplicados.
  IF EXISTS (SELECT 1 FROM unnest(v_ordenes_recibidos) o WHERE o IS NULL OR o < 1) THEN
    RETURN QUERY SELECT false, 'ORDEN_NO_POSITIVO'; RETURN;
  END IF;
  IF (SELECT array_agg(o ORDER BY o) FROM unnest(v_ordenes_recibidos) o)
     <> (SELECT array_agg(g) FROM generate_series(1, array_length(v_ordenes_recibidos, 1)) g) THEN
    RETURN QUERY SELECT false, 'SECUENCIA_CON_HUECOS_O_DUPLICADOS'; RETURN;
  END IF;

  FOR v_entrada IN SELECT * FROM jsonb_array_elements(p_ordenes) LOOP
    UPDATE public.pregunta_versiones
    SET orden = (v_entrada->>'orden')::integer
    WHERE id = (v_entrada->>'id') AND "cuestionarioVersionId" = p_version_id;
  END LOOP;

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.reordenar_preguntas_version(text, jsonb) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.reordenar_preguntas_version(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reordenar_preguntas_version(text, jsonb) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.validar_estructura_opciones_pregunta(jsonb);

CREATE FUNCTION public.validar_estructura_opciones_pregunta(p_opciones jsonb)
RETURNS TABLE(valido boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_elemento jsonb;
  v_valores text[] := '{}';
  v_ordenes integer[] := '{}';
  v_orden_num numeric;
  v_n integer;
BEGIN
  -- 1. Tipo raiz: debe ser un array JSON. jsonb_typeof() nunca lanza
  -- excepcion sobre ningun valor jsonb (ni sobre NULL de SQL, donde
  -- devuelve NULL de SQL) -- es la unica comprobacion de esta funcion
  -- que se ejecuta ANTES de saber que p_opciones es efectivamente un
  -- array; ninguna otra funcion de jsonb (length, elements) se llama
  -- todavia en este punto.
  IF p_opciones IS NULL OR jsonb_typeof(p_opciones) <> 'array' THEN
    RETURN QUERY SELECT false, 'OPCIONES_NO_ES_ARRAY'; RETURN;
  END IF;

  -- A partir de aqui jsonb_array_length/jsonb_array_elements son
  -- seguras: el tipo raiz ya quedo confirmado como 'array'.
  IF jsonb_array_length(p_opciones) = 0 THEN
    RETURN QUERY SELECT false, 'OPCIONES_VACIO'; RETURN;
  END IF;

  -- 2. Cada elemento: objeto, con valor/texto (string no vacio) y orden
  -- (entero >= 0). Ningun campo se castea sin haber comprobado antes su
  -- tipo real con jsonb_typeof -- incluido cualquier campo booleano
  -- adicional que un futuro cambio pudiera agregar a OpcionPregunta
  -- (hoy, ninguno: valor/texto/orden son los tres unicos campos reales).
  -- Un futuro campo booleano deberia comprobarse asi, nunca con un cast
  -- directo "(x->>'campo')::boolean":
  --   IF v_elemento ? 'campoNuevo' AND jsonb_typeof(v_elemento->'campoNuevo') <> 'boolean' THEN
  --     RETURN QUERY SELECT false, 'OPCIONES_CAMPO_BOOLEANO_TIPO_INVALIDO'; RETURN;
  --   END IF;
  FOR v_elemento IN SELECT value FROM jsonb_array_elements(p_opciones)
  LOOP
    IF jsonb_typeof(v_elemento) <> 'object' THEN
      RETURN QUERY SELECT false, 'OPCIONES_ELEMENTO_NO_ES_OBJETO'; RETURN;
    END IF;

    IF NOT (v_elemento ? 'valor')
       OR jsonb_typeof(v_elemento->'valor') <> 'string'
       OR btrim(v_elemento->>'valor') = '' THEN
      RETURN QUERY SELECT false, 'OPCIONES_VALOR_INVALIDO'; RETURN;
    END IF;

    IF NOT (v_elemento ? 'texto')
       OR jsonb_typeof(v_elemento->'texto') <> 'string'
       OR btrim(v_elemento->>'texto') = '' THEN
      RETURN QUERY SELECT false, 'OPCIONES_TEXTO_INVALIDO'; RETURN;
    END IF;

    IF NOT (v_elemento ? 'orden')
       OR jsonb_typeof(v_elemento->'orden') <> 'number' THEN
      RETURN QUERY SELECT false, 'OPCIONES_ORDEN_NO_ENTERO'; RETURN;
    END IF;
    -- jsonb_typeof ya confirmo 'number' para "orden": el cast a numeric
    -- que sigue es seguro y nunca lanza invalid_text_representation.
    v_orden_num := (v_elemento->>'orden')::numeric;
    IF v_orden_num <> trunc(v_orden_num) OR v_orden_num < 0 THEN
      RETURN QUERY SELECT false, 'OPCIONES_ORDEN_NO_ENTERO'; RETURN;
    END IF;

    v_valores := v_valores || (v_elemento->>'valor');
    v_ordenes := v_ordenes || v_orden_num::integer;
  END LOOP;

  -- 3. Sin "valor" duplicados.
  v_n := array_length(v_valores, 1);
  IF (SELECT count(DISTINCT x) FROM unnest(v_valores) x) <> v_n THEN
    RETURN QUERY SELECT false, 'OPCIONES_VALOR_DUPLICADO'; RETURN;
  END IF;

  -- 4. Sin "orden" duplicados.
  IF (SELECT count(DISTINCT x) FROM unnest(v_ordenes) x) <> v_n THEN
    RETURN QUERY SELECT false, 'OPCIONES_ORDEN_DUPLICADO'; RETURN;
  END IF;

  -- 5. "orden" forma exactamente el conjunto 0..N-1, sin huecos.
  IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_ordenes) x)
     <> (SELECT array_agg(g) FROM generate_series(0, v_n - 1) g) THEN
    RETURN QUERY SELECT false, 'OPCIONES_ORDEN_NO_CONTIGUO'; RETURN;
  END IF;

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.validar_estructura_opciones_pregunta(jsonb) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.validar_estructura_opciones_pregunta(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_estructura_opciones_pregunta(jsonb) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.publicar_cuestionario_version(text, text, text, text, text);

CREATE FUNCTION public.publicar_cuestionario_version(
  p_version_id text, p_actor_id text, p_version_vigente_esperada_id text,
  p_id_evento_publicar text, p_id_evento_retiro text
)
RETURNS TABLE(publicada boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_codigo text;
  v_vigente_actual_id text;
  v_conteo_preguntas integer;
  v_conteo_codigos_distintos integer;
  v_ordenes integer[];
  v_cobertura_dimensiones integer;
  v_pregunta record;
  v_opciones_validas boolean;
  v_motivo_opciones text;
  v_valor_marcador_q1 text;
BEGIN
  -- 1. La version a publicar debe existir y estar en BORRADOR.
  SELECT estado, codigo INTO v_estado, v_codigo
  FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;

  IF v_estado IS NULL THEN RETURN QUERY SELECT false, 'VERSION_INEXISTENTE'; RETURN; END IF;
  IF v_estado <> 'BORRADOR' THEN RETURN QUERY SELECT false, 'VERSION_NO_ES_BORRADOR'; RETURN; END IF;

  -- 2. Determinar la version vigente ACTUAL (puede no existir ninguna).
  SELECT id INTO v_vigente_actual_id
  FROM public.cuestionario_versiones
  WHERE codigo = v_codigo AND estado = 'PUBLICADA'
  FOR UPDATE;

  -- 3. Comparacion NULL-segura: "<>" con NULL nunca es verdadero en
  -- Postgres, asi que dejaria pasar sin detectar el caso "yo esperaba
  -- NULL pero ahora hay una version X". IS DISTINCT FROM si lo detecta.
  IF v_vigente_actual_id IS DISTINCT FROM p_version_vigente_esperada_id THEN
    RETURN QUERY SELECT false, 'VERSION_VIGENTE_CAMBIO'; RETURN;
  END IF;

  -- 4. Preguntas: deben existir, codigos unicos, orden completo 1..N sin
  -- huecos ni duplicados, texto no vacio, cobertura de las 5 dimensiones.
  SELECT count(*) INTO v_conteo_preguntas
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;
  IF v_conteo_preguntas = 0 THEN RETURN QUERY SELECT false, 'SIN_PREGUNTAS'; RETURN; END IF;

  SELECT count(DISTINCT codigo) INTO v_conteo_codigos_distintos
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;
  IF v_conteo_codigos_distintos <> v_conteo_preguntas THEN
    RETURN QUERY SELECT false, 'CODIGOS_DUPLICADOS'; RETURN;
  END IF;

  SELECT array_agg(orden ORDER BY orden) INTO v_ordenes
  FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id;
  IF v_ordenes <> (SELECT array_agg(g) FROM generate_series(1, v_conteo_preguntas) g) THEN
    RETURN QUERY SELECT false, 'ORDEN_INVALIDO'; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND (texto IS NULL OR btrim(texto) = '')
  ) THEN
    RETURN QUERY SELECT false, 'TEXTO_VACIO'; RETURN;
  END IF;

  SELECT count(DISTINCT dimension) INTO v_cobertura_dimensiones
  FROM public.pregunta_versiones
  WHERE "cuestionarioVersionId" = p_version_id AND "esNoPuntuable" = false;
  IF v_cobertura_dimensiones <> 5 THEN RETURN QUERY SELECT false, 'DIMENSIONES_INCOMPLETAS'; RETURN; END IF;

  -- 4.5. Validacion JSON autoritativa de "opciones" para CADA pregunta
  -- de la version, ANTES de que el paso 5 llame a
  -- jsonb_array_length/jsonb_array_elements o haga ningun cast
  -- especifico del motor v2 sobre "opciones". Ninguna pregunta con
  -- opciones mal formadas llega a los chequeos de negocio de abajo.
  FOR v_pregunta IN SELECT codigo, opciones FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id
  LOOP
    SELECT valido, motivo INTO v_opciones_validas, v_motivo_opciones
    FROM public.validar_estructura_opciones_pregunta(v_pregunta.opciones);
    IF NOT v_opciones_validas THEN
      RETURN QUERY SELECT false, v_motivo_opciones || '_EN_' || v_pregunta.codigo; RETURN;
    END IF;
  END LOOP;

  -- 5. Validaciones especificas del motor V2 por cada pregunta Q1..Q7,
  -- derivadas de src/engine/v2/alineacion.ts, dimensionSimple.ts e
  -- integracion.ts -- bloque completo, sin omisiones. A partir de aqui
  -- jsonb_array_length/jsonb_array_elements y los cast de "orden"/"valor"
  -- ya son seguros: el paso 4.5 garantizo, para CADA pregunta de esta
  -- version, que "opciones" es un array de objetos con valor/texto
  -- (string no vacio) y orden (entero 0..N-1 sin huecos ni duplicados).

  -- Q1: exactamente 8 opciones, y la opcion de orden=7 debe tener
  -- valor='no_definida' -- el marcador real y ya existente en el
  -- cuestionario sembrado (prisma/seedCuestionarioV2.ts), consumido por
  -- esQ1Gatillo() en src/engine/v2/alineacion.ts via
  -- Q1_INDICE_PROMESA_NO_DEFINIDA=7. No existe ningun campo booleano
  -- "esGatilloAlineacion": esta adenda no introduce ninguno. La busqueda
  -- es por el campo "orden" (no por la posicion cruda del arreglo
  -- "->7"): el paso 4.5 garantiza que el conjunto de "orden" es 0..7 sin
  -- huecos, pero no que esten almacenados en ese mismo orden posicional
  -- dentro del arreglo JSON.
  FOR v_pregunta IN SELECT codigo, opciones FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q1'
  LOOP
    IF jsonb_array_length(v_pregunta.opciones) <> 8 THEN
      RETURN QUERY SELECT false, 'Q1_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
    END IF;

    SELECT elem->>'valor' INTO v_valor_marcador_q1
    FROM jsonb_array_elements(v_pregunta.opciones) elem
    WHERE (elem->>'orden')::int = 7;

    IF v_valor_marcador_q1 IS DISTINCT FROM 'no_definida' THEN
      RETURN QUERY SELECT false, 'Q1_MARCADOR_NO_DEFINIDA_AUSENTE_O_INCORRECTO'; RETURN;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.pregunta_versiones WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q1'
  ) THEN
    RETURN QUERY SELECT false, 'Q1_AUSENTE'; RETURN;
  END IF;

  -- Q2 y Q3: exactamente 5 opciones cada una.
  IF (SELECT count(*) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q2','Q3')
        AND jsonb_array_length(opciones) <> 5) > 0 THEN
    RETURN QUERY SELECT false, 'Q2_O_Q3_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
  END IF;
  IF (SELECT count(DISTINCT codigo) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q2','Q3')) <> 2 THEN
    RETURN QUERY SELECT false, 'Q2_O_Q3_AUSENTE'; RETURN;
  END IF;

  -- Q4, Q6, Q7 y la parte puntuable de Q5: exactamente 5 opciones cada una.
  IF (SELECT count(*) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q4','Q5','Q6','Q7')
        AND "esNoPuntuable" = false AND jsonb_array_length(opciones) <> 5) > 0 THEN
    RETURN QUERY SELECT false, 'Q4_A_Q7_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
  END IF;
  IF (SELECT count(DISTINCT codigo) FROM public.pregunta_versiones
      WHERE "cuestionarioVersionId" = p_version_id AND codigo IN ('Q4','Q5','Q6','Q7')
        AND "esNoPuntuable" = false) <> 4 THEN
    RETURN QUERY SELECT false, 'Q4_A_Q7_AUSENTE'; RETURN;
  END IF;

  -- Q5-fuente: debe existir, marcada esNoPuntuable = true (ya excluida de
  -- la cobertura de dimensiones del paso 4 por el filtro
  -- esNoPuntuable=false), y con exactamente 6 opciones estructuradas --
  -- no es una subpregunta de texto libre: tiene la misma forma
  -- {valor, texto, orden} que cualquier otra pregunta (sap_erp, excel,
  -- wms_tms_aps, correo_mensajeria, varios_sistemas, sin_fuente_definida
  -- en prisma/seedCuestionarioV2.ts).
  FOR v_pregunta IN SELECT codigo, opciones FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q5-fuente' AND "esNoPuntuable" = true
  LOOP
    IF jsonb_array_length(v_pregunta.opciones) <> 6 THEN
      RETURN QUERY SELECT false, 'Q5_FUENTE_CANTIDAD_OPCIONES_INVALIDA'; RETURN;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.pregunta_versiones
    WHERE "cuestionarioVersionId" = p_version_id AND codigo = 'Q5-fuente' AND "esNoPuntuable" = true
  ) THEN
    RETURN QUERY SELECT false, 'Q5_FUENTE_AUSENTE_O_MAL_MARCADA'; RETURN;
  END IF;

  -- 6. Transicion: retirar la vigente anterior (si existia) y publicar
  -- la nueva, con sus eventos de bitacora, en la misma transaccion que
  -- ya tiene ambas filas bloqueadas desde el paso 1 y el paso 2.
  IF v_vigente_actual_id IS NOT NULL THEN
    UPDATE public.cuestionario_versiones SET estado = 'RETIRADA', "retiradaEn" = now()
    WHERE id = v_vigente_actual_id;

    INSERT INTO public.bitacora_version_cuestionario (id, "cuestionarioVersionId", "actorId", accion, "createdAt")
    VALUES (p_id_evento_retiro, v_vigente_actual_id, p_actor_id, 'RETIRAR', now());
  END IF;

  UPDATE public.cuestionario_versiones
  SET estado = 'PUBLICADA', "publicadaEn" = now(), "curadorId" = p_actor_id
  WHERE id = p_version_id;

  INSERT INTO public.bitacora_version_cuestionario (id, "cuestionarioVersionId", "actorId", accion, "createdAt")
  VALUES (p_id_evento_publicar, p_version_id, p_actor_id, 'PUBLICAR', now());

  -- 7. Red de seguridad final: si, pese a los locks FOR UPDATE de los
  -- pasos 1-2, el indice parcial uq_cuestionario_version_publicada
  -- detectara una segunda fila PUBLICADA con el mismo codigo, el UPDATE
  -- de este mismo paso ya habria lanzado 23505 y abortado la transaccion
  -- completa antes de llegar aqui -- no se necesita chequeo adicional.

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publicar_cuestionario_version(text, text, text, text, text) TO chainpulse_app;

DROP FUNCTION IF EXISTS public.retirar_cuestionario_version(text, text, text);

CREATE FUNCTION public.retirar_cuestionario_version(p_version_id text, p_actor_id text, p_id_evento_retiro text)
RETURNS TABLE(retirada boolean, motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM public.cuestionario_versiones WHERE id = p_version_id FOR UPDATE;
  IF v_estado IS NULL THEN RETURN QUERY SELECT false, 'VERSION_INEXISTENTE'; RETURN; END IF;
  IF v_estado <> 'PUBLICADA' THEN RETURN QUERY SELECT false, 'VERSION_NO_ESTA_PUBLICADA'; RETURN; END IF;

  UPDATE public.cuestionario_versiones SET estado = 'RETIRADA', "retiradaEn" = now() WHERE id = p_version_id;

  INSERT INTO public.bitacora_version_cuestionario (id, "cuestionarioVersionId", "actorId", accion, "createdAt")
  VALUES (p_id_evento_retiro, p_version_id, p_actor_id, 'RETIRAR', now());

  RETURN QUERY SELECT true, 'OK';
END;
$$;

ALTER FUNCTION public.retirar_cuestionario_version(text, text, text) OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.retirar_cuestionario_version(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retirar_cuestionario_version(text, text, text) TO chainpulse_app;
