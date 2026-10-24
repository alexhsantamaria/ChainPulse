-- ChainPulse -- RF24 (derechos/retiro), migracion 5: correccion de 2
-- defectos PRODUCTIVOS confirmados contra ejecucion real en Windows (v10.1,
-- 2026-10-23) y documentados en la auditoria consolidada de los 24 fallos
-- (chainpulse/auditoria-24-fallos-v10.1-matriz-2026-10-23.md, hallazgos A1
-- y A2). NO modifica ninguna de las 4 migraciones de RF24 ya aplicadas
-- (20261022080000_rf24_enum_bucket_limite_tasa,
-- 20261022090000_rf24_tabla_solicitud_derechos,
-- 20261022100000_rf24_funciones_controladas,
-- 20261023053758_rf24_revocar_privilegios_directos_tablas_derechos):
-- unicamente CREATE OR REPLACE sobre las 2 funciones defectuosas.
--
-- A1 -- crear_solicitud_derechos, SQLSTATE 42702 ("column reference \'id\'
-- is ambiguous"), confirmado en el log real de Vitest (Windows,
-- 2026-10-23) en las 7 pruebas que la invocan. Causa raiz: esta funcion
-- declara "RETURNS TABLE(creada boolean, id text)" -- en PL/pgSQL eso crea,
-- para cada columna de salida, una variable implicita con ESE nombre,
-- visible en todo el cuerpo de la funcion. La columna de salida "id" y la
-- columna real "id" de "solicitudes_derechos" quedan entonces con el mismo
-- nombre sin calificar en "RETURNING id INTO v_id", y Postgres no puede
-- decidir a cual de las dos se refiere. Correccion EXACTA autorizada por
-- Alex (nunca una calificacion de 3 partes sin verificar que Postgres la
-- acepta dentro de RETURNING): alias de tabla en el propio INSERT
-- ("AS sd") y referencia calificada por ese alias en el RETURNING
-- ("RETURNING sd.id INTO v_id") -- el alias de tabla desambigua sin
-- depender de ninguna forma de calificacion no verificada.
--
-- A2 -- aplicar_efecto_solicitud_derechos (interna, llamada SIEMPRE desde
-- procesar_solicitud_derechos/resolver_solicitud_por_soporte, nunca
-- directamente por chainpulse_app) inserta en "consentimientos_expres" sin
-- su columna "id" -- NOT NULL, sin ningun default (ni secuencia ni
-- gen_random_uuid()), confirmado releyendo literalmente
-- 20260916150000_incremento2_evaluacion_expres_v2 (definicion de la
-- tabla). Cada INSERT sin "id" viola esa restriccion NOT NULL. Correccion:
-- agregar la columna "id" a la lista de columnas y VALUES, generada con
-- gen_random_uuid()::text -- exactamente el mismo mecanismo de generacion
-- de id que esta misma migracion (funcion 1, "crear_solicitud_derechos")
-- y el resto del paquete RF24 ya usan en cada INSERT propio, nunca un
-- mecanismo nuevo.
--
-- CREATE OR REPLACE (nunca DROP + CREATE) a proposito en las 2 funciones:
-- el tipo de retorno de ninguna de las 2 cambia (crear_solicitud_derechos
-- sigue devolviendo TABLE(creada boolean, id text);
-- aplicar_efecto_solicitud_derechos sigue devolviendo void) -- "CREATE OR
-- REPLACE FUNCTION" solo falla con 42P13 cuando el tipo de retorno
-- cambia, caso que no aplica aqui. A diferencia de "DROP FUNCTION" +
-- "CREATE FUNCTION" (usado en 20261022100000_rf24_funciones_controladas
-- porque alli SI hacia falta poder cambiar firmas/tipos libremente),
-- "CREATE OR REPLACE" nunca reinicia el estado de GRANT/REVOKE del objeto
-- funcion existente -- por eso esta migracion NO repite ningun
-- REVOKE ALL ... FROM PUBLIC ni GRANT EXECUTE ... TO chainpulse_app: el
-- estado de privilegios ya vigente sobre ambas funciones (GRANT EXECUTE a
-- chainpulse_app en crear_solicitud_derechos; SIN grant alguno a
-- chainpulse_app en aplicar_efecto_solicitud_derechos, por ser interna)
-- se preserva intacto, sin tocarlo.
--
-- Se preserva, sin excepcion, en las 2 funciones: firma exacta (mismos
-- parametros, mismo orden, mismos tipos), tipo de retorno, la asimetria
-- deliberada de SECURITY DEFINER (crear_solicitud_derechos la conserva;
-- aplicar_efecto_solicitud_derechos sigue SIN esa clausula, por diseno --
-- solo es alcanzable desde funciones que ya corren como neondb_owner),
-- propietario (neondb_owner, al aplicarse con esa misma conexion
-- administrativa), "SET search_path = public, pg_temp", toda referencia
-- ya calificada por esquema dentro del cuerpo, y los privilegios
-- existentes (ninguno se otorga ni se revoca en esta migracion). No se
-- modifica ningun otro aspecto de ninguna de las 2 funciones.
--
-- Verificacion posterior (fuera de esta migracion, en
-- src/infra/rf24/orquestarValidacionRamaTemporal.ts): un nuevo chequeo
-- BLOQUEANTE, agregado en esta misma ronda, confirma contra catalogo real
-- (pg_proc/pg_roles) que la definicion/propietario/search_path/
-- SECURITY DEFINER de ambas funciones, tras aplicar esta migracion,
-- coinciden exactamente con lo esperado.
--
-- Transaccional de punta a punta (sin sentencia no transaccional alguna),
-- igual que el resto de migraciones de este paquete.

