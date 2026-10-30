-- Preauditoria informativa: conserva evidencia de cualquier colision antes del bloqueo.
SELECT lower(btrim(email)) AS email_normalizado, array_agg(id) AS ids, count(*)
FROM public.usuarios_plataforma
GROUP BY lower(btrim(email))
HAVING count(*) > 1;

DO $$
DECLARE v_duplicados integer;
BEGIN
  SELECT count(*) INTO v_duplicados FROM (
    SELECT lower(btrim(email)) FROM public.usuarios_plataforma
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) t;
  IF v_duplicados > 0 THEN
    RAISE EXCEPTION 'RF19_EMAIL_DUPLICADO: existen % grupos duplicados -- resolver manualmente.', v_duplicados;
  END IF;
END;
$$;

CREATE UNIQUE INDEX uq_usuarios_plataforma_email_normalizado
  ON public.usuarios_plataforma (lower(btrim(email)));
