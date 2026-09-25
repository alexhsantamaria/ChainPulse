-- Incremento 4 Bloque B, vertical slice de Cobertura -- agrega
-- ImportacionCsv.procesadaEn (Alex, 2026-09-25: "garantizar recuperacion
-- si se guarda la confirmacion pero falla el encolado" + "un fallo entre
-- lotes no debe dejar resultados parciales como definitivos").
--
-- Por que una columna nueva y no reusar `estado`: el rol de runtime de la
-- app (chainpulse_app) NUNCA tiene BYPASSRLS (prisma/rls.sql, regla
-- explicita) -- ninguna consulta cross-tenant sobre "importaciones_csv"
-- es posible con ese rol, RLS la deja vacia por diseno ("falla cerrado").
-- Eso descarta un job de reconciliacion que escanee "todas las
-- importaciones CONFIRMADA sin terminar" entre tenants: la UNICA cola de
-- trabajo confiable entre tenants es pg-boss (schema "pgboss", fuera de
-- RLS). procesadaEn NO se usa para descubrir trabajo -- solo distingue,
-- para una importacion ya confirmada, "en proceso/reintentando"
-- (procesadaEn null) de "termino con exito" (procesadaEn seteado), para
-- la UI y como salvaguarda extra del propio job (nunca repite el retiro
-- por alcance sobre una importacion que ya quedo procesadaEn).
--
-- Migracion puramente aditiva: 1 columna nullable, sin migracion de
-- datos, sin tocar RLS/GRANT (ya cubren la tabla completa). Escrita a
-- mano por el mismo motivo que el resto de las migraciones de este
-- incremento (ver README.md).

ALTER TABLE "importaciones_csv"
  ADD COLUMN "procesadaEn" TIMESTAMP(3);