BEGIN;

-- =============================================================================
-- 1. crear_solicitud_derechos -- correccion A1 (SQLSTATE 42702)
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
  -- por id, exista o no la evaluacion -- sin cambios respecto a la
  -- version original (ver cabecera de 20261022100000_rf24_funciones_
  -- controladas, "VERIFICACION INTERNA DE CORREO").
  SELECT (correo IS NOT NULL AND encode(sha256(convert_to(lower(trim(correo)), 'UTF8')), 'hex') = p_correo_hash_entrante)
    INTO v_coincide
    FROM public.evaluaciones_expres_v2 WHERE id = p_evaluacion_id;
  v_coincide := COALESCE(v_coincide, false);

  SELECT count(*) INTO v_conteo FROM public.solicitudes_derechos
    WHERE "evaluacionExpresV2Id" = p_evaluacion_id
      AND "createdAt" > now() - (v_ventana_horas || ' hours')::interval;

  IF v_coincide AND v_conteo < v_limite_por_objetivo THEN
    -- CORRECCION A1 (Alex, 2026-10-23): alias de tabla "AS sd" + RETURNING
    -- calificado por ese alias -- desambigua frente a la variable de
    -- salida implicita "id" (de RETURNS TABLE(..., id text)) sin usar
    -- ninguna calificacion de 3 partes no verificada.
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
-- PUBLIC), ver cabecera de este archivo.

-- =============================================================================
-- 2. aplicar_efecto_solicitud_derechos (interna, NUNCA recibe grant) --
--    correccion A2 (id NOT NULL de consentimientos_expres sin poblar)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.aplicar_efecto_solicitud_derechos(
  p_evaluacion_id text, p_tipo text, p_alcance_retiro text, p_metodo_retiro text
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE v_finalidad text; v_vigente boolean; v_texto_version text; v_texto_snapshot text;
BEGIN
  IF p_tipo IN ('RETIRO_CONSENTIMIENTO', 'RETIRO_Y_ELIMINACION') THEN
    FOR v_finalidad IN SELECT unnest(
      CASE p_alcance_retiro
        WHEN 'AMBAS_FINALIDADES' THEN ARRAY['DIAGNOSTICO','INVESTIGACION']
        ELSE ARRAY[p_alcance_retiro]
      END) LOOP
      -- Advisory lock por (evaluacion, finalidad) -- sin cambios (v5
      -- Seccion 7).
      PERFORM pg_advisory_xact_lock(hashtext(p_evaluacion_id || ':' || v_finalidad));

      SELECT aceptado, "textoVersion", "textoSnapshot" INTO v_vigente, v_texto_version, v_texto_snapshot
        FROM public.consentimientos_expres
        WHERE "evaluacionExpresV2Id" = p_evaluacion_id AND finalidad = v_finalidad::public."FinalidadConsentimiento"
        ORDER BY "createdAt" DESC LIMIT 1;

      IF v_vigente IS DISTINCT FROM false THEN -- no-op si ya esta retirado
        -- CORRECCION A2 (Alex, 2026-10-23): se agrega "id" (NOT NULL, sin
        -- default -- confirmado en 20260916150000_incremento2_evaluacion_
        -- expres_v2) generado con gen_random_uuid()::text, el mismo
        -- mecanismo de generacion de id que el resto de este paquete RF24
        -- ya usa en cada INSERT propio.
        INSERT INTO public.consentimientos_expres
          (id, "evaluacionExpresV2Id", finalidad, aceptado, "textoVersion", "textoSnapshot", "metodoRetiro", "retiradoEn", "createdAt")
        VALUES (gen_random_uuid()::text, p_evaluacion_id, v_finalidad::public."FinalidadConsentimiento", false,
                COALESCE(v_texto_version, 'N/A'),
                COALESCE(v_texto_snapshot, 'Retiro solicitado sin consentimiento previo registrado'),
                p_metodo_retiro::public."MetodoRetiro", now(), now());
      END IF;

      IF v_finalidad = 'DIAGNOSTICO' THEN
        UPDATE public.evaluaciones_expres_v2 SET "accesoPublicoRevocadoEn" = now()
          WHERE id = p_evaluacion_id AND "accesoPublicoRevocadoEn" IS NULL;
      END IF;
    END LOOP;
  END IF;

  IF p_tipo IN ('ELIMINACION_CONTACTO', 'RETIRO_Y_ELIMINACION') THEN
    UPDATE public.evaluaciones_expres_v2
      SET correo = NULL, "nombreCompleto" = NULL, "empresaNombre" = NULL, telefono = NULL,
          "accesoPublicoRevocadoEn" = COALESCE("accesoPublicoRevocadoEn", now())
      WHERE id = p_evaluacion_id;
  END IF;
END; $$;

-- Sin REVOKE/GRANT aqui -- CREATE OR REPLACE preserva el estado ya
-- vigente (REVOKE ALL de PUBLIC; sin GRANT a chainpulse_app, por diseno).

COMMIT;
