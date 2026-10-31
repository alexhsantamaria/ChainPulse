-- RF20 -- pruebas LOCALES y ESTATICAS de validar_estructura_opciones_pregunta().
--
-- PROPOSITO: demostrar, sin tocar Neon ni ejecutar Prisma/migraciones/seeds
-- del proyecto, que la correccion de H1 (existencia explicita de clave con
-- el operador `?` antes de jsonb_typeof) hace que "valor", "texto" y
-- "orden" ausentes disparen, cada uno, el motivo de rechazo correcto --
-- en vez del bypass silencioso (para "texto") o el motivo incorrecto
-- (para "valor"/"orden") que tenia la version anterior de la funcion.
--
-- COMO EJECUTAR: SOLO contra una base de datos local/desechable, nunca
-- contra Neon ni contra la base real del proyecto. Ejemplo:
--   createdb rf20_pruebas_locales_scratch
--   psql -v ON_ERROR_STOP=1 -d rf20_pruebas_locales_scratch \
--        -f rf20-validar-estructura-opciones-pregunta.local-tests.sql
--   dropdb rf20_pruebas_locales_scratch
-- Este script crea la funcion dentro de un esquema desechable propio
-- ("rf20_pruebas_locales"), corre las aserciones, y hace DROP SCHEMA al
-- final (CASCADE) para no dejar residuos. No depende de ninguna tabla
-- real (cuestionario_versiones, pregunta_versiones, etc.) ni de los
-- roles chainpulse_app/neondb_owner: valida unicamente la logica PL/pgSQL
-- de la funcion, copiada verbatim de
-- prisma/migrations/20261030121000_rf20_funciones_controladas/migration.sql.
--
-- Si alguna asercion falla, el script aborta con RAISE EXCEPTION (ON_ERROR_STOP
-- ademas detiene psql en el primer error de servidor).

BEGIN;

CREATE SCHEMA rf20_pruebas_locales;
SET LOCAL search_path = rf20_pruebas_locales, pg_temp;

-- ============================================================================
-- Copia verbatim de la funcion corregida (extraida programaticamente de
-- prisma/migrations/20261030121000_rf20_funciones_controladas/migration.sql,
-- sin transcripcion manual) con el nombre calificado por esquema cambiado a
-- este esquema desechable y SECURITY DEFINER retirado (irrelevante para una
-- prueba local sin roles de aplicacion; el resto del cuerpo es identico).
-- ============================================================================

CREATE FUNCTION rf20_pruebas_locales.validar_estructura_opciones_pregunta(p_opciones jsonb)
RETURNS TABLE(valido boolean, motivo text)
LANGUAGE plpgsql
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

