-- ChainPulse -- RF24 (derechos/retiro), migracion 3 de 3 (funciones
-- controladas). Depende de que las migraciones 1 y 2 de este paquete ya
-- esten COMMITeadas.
--
-- Diseno cerrado, en este orden de autoridad (autorizacion de Alex,
-- 2026-10-22): chainpulse/diseno-v5-final-consolidado-paquete-rf24-
-- derechos-retiro-2026-10-21.md + addenda-cierre-v5 + addenda-2-cierre-v5
-- + las condiciones de reconciliacion y fencing de la autorizacion de
-- PR-A (modelo de despacho con reclamoId; idempotencia de Resend;
-- verificacion interna de correo via hash; endurecimiento SQL).
--
-- 12 funciones -- no son 9 ni 10: el conteo crece de 10 (addenda-2) a 12
-- por el modelo de fencing exigido en la autorizacion de PR-A, que separa
-- "liberar el arriendo si quedan intentos" (funcion 8, nueva) de
-- "cancelar si se agoto el maximo" (funcion 9, ya existia pero ahora
-- fenced) y agrega la reconciliacion automatica para workers muertos
-- (funcion 10, nueva). Trazabilidad completa en la tabla invariante ->
-- implementacion -> prueba de la entrega de este PR.
--
-- ENDURECIMIENTO (autorizacion de PR-A, "Seguridad SQL"), aplicado a las
-- 12 funciones por igual:
--   - Todo objeto de aplicacion referenciado dentro de cada cuerpo esta
--     completamente calificado con su esquema ("public.solicitudes_
--     derechos", "public."TipoSolicitudDerechos"", etc.) -- esta es la
--     mitigacion realmente efectiva contra shadowing por un objeto
--     temporal de la sesion llamante.
--   - "SET search_path = public, pg_temp" en cada funcion -- pg_temp
--     explicitamente al final, nunca implicito ni primero. Documenta el
--     orden de resolucion; la calificacion completa de arriba es lo que
--     realmente cierra el riesgo de shadowing, no el orden por si solo.
--   - DROP FUNCTION IF EXISTS antes de cada CREATE (nunca CREATE OR
--     REPLACE -- cambiar el tipo de retorno falla con 42P13 si no se
--     borra primero, mismo motivo ya documentado en auth_functions.sql).
--   - REVOKE ALL ... FROM PUBLIC explicito en cada funcion.
--   - GRANT EXECUTE a chainpulse_app con firma exacta, unicamente en las
--     11 funciones de cara a la aplicacion (de las 12 totales) -- la
--     funcion interna
--     (aplicar_efecto_solicitud_derechos) NUNCA recibe grant: solo es
--     alcanzable desde dentro de las funciones 3/4, que ya corren como
--     propietario (neondb_owner, verificado como gate de PR-A en la rama
--     temporal de Neon, no en esta migracion).
--
-- CONTROLES NO PARAMETRIZABLES (CORRECCION Alex 2026-10-22, punto 1;
-- ampliado 2026-10-22 en una segunda ronda de correccion): limite/
-- ventana y expiracion (funcion 1), lote/lease/maximo de intentos
-- (funcion 5) y maximo de intentos (funcion 10) ya NO son parametros de
-- sus firmas -- antes lo eran (p_limite_por_objetivo, p_ventana_horas,
-- p_expira_en, p_lote, p_lease_minutos, p_max_intentos), lo que
-- permitia que chainpulse_app (o cualquier otro llamador con EXECUTE)
-- pasara valores distintos a los aprobados, pese a que la aplicacion
-- siempre pensaba pasar los mismos. Ahora son literales/constantes
-- fijas dentro de cada cuerpo, no evaluables por el llamador. Valores
-- vinculantes: 3 solicitudes por evaluacion cada 24h, expiracion fija
-- de 24h desde la creacion, lease 2 minutos, maximo 5 intentos, lote 10.
-- p_expira_en en particular cerraba un segundo control de la misma
-- naturaleza que limite/ventana: el llamador podia fijar una expiracion
-- arbitraria (mas corta o, sobre todo, mas larga que la aprobada) para
-- una solicitud -- ahora la propia funcion calcula siempre
-- now() + interval \'24 hours\', sin excepcion.
--
-- VERIFICACION INTERNA DE CORREO (autorizacion de PR-A, CORREGIDO por
-- Alex 2026-10-22, punto 5): la funcion 1 NO recibe un booleano de
-- coincidencia calculado por la aplicacion (bloqueador cerrado en
-- addenda-2). Para evitar exponer el correo en claro como parametro de
-- una funcion SECURITY DEFINER (y por extension en cualquier log que
-- capture valores de parametros), la aplicacion envia un hash
-- normalizado y la funcion compara ese hash contra el que calcula
-- internamente sobre la misma normalizacion del correo almacenado -- el
-- correo en claro nunca aparece como argumento de esta funcion.
--
-- Se usa sha256 (encode(sha256(convert_to(lower(trim(correo)), 'UTF8')),
-- 'hex')), NUNCA md5 (algoritmo original de esta migracion, reemplazado
-- por esta correccion -- md5 es vulnerable a colisiones; aunque el
-- proposito aqui es higiene de logs y no resistencia criptografica
-- contra un secreto de alta entropia, no hay razon para usar un
-- algoritmo debilitado cuando el reemplazo no cuesta nada). sha256(bytea)
-- es una funcion NATIVA de PostgreSQL (binary string function, nucleo
-- desde la version 11 -- documentacion oficial de PostgreSQL, Seccion
-- 9.5, "Binary String Functions and Operators"), DISPONIBLE SIN ninguna
-- extension -- a diferencia de digest()/hmac(), que SI requieren
-- pgcrypto. Esta base (PostgreSQL 18.6, ver cabecera de la migracion 1
-- de este paquete y ADR-0003) excede ampliamente ese minimo de version
-- 11, asi que esta migracion NO agrega ningun CREATE EXTENSION: no hace
-- falta. convert_to(..., 'UTF8') fija explicitamente la codificacion de
-- entrada (en vez de castear text->bytea, que usaria la codificacion
-- del servidor) para igualar byte a byte la codificacion UTF-8 que el
-- lado TypeScript usa (createHash("sha256").update(correo, "utf8")) --
-- sin esto, ambos lados podrian normalizar el mismo texto a bytes
-- distintos en un servidor con una codificacion no-UTF8.
--
-- No requiere comparacion en tiempo constante (a diferencia de la
-- verificacion de integridad del token en la Seccion de abajo, que SI
-- protege contra un canal lateral de timing sobre un secreto real y se
-- hace en tiempo constante en codigo de aplicacion, no aqui): el correo
-- ya esta almacenado en claro en evaluaciones_expres_v2.correo (el
-- propio titular ya lo conoce), asi que esta comparacion no protege un
-- secreto de alta entropia. Ningun correo se almacena en SolicitudDerechos
-- ni en la tabla senuelo -- confirmado, ninguna de las 2 tablas tiene
-- columna de correo.
--
-- MODELO DE DESPACHO CON FENCING (autorizacion de PR-A): reclamoId es un
-- UUID aleatorio criptografico (gen_random_uuid(), generador
-- criptografico de PostgreSQL >=13, sin extension) asignado por la
-- funcion 5 en cada reclamo exitoso. Las funciones 6, 7, 8 y 9 exigen
-- SIEMPRE, en su propia clausula WHERE, las 4 condiciones juntas: mismo
-- solicitudId, mismo reclamoId, arriendo todavia vigente
-- ("reclamadoHasta" > now()), estado PENDIENTE -- un worker cuyo
-- arriendo vencio o fue sustituido por un reclamo mas reciente no
-- encuentra ninguna fila que coincida y su llamada no tiene efecto
-- (devuelve false/0 filas), nunca un error -- la aplicacion debe tratar
-- ese "sin efecto" como perdida de autoridad sobre esa fila, no como un
-- fallo a reintentar con el mismo reclamoId.
--
-- RECONCILIACION (autorizacion de PR-A): la funcion 10 es la UNICA sin
-- fencing por reclamoId a proposito -- existe exactamente para las filas
-- cuyo worker murio sin poder llamar a la funcion 9 el mismo, usando
-- unicamente el predicado de estado (ver su cuerpo), ejecutada desde el
-- mismo cron existente.
--
-- Transaccional de punta a punta (sin sentencia no transaccional alguna).

BEGIN;

-- =============================================================================
-- 1. crear_solicitud_derechos
-- =============================================================================
DROP FUNCTION IF EXISTS public.crear_solicitud_derechos(text, text, text, text, text);

CREATE FUNCTION public.crear_solicitud_derechos(
  p_evaluacion_id text, p_correo_hash_entrante text, p_tipo text, p_alcance_retiro text,
  p_huella_hash text
) RETURNS TABLE(creada boolean, id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conteo integer;
  v_id text;
  v_coincide boolean;
  -- Ver "CONTROLES NO PARAMETRIZABLES" en la cabecera de esta migracion.
  v_limite_por_objetivo CONSTANT integer := 3;
  v_ventana_horas CONSTANT integer := 24;
  -- CORRECCION Alex 2026-10-22 (segunda ronda): la expiracion ya NO es
  -- un parametro (antes p_expira_en, controlable por el llamador) --
  -- SIEMPRE 24h desde el momento de creacion, sin excepcion.
  v_expira_en CONSTANT timestamp := now() + interval '24 hours';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_evaluacion_id));

  -- Verificacion interna de correo: SIEMPRE una unica busqueda indexada
  -- por id, exista o no la evaluacion -- mismo costo de consulta en
  -- ambas ramas (canal lateral de timing, v5 Seccion 8). sha256, no
  -- md5 -- ver "VERIFICACION INTERNA DE CORREO" en la cabecera.
  SELECT (correo IS NOT NULL AND encode(sha256(convert_to(lower(trim(correo)), 'UTF8')), 'hex') = p_correo_hash_entrante)
    INTO v_coincide
    FROM public.evaluaciones_expres_v2 WHERE id = p_evaluacion_id;
  v_coincide := COALESCE(v_coincide, false);

  SELECT count(*) INTO v_conteo FROM public.solicitudes_derechos
    WHERE "evaluacionExpresV2Id" = p_evaluacion_id
      AND "createdAt" > now() - (v_ventana_horas || ' hours')::interval;

  IF v_coincide AND v_conteo < v_limite_por_objetivo THEN
    INSERT INTO public.solicitudes_derechos
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "huellaOrigenHashSolicitud",
       "expiraEn", estado, "createdAt", "actualizadaEn")
    VALUES (gen_random_uuid()::text, p_evaluacion_id, p_tipo::public."TipoSolicitudDerechos",
            p_alcance_retiro::public."AlcanceRetiro", p_huella_hash, v_expira_en, 'PENDIENTE', now(), now())
    RETURNING id INTO v_id;
    RETURN QUERY SELECT true, v_id;
  ELSE
    -- No revela si fue por no-coincidencia o por limite alcanzado
    -- (v5 Seccion 15, [Decision 0.3]).
    INSERT INTO public.intentos_solicitud_derechos_descartados (id, "creadoEn")
      VALUES (gen_random_uuid()::text, now());
    RETURN QUERY SELECT false, NULL::text;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.crear_solicitud_derechos(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_solicitud_derechos(text, text, text, text, text) TO chainpulse_app;

-- =============================================================================
-- 2. aplicar_efecto_solicitud_derechos (interna -- NUNCA recibe grant)
-- =============================================================================
DROP FUNCTION IF EXISTS public.aplicar_efecto_solicitud_derechos(text, text, text, text);

CREATE FUNCTION public.aplicar_efecto_solicitud_derechos(
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
      -- Advisory lock por (evaluacion, finalidad) -- cierra la carrera
      -- entre dos SolicitudDerechos distintas retirando la misma
      -- finalidad de la misma evaluacion (v5 Seccion 7).
      PERFORM pg_advisory_xact_lock(hashtext(p_evaluacion_id || ':' || v_finalidad));

      SELECT aceptado, "textoVersion", "textoSnapshot" INTO v_vigente, v_texto_version, v_texto_snapshot
        FROM public.consentimientos_expres
        WHERE "evaluacionExpresV2Id" = p_evaluacion_id AND finalidad = v_finalidad::public."FinalidadConsentimiento"
        ORDER BY "createdAt" DESC LIMIT 1;

      IF v_vigente IS DISTINCT FROM false THEN -- no-op si ya esta retirado
        INSERT INTO public.consentimientos_expres
          ("evaluacionExpresV2Id", finalidad, aceptado, "textoVersion", "textoSnapshot", "metodoRetiro", "retiradoEn", "createdAt")
        VALUES (p_evaluacion_id, v_finalidad::public."FinalidadConsentimiento", false,
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

REVOKE ALL ON FUNCTION public.aplicar_efecto_solicitud_derechos(text, text, text, text) FROM PUBLIC;
-- Sin GRANT a chainpulse_app a proposito -- ver nota de cabecera.

-- =============================================================================
-- 3. procesar_solicitud_derechos (camino automatico, por token)
-- =============================================================================
DROP FUNCTION IF EXISTS public.procesar_solicitud_derechos(text);

CREATE FUNCTION public.procesar_solicitud_derechos(p_token_hash text) RETURNS TABLE(procesada boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_eval text; v_tipo text; v_alcance text;
BEGIN
  UPDATE public.solicitudes_derechos
    SET estado = 'PROCESADA', "consumidoEn" = now(), "resueltoCanal" = 'AUTOMATICO',
        "reclamoId" = NULL, "reclamadoHasta" = NULL, "actualizadaEn" = now()
    WHERE "tokenHash" = p_token_hash AND estado = 'PENDIENTE' AND "expiraEn" > now()
    RETURNING "evaluacionExpresV2Id", tipo::text, "alcanceRetiro"::text INTO v_eval, v_tipo, v_alcance;
  IF v_eval IS NULL THEN
    RETURN QUERY SELECT false; RETURN;
  END IF;
  PERFORM public.aplicar_efecto_solicitud_derechos(v_eval, v_tipo, v_alcance, 'FORMULARIO_PUBLICO');
  RETURN QUERY SELECT true;
END; $$;

REVOKE ALL ON FUNCTION public.procesar_solicitud_derechos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.procesar_solicitud_derechos(text) TO chainpulse_app;

-- =============================================================================
-- 4. resolver_solicitud_por_soporte (camino manual, soporte)
-- =============================================================================
DROP FUNCTION IF EXISTS public.resolver_solicitud_por_soporte(text, text);

CREATE FUNCTION public.resolver_solicitud_por_soporte(p_solicitud_id text, p_usuario_admin_id text)
RETURNS TABLE(procesada boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_eval text; v_tipo text; v_alcance text;
BEGIN
  -- Sin exigir token ni expiraEn: canal de confianza distinto, puede
  -- resolver una solicitud que nunca llego a despacharse por correo.
  -- La autoridad del administrador se verifica en la ruta de aplicacion
  -- (sesion + rol ADMINISTRADOR + MFA, autorizacion de PR-A /
  -- [Decision 0.2]) -- esta funcion confia en p_usuario_admin_id, mismo
  -- boundary ya documentado en v5 Seccion 14.
  UPDATE public.solicitudes_derechos
    SET estado = 'PROCESADA', "consumidoEn" = now(), "resueltoCanal" = 'SOPORTE',
        "resueltoPorUsuarioId" = p_usuario_admin_id, "reclamoId" = NULL,
        "reclamadoHasta" = NULL, "actualizadaEn" = now()
    WHERE id = p_solicitud_id AND estado = 'PENDIENTE'
    RETURNING "evaluacionExpresV2Id", tipo::text, "alcanceRetiro"::text INTO v_eval, v_tipo, v_alcance;
  IF v_eval IS NULL THEN
    RETURN QUERY SELECT false; RETURN;
  END IF;
  PERFORM public.aplicar_efecto_solicitud_derechos(v_eval, v_tipo, v_alcance, 'SOLICITUD_SOPORTE');
  RETURN QUERY SELECT true;
END; $$;

REVOKE ALL ON FUNCTION public.resolver_solicitud_por_soporte(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolver_solicitud_por_soporte(text, text) TO chainpulse_app;

-- =============================================================================
-- 5. reclamar_solicitudes_derechos_para_envio (reclamo con fencing)
-- =============================================================================
DROP FUNCTION IF EXISTS public.reclamar_solicitudes_derechos_para_envio();

CREATE FUNCTION public.reclamar_solicitudes_derechos_para_envio()
RETURNS TABLE(id text, "evaluacionExpresV2Id" text, "reclamoId" text, "tokenHash" text, "tokenKeyVersion" integer, "intentosEnvio" integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  -- Lote, lease y maximo de intentos: literales fijos, no parametros --
  -- ver "CONTROLES NO PARAMETRIZABLES" en la cabecera de esta migracion.
  WITH candidatas AS (
    SELECT sd.id FROM public.solicitudes_derechos sd
      WHERE sd.estado = 'PENDIENTE'
        AND sd."envioConfirmadoEn" IS NULL
        AND sd."expiraEn" > now()
        AND sd."intentosEnvio" < 5
        AND (sd."reclamadoHasta" IS NULL OR sd."reclamadoHasta" < now())
      ORDER BY sd."createdAt" ASC LIMIT 10
      FOR UPDATE SKIP LOCKED)
  UPDATE public.solicitudes_derechos sd2
    SET "intentosEnvio" = sd2."intentosEnvio" + 1,
        "reclamoId" = gen_random_uuid()::text,
        "reclamadoHasta" = now() + interval '2 minutes'
    FROM candidatas WHERE sd2.id = candidatas.id
    RETURNING sd2.id, sd2."evaluacionExpresV2Id", sd2."reclamoId", sd2."tokenHash", sd2."tokenKeyVersion", sd2."intentosEnvio";
$$;

REVOKE ALL ON FUNCTION public.reclamar_solicitudes_derechos_para_envio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reclamar_solicitudes_derechos_para_envio() TO chainpulse_app;

-- =============================================================================
-- 6. asignar_token_pendiente (persiste ANTES de llamar a Resend -- fenced)
-- =============================================================================
DROP FUNCTION IF EXISTS public.asignar_token_pendiente(text, text, text, integer);

CREATE FUNCTION public.asignar_token_pendiente(
  p_solicitud_id text, p_reclamo_id text, p_token_hash text, p_token_key_version integer
) RETURNS TABLE(asignado boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH actualizada AS (
    UPDATE public.solicitudes_derechos
      SET "tokenHash" = p_token_hash, "tokenKeyVersion" = p_token_key_version, "actualizadaEn" = now()
      WHERE id = p_solicitud_id AND "reclamoId" = p_reclamo_id
        AND "reclamadoHasta" > now() AND estado = 'PENDIENTE'
        AND ("tokenHash" IS NULL OR "tokenHash" = p_token_hash) -- idempotente: mismo token derivado en un reintento
      RETURNING id)
  SELECT count(*) > 0 FROM actualizada;
$$;

REVOKE ALL ON FUNCTION public.asignar_token_pendiente(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asignar_token_pendiente(text, text, text, integer) TO chainpulse_app;

-- =============================================================================
-- 7. confirmar_envio_token (tras exito confirmado de Resend -- fenced)
-- =============================================================================
DROP FUNCTION IF EXISTS public.confirmar_envio_token(text, text);

CREATE FUNCTION public.confirmar_envio_token(p_solicitud_id text, p_reclamo_id text)
RETURNS TABLE(confirmado boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH actualizada AS (
    UPDATE public.solicitudes_derechos
      SET "envioConfirmadoEn" = now(), "reclamoId" = NULL, "reclamadoHasta" = NULL, "actualizadaEn" = now()
      WHERE id = p_solicitud_id AND "reclamoId" = p_reclamo_id
        AND "reclamadoHasta" > now() AND estado = 'PENDIENTE'
        AND "tokenHash" IS NOT NULL AND "envioConfirmadoEn" IS NULL
      RETURNING id)
  SELECT count(*) > 0 FROM actualizada;
$$;

REVOKE ALL ON FUNCTION public.confirmar_envio_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_envio_token(text, text) TO chainpulse_app;

-- =============================================================================
-- 8. registrar_fallo_envio_solicitud_derechos (libera el arriendo -- fenced)
-- =============================================================================
DROP FUNCTION IF EXISTS public.registrar_fallo_envio_solicitud_derechos(text, text);

CREATE FUNCTION public.registrar_fallo_envio_solicitud_derechos(p_solicitud_id text, p_reclamo_id text)
RETURNS TABLE(liberado boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH actualizada AS (
    UPDATE public.solicitudes_derechos
      SET "reclamoId" = NULL, "reclamadoHasta" = NULL, "actualizadaEn" = now()
      WHERE id = p_solicitud_id AND "reclamoId" = p_reclamo_id
        AND "reclamadoHasta" > now() AND estado = 'PENDIENTE'
      RETURNING id)
  SELECT count(*) > 0 FROM actualizada;
$$;

REVOKE ALL ON FUNCTION public.registrar_fallo_envio_solicitud_derechos(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_fallo_envio_solicitud_derechos(text, text) TO chainpulse_app;

-- =============================================================================
-- 9. cancelar_solicitud_derechos_por_envio_fallido (maximo agotado -- fenced)
-- =============================================================================
DROP FUNCTION IF EXISTS public.cancelar_solicitud_derechos_por_envio_fallido(text, text);

CREATE FUNCTION public.cancelar_solicitud_derechos_por_envio_fallido(p_solicitud_id text, p_reclamo_id text)
RETURNS TABLE(cancelado boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH actualizada AS (
    UPDATE public.solicitudes_derechos
      SET estado = 'CANCELADA', "tokenHash" = NULL, "tokenKeyVersion" = NULL,
          "huellaOrigenHashSolicitud" = NULL, "reclamoId" = NULL, "reclamadoHasta" = NULL,
          "actualizadaEn" = now()
      WHERE id = p_solicitud_id AND "reclamoId" = p_reclamo_id
        AND "reclamadoHasta" > now() AND estado = 'PENDIENTE'
        AND "envioConfirmadoEn" IS NULL -- nunca cancela un envio ya confirmado
      RETURNING id)
  SELECT count(*) > 0 FROM actualizada;
$$;

REVOKE ALL ON FUNCTION public.cancelar_solicitud_derechos_por_envio_fallido(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_solicitud_derechos_por_envio_fallido(text, text) TO chainpulse_app;

-- =============================================================================
-- 10. reconciliar_solicitudes_derechos_agotadas (sweep -- SIN fencing, a
--     proposito: existe exactamente para workers muertos, ver cabecera)
-- =============================================================================
DROP FUNCTION IF EXISTS public.reconciliar_solicitudes_derechos_agotadas();

CREATE FUNCTION public.reconciliar_solicitudes_derechos_agotadas()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  -- Maximo de intentos: literal fijo, no parametro -- ver "CONTROLES NO
  -- PARAMETRIZABLES" en la cabecera de esta migracion.
  --
  -- CORRECCION Alex 2026-10-22 punto 2: predicado de arriendo corregido
  -- de "reclamadoHasta < now()" a "reclamadoHasta IS NULL OR
  -- reclamadoHasta < now()" -- el predicado original EXCLUIA (nunca las
  -- encontraba) las filas cuyo arriendo ya habia sido liberado por
  -- registrar_fallo_envio_solicitud_derechos (funcion 8, que pone
  -- reclamoId/reclamadoHasta en NULL) antes de que el worker muriera sin
  -- poder llamar a cancelar_solicitud_derechos_por_envio_fallido
  -- (funcion 9) -- exactamente el escenario que esta funcion existe
  -- para cubrir (ver "RECONCILIACION" en la cabecera de este archivo).
  WITH canceladas AS (
    UPDATE public.solicitudes_derechos
      SET estado = 'CANCELADA', "tokenHash" = NULL, "tokenKeyVersion" = NULL,
          "huellaOrigenHashSolicitud" = NULL, "reclamoId" = NULL, "reclamadoHasta" = NULL,
          "actualizadaEn" = now()
      WHERE estado = 'PENDIENTE' AND "envioConfirmadoEn" IS NULL
        AND "intentosEnvio" >= 5
        AND ("reclamadoHasta" IS NULL OR "reclamadoHasta" < now())
      RETURNING id)
  SELECT count(*)::integer FROM canceladas;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_solicitudes_derechos_agotadas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconciliar_solicitudes_derechos_agotadas() TO chainpulse_app;

-- =============================================================================
-- 11. expirar_solicitudes_derechos_vencidas
-- =============================================================================
DROP FUNCTION IF EXISTS public.expirar_solicitudes_derechos_vencidas();

CREATE FUNCTION public.expirar_solicitudes_derechos_vencidas()
RETURNS TABLE(expiradas_con_token integer, expiradas_sin_token integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH expiradas AS (
    UPDATE public.solicitudes_derechos SET estado = 'EXPIRADA', "actualizadaEn" = now()
      WHERE estado = 'PENDIENTE' AND "expiraEn" < now()
      RETURNING "tokenHash")
  SELECT count(*) FILTER (WHERE "tokenHash" IS NOT NULL)::integer,
         count(*) FILTER (WHERE "tokenHash" IS NULL)::integer
  FROM expiradas;
$$;

REVOKE ALL ON FUNCTION public.expirar_solicitudes_derechos_vencidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expirar_solicitudes_derechos_vencidas() TO chainpulse_app;

-- =============================================================================
-- 12. purgar_solicitudes_derechos_segun_retencion
-- =============================================================================
DROP FUNCTION IF EXISTS public.purgar_solicitudes_derechos_segun_retencion();

CREATE FUNCTION public.purgar_solicitudes_derechos_segun_retencion()
RETURNS TABLE(secretos_purgados integer, filas_eliminadas integer, intentos_descartados_purgados integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_secretos integer; v_filas integer; v_intentos integer;
BEGIN
  WITH p AS (
    UPDATE public.solicitudes_derechos
      SET "tokenHash" = NULL, "huellaOrigenHashSolicitud" = NULL, "tokenKeyVersion" = NULL,
          "reclamoId" = NULL, "reclamadoHasta" = NULL -- defensivo: nunca deberian estar pobladas en estado terminal
      WHERE estado IN ('PROCESADA','EXPIRADA','CANCELADA')
        AND ("tokenHash" IS NOT NULL OR "huellaOrigenHashSolicitud" IS NOT NULL)
        AND "actualizadaEn" < now() - interval '72 hours'
      RETURNING id)
  SELECT count(*) INTO v_secretos FROM p;

  WITH d AS (
    DELETE FROM public.solicitudes_derechos
      WHERE estado IN ('PROCESADA','EXPIRADA','CANCELADA')
        AND "actualizadaEn" < now() - interval '1 year'
      RETURNING id)
  SELECT count(*) INTO v_filas FROM d;

  WITH i AS (
    DELETE FROM public.intentos_solicitud_derechos_descartados
      WHERE "creadoEn" < now() - interval '7 days'
      RETURNING id)
  SELECT count(*) INTO v_intentos FROM i;

  RETURN QUERY SELECT v_secretos, v_filas, v_intentos;
END; $$;

REVOKE ALL ON FUNCTION public.purgar_solicitudes_derechos_segun_retencion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purgar_solicitudes_derechos_segun_retencion() TO chainpulse_app;

COMMIT;
