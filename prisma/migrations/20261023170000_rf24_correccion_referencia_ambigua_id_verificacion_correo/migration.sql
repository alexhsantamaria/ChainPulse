-- ChainPulse -- RF24 (derechos/retiro), migracion 6: correccion de 1
-- defecto PRODUCTIVO confirmado contra ejecucion real en Windows (v11,
-- 2026-10-23) tras aplicar la migracion 5. NO modifica la migracion 5
-- (20261023160000_rf24_correccion_ambiguedad_id_y_consentimiento_sin_id,
-- ya aplicada) ni ninguna de las 4 migraciones de RF24 anteriores a esa
-- (20261022080000_rf24_enum_bucket_limite_tasa,
-- 20261022090000_rf24_tabla_solicitud_derechos,
-- 20261022100000_rf24_funciones_controladas,
-- 20261023053758_rf24_revocar_privilegios_directos_tablas_derechos):
-- unicamente CREATE OR REPLACE, forward-only, sobre la unica funcion
-- defectuosa.
--
-- A1 (residual) -- crear_solicitud_derechos, SQLSTATE 42702 ("column
-- reference \'id\' is ambiguous"), confirmado en el log real de Vitest
-- (Windows, 2026-10-23, corrida v11 contra la rama temporal) en las
-- pruebas que la invocan, PESE a que la migracion 5 ya corrigio una
-- ambiguedad distinta de "id" dentro de esta misma funcion (el
-- "RETURNING id INTO v_id" original, resuelto alli con el alias "AS sd" /
-- "RETURNING sd.id INTO v_id"). Causa raiz residual, confirmada leyendo
-- literalmente el cuerpo de la funcion tal como quedo tras la migracion
-- 5: la funcion declara "RETURNS TABLE(creada boolean, id text)" -- en
-- PL/pgSQL eso crea, para cada columna de salida, una variable implicita
-- con ESE nombre, visible en todo el cuerpo de la funcion. La
-- verificacion interna de correo:
--
--   SELECT (correo IS NOT NULL AND ...)
--     INTO v_coincide
--     FROM public.evaluaciones_expres_v2 WHERE id = p_evaluacion_id;
--
-- usa "id" sin calificar en el WHERE, y esa referencia compite con la
-- variable de salida implicita "id" (de RETURNS TABLE(..., id text)) --
-- el mismo mecanismo de ambiguedad que la migracion 5 ya habia
-- diagnosticado y corregido en el RETURNING, pero que seguia presente,
-- sin corregir, en este SELECT distinto dentro de la misma funcion.
-- Postgres no puede decidir si "id" se refiere a la columna de
-- "evaluaciones_expres_v2" o a la variable de salida, y lanza 42702.
--
-- Correccion EXACTA autorizada por Alex: alias de tabla real en el FROM
-- ("AS ev") y referencia calificada por ese alias tanto en el WHERE
-- ("ev.id = p_evaluacion_id") como en la columna "correo" leida en el
-- SELECT ("ev.correo", en las 2 apariciones dentro de esa misma
-- expresion) -- el alias de tabla desambigua "id" de la misma forma que
-- ya lo hizo "AS sd" en migracion 5, y se califica tambien "correo" por
-- consistencia y para dejar sin ambiguedad visual ninguna columna leida
-- de "ev" dentro de esa expresion (aunque "correo" no colisiona con
-- ninguna variable de salida de esta funcion, a diferencia de "id").
--
-- Auditoria de todo el cuerpo de la funcion (ambas funciones de
-- migracion 5 relevantes, releidas integramente tal como quedaron tras
-- esa migracion, linea por linea, buscando cualquier otra columna sin
-- calificar que pudiera competir con "creada" o "id"): esta es la UNICA
-- referencia ambigua restante. El resto del cuerpo de
-- "crear_solicitud_derechos" (el COUNT sobre "solicitudes_derechos", el
-- INSERT con alias "AS sd" y su "RETURNING sd.id INTO v_id", y el INSERT
-- sobre "intentos_solicitud_derechos_descartados") ya usa exclusivamente
-- nombres de tabla calificados por esquema y, donde corresponde, por
-- alias -- sin cambios ahi. "aplicar_efecto_solicitud_derechos" (la otra
-- funcion de migracion 5) no tiene ninguna columna de salida nombrada
-- (RETURNS void) y no presenta ninguna referencia ambigua: no se toca en
-- esta migracion.
--
-- CREATE OR REPLACE (nunca DROP + CREATE) a proposito: el tipo de
-- retorno no cambia (sigue siendo TABLE(creada boolean, id text)) --
-- "CREATE OR REPLACE FUNCTION" solo falla con 42P13 cuando el tipo de
-- retorno cambia, caso que no aplica aqui. Por eso esta migracion NO
-- repite ningun REVOKE ALL ... FROM PUBLIC ni GRANT EXECUTE ... TO
-- chainpulse_app: el estado de privilegios ya vigente (GRANT EXECUTE a
-- chainpulse_app, REVOKE ALL de PUBLIC, sin cambios desde
-- 20261022100000_rf24_funciones_controladas) se preserva intacto.
--
-- Se preserva, sin excepcion: firma exacta (mismos parametros, mismo
-- orden, mismos tipos), tipo de retorno, SECURITY DEFINER, propietario
-- (neondb_owner, al aplicarse con esa misma conexion administrativa),
-- "SET search_path = public, pg_temp", toda referencia ya calificada por
-- esquema dentro del cuerpo, el alias "AS sd" / "RETURNING sd.id INTO
-- v_id" introducido en migracion 5 (sin cambios), y los privilegios
-- existentes (ninguno se otorga ni se revoca en esta migracion). No se
-- modifica ningun otro aspecto de la funcion.
--
-- Verificacion posterior (fuera de esta migracion, en
-- src/infra/rf24/orquestarValidacionRamaTemporal.ts): el chequeo
-- BLOQUEANTE agregado junto con esta migracion ya no se limita a
-- metadatos de catalogo (identidad de argumentos, prosecdef, propietario,
-- search_path) -- tras el falso positivo confirmado de migracion 5
-- (acepto una definicion funcionalmente defectuosa porque nunca inspecciono
-- el CUERPO real de la funcion), ahora tambien lee pg_get_functiondef(oid)
-- y exige, de forma literal, que el patron corregido
-- ("FROM public.evaluaciones_expres_v2 AS ev WHERE ev.id = p_evaluacion_id")
-- este presente y que el patron viejo, sin calificar
-- ("FROM public.evaluaciones_expres_v2 WHERE id = p_evaluacion_id"),
-- ya NO lo este.
--
-- Transaccional de punta a punta (sin sentencia no transaccional alguna),
-- igual que el resto de migraciones de este paquete.

BEGIN;

-- =============================================================================
-- 1. crear_solicitud_derechos -- correccion A1 residual (SQLSTATE 42702,
--    segunda ocurrencia, en la verificacion interna de correo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.crear_solicitud_derechos(
  p_evaluacion_id text, p_correo_hash_entrante text, p_tipo text, p_alcance_retiro text,
  p_huella_hash text
) RETURNS TABLE(creada boolean, id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conteo integer;
  v_id text;
  v_coincide boolean;
  -- Ver "CONTROLES NO PARAMETRIZABLES" en la cabecera de
  -- 20261022100000_rf24_funciones_controladas -- sin cambios aqui.
  v_limite_por_objetivo CONSTANT integer := 3;
  v_ventana_horas CONSTANT integer := 24;
  v_expira_en CONSTANT timestamp := now() + interval '24 hours';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_evaluacion_id));

  -- Verificacion interna de correo: SIEMPRE una unica busqueda indexada
  -- por id, exista o no la evaluacion -- misma logica que antes (ver
  -- cabecera de 20261022100000_rf24_funciones_controladas,
  -- "VERIFICACION INTERNA DE CORREO"). CORRECCION (migracion 6, Alex,
  -- 2026-10-23): alias real "AS ev" + referencia calificada por ese
  -- alias tanto en "ev.id" (desambigua frente a la variable de salida
  -- implicita "id" de RETURNS TABLE(..., id text), igual que el alias
  -- "AS sd" de migracion 5 en el RETURNING) como en "ev.correo" (las 2
  -- apariciones dentro de esta misma expresion), por consistencia.
  SELECT (ev.correo IS NOT NULL AND encode(sha256(convert_to(lower(trim(ev.correo)), 'UTF8')), 'hex') = p_correo_hash_entrante)
    INTO v_coincide
    FROM public.evaluaciones_expres_v2 AS ev WHERE ev.id = p_evaluacion_id;
  v_coincide := COALESCE(v_coincide, false);

  SELECT count(*) INTO v_conteo FROM public.solicitudes_derechos
    WHERE "evaluacionExpresV2Id" = p_evaluacion_id
      AND "createdAt" > now() - (v_ventana_horas || ' hours')::interval;

  IF v_coincide AND v_conteo < v_limite_por_objetivo THEN
    -- Alias "AS sd" + RETURNING calificado por ese alias -- introducido
    -- en migracion 5, sin cambios aqui.
    INSERT INTO public.solicitudes_derechos AS sd
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "huellaOrigenHashSolicitud",
       "expiraEn", estado, "createdAt", "actualizadaEn")
    VALUES (gen_random_uuid()::text, p_evaluacion_id, p_tipo::public."TipoSolicitudDerechos",
            p_alcance_retiro::public."AlcanceRetiro", p_huella_hash, v_expira_en, 'PENDIENTE', now(), now())
    RETURNING sd.id INTO v_id;
    RETURN QUERY SELECT true, v_id;
  ELSE
    -- No revela si fue por no-coincidencia o por limite alcanzado
    -- (v5 Seccion 15, [Decision 0.3]) -- sin cambios.
    INSERT INTO public.intentos_solicitud_derechos_descartados (id, "creadoEn")
      VALUES (gen_random_uuid()::text, now());
    RETURN QUERY SELECT false, NULL::text;
  END IF;
END; $$;

-- Sin REVOKE/GRANT aqui -- CREATE OR REPLACE preserva el estado de
-- privilegios ya vigente (GRANT EXECUTE a chainpulse_app, REVOKE ALL de
-- PUBLIC), ver cabecera de este archivo. "aplicar_efecto_solicitud_derechos"
-- no se toca en esta migracion: no presenta ninguna referencia ambigua.

COMMIT;
