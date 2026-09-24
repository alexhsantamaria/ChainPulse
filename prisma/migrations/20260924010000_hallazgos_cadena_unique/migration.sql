-- Bloque C Paso 3 (RF38/RF39, PLAN-DE-TRABAJO.md "Bloque C") -- identidad
-- real de HallazgoCadena: una fila DIFERENCIA activa por dimension y por
-- alcance (cadena completa o conexion puntual). NO expresable como
-- @@unique de Prisma porque conexionCadenaId es nullable (Postgres trata
-- cada NULL como distinto en una unique constraint normal) -- mismo
-- problema y misma solucion que 20260924000000_respuesta_cadena: dos
-- indices UNICOS PARCIALES en vez de uno solo. No los borres en un futuro
-- `prisma migrate dev` por "drift", son intencionales; ver el comentario
-- en HallazgoCadena de schema.prisma que remite aca.

CREATE UNIQUE INDEX "hallazgos_cadena_cadena_dimension_key"
  ON "hallazgos_cadena" ("cadenaId", "dimension")
  WHERE "conexionCadenaId" IS NULL;

CREATE UNIQUE INDEX "hallazgos_cadena_conexion_dimension_key"
  ON "hallazgos_cadena" ("conexionCadenaId", "dimension")
  WHERE "conexionCadenaId" IS NOT NULL;