-- ============================================================================
-- Arnes de aserciones minimo (sin pgTAP ni dependencias externas).
-- ============================================================================
CREATE FUNCTION rf20_pruebas_locales.assert_motivo(
  p_caso text, p_opciones jsonb, p_motivo_esperado text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_valido boolean;
  v_motivo text;
BEGIN
  SELECT valido, motivo INTO v_valido, v_motivo
  FROM rf20_pruebas_locales.validar_estructura_opciones_pregunta(p_opciones);

  IF v_motivo IS DISTINCT FROM p_motivo_esperado THEN
    RAISE EXCEPTION 'FALLO [%]: esperado motivo=%, obtenido motivo=% (valido=%)',
      p_caso, p_motivo_esperado, v_motivo, v_valido;
  END IF;

  RAISE NOTICE 'OK   [%]: motivo=% (valido=%)', p_caso, v_motivo, v_valido;
END;
$$;

-- ----------------------------------------------------------------------------
-- Casos nuevos exigidos por la correccion de H1: clave completamente ausente.
-- ----------------------------------------------------------------------------

-- "valor" ausente en una opcion -- antes de la correccion, el bypass de NULL
-- dejaba pasar esta rama y el rechazo ocurria mas abajo con el motivo
-- incorrecto OPCIONES_VALOR_DUPLICADO (por el undercount de count(DISTINCT)
-- al ignorar el elemento NULL). Ahora debe ser OPCIONES_VALOR_INVALIDO,
-- detectado en el elemento exacto que carece del campo.
SELECT rf20_pruebas_locales.assert_motivo(
  'valor ausente',
  '[{"texto":"Opcion A","orden":0},{"valor":"b","texto":"Opcion B","orden":1}]'::jsonb,
  'OPCIONES_VALOR_INVALIDO'
);

-- "texto" ausente -- antes de la correccion, NINGUN otro chequeo de la
-- funcion volvia a referenciar "texto": la funcion devolvia (true, 'OK')
-- y publicar_cuestionario_version() habria aceptado la opcion sin texto
-- visible. Este es el caso de bypass silencioso real (no solo motivo
-- incorrecto). Ahora debe ser OPCIONES_TEXTO_INVALIDO.
SELECT rf20_pruebas_locales.assert_motivo(
  'texto ausente (bypass silencioso original)',
  '[{"valor":"a","orden":0},{"valor":"b","texto":"Opcion B","orden":1}]'::jsonb,
  'OPCIONES_TEXTO_INVALIDO'
);

-- "orden" ausente -- antes de la correccion, el bypass de NULL dejaba pasar
-- esta rama; el NULL se propagaba hasta el cast final (NULL::numeric,
-- seguro, nunca lanza excepcion) y el rechazo ocurria mas abajo con un
-- motivo incorrecto (OPCIONES_ORDEN_DUPLICADO u OPCIONES_ORDEN_NO_CONTIGUO,
-- segun el resto del payload). Ahora debe ser OPCIONES_ORDEN_NO_ENTERO,
-- detectado en el elemento exacto que carece del campo.
SELECT rf20_pruebas_locales.assert_motivo(
  'orden ausente',
  '[{"valor":"a","texto":"Opcion A"},{"valor":"b","texto":"Opcion B","orden":1}]'::jsonb,
  'OPCIONES_ORDEN_NO_ENTERO'
);

-- ----------------------------------------------------------------------------
-- Casos de regresion: lo que ya funcionaba antes de H1 debe seguir
-- funcionando igual despues del parche (el `?` no debe alterar ningun
-- camino que ya evaluaba jsonb_typeof sobre un valor jsonb real).
-- ----------------------------------------------------------------------------

SELECT rf20_pruebas_locales.assert_motivo(
  'valor presente pero vacio/espacios',
  '[{"valor":"   ","texto":"Opcion A","orden":0}]'::jsonb,
  'OPCIONES_VALOR_INVALIDO'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'valor presente con tipo incorrecto (numero)',
  '[{"valor":123,"texto":"Opcion A","orden":0}]'::jsonb,
  'OPCIONES_VALOR_INVALIDO'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'texto presente con tipo incorrecto (booleano)',
  '[{"valor":"a","texto":true,"orden":0}]'::jsonb,
  'OPCIONES_TEXTO_INVALIDO'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'orden presente pero no entero (1.5)',
  '[{"valor":"a","texto":"Opcion A","orden":1.5}]'::jsonb,
  'OPCIONES_ORDEN_NO_ENTERO'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'orden presente pero negativo',
  '[{"valor":"a","texto":"Opcion A","orden":-1}]'::jsonb,
  'OPCIONES_ORDEN_NO_ENTERO'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'opciones no es array',
  '{"valor":"a"}'::jsonb,
  'OPCIONES_NO_ES_ARRAY'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'opciones NULL de SQL',
  NULL::jsonb,
  'OPCIONES_NO_ES_ARRAY'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'opciones vacio',
  '[]'::jsonb,
  'OPCIONES_VACIO'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'valor duplicado real (ambas opciones con valor completo e igual)',
  '[{"valor":"a","texto":"Opcion A","orden":0},{"valor":"a","texto":"Opcion A bis","orden":1}]'::jsonb,
  'OPCIONES_VALOR_DUPLICADO'
);

SELECT rf20_pruebas_locales.assert_motivo(
  'orden con hueco (0,1,3 para 3 opciones)',
  '[{"valor":"a","texto":"A","orden":0},{"valor":"b","texto":"B","orden":1},{"valor":"c","texto":"C","orden":3}]'::jsonb,
  'OPCIONES_ORDEN_NO_CONTIGUO'
);

-- Caso de exito completo, forma real de Q1 (8 opciones, orden 0..7), para
-- confirmar que la correccion no afecta el camino feliz.
SELECT rf20_pruebas_locales.assert_motivo(
  'caso de exito -- 8 opciones validas, orden 0..7',
  '[
     {"valor":"opcion_0","texto":"Opcion 0","orden":0},
     {"valor":"opcion_1","texto":"Opcion 1","orden":1},
     {"valor":"opcion_2","texto":"Opcion 2","orden":2},
     {"valor":"opcion_3","texto":"Opcion 3","orden":3},
     {"valor":"opcion_4","texto":"Opcion 4","orden":4},
     {"valor":"opcion_5","texto":"Opcion 5","orden":5},
     {"valor":"opcion_6","texto":"Opcion 6","orden":6},
     {"valor":"no_definida","texto":"No esta claramente definido","orden":7}
   ]'::jsonb,
  'OK'
);

DO $$ BEGIN RAISE NOTICE '=== TODAS LAS PRUEBAS LOCALES DE H1 PASARON ==='; END; $$;

ROLLBACK;
-- ROLLBACK deliberado: esta transaccion solo existio para correr las
-- aserciones contra la copia desechable de la funcion dentro del esquema
-- "rf20_pruebas_locales"; no debe dejar ningun objeto permanente en la
-- base de datos usada para la prueba, sea local o cualquier otra.
