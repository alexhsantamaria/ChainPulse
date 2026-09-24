-- Corrige el migration.sql original de este bloque (20260924020000),
-- escrito a mano porque Prisma Migrate no puede correr en el entorno de
-- Claude por el bloqueo de red a binaries.prisma.sh (ver README.md). Dos
-- diferencias detectadas con `prisma migrate diff` contra el schema.prisma
-- real, ninguna con perdida de datos (la tabla esta vacia, el seed
-- todavia no corrio cuando se detecto esto).

-- 1. La FK de curadorId no tenia las acciones referenciales que implica
-- el campo opcional en schema.prisma (default de Prisma para relaciones
-- opcionales: ON DELETE SET NULL, ON UPDATE CASCADE) -- sin este fix,
-- borrar un UsuarioPlataforma que curo alguna DefinicionKpi fallaria por
-- violacion de FK en vez de dejar curadorId en null, como corresponde a
-- un campo nullable "a proposito" (ver comentario de schema.prisma).
ALTER TABLE "definicion_kpis" DROP CONSTRAINT "definicion_kpis_curadorId_fkey";
ALTER TABLE "definicion_kpis" ADD CONSTRAINT "definicion_kpis_curadorId_fkey" FOREIGN KEY ("curadorId") REFERENCES "usuarios_plataforma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Nombre de indice unico truncado distinto al que genera Prisma
-- (limite de 63 caracteres de Postgres) -- mismas columnas, mismo
-- comportamiento, solo el nombre difiere. Se renombra para que quede
-- identico a lo que Prisma espera y `migrate dev`/`migrate diff` dejen de
-- marcar drift fantasma en cada corrida futura.
ALTER INDEX "observaciones_kpi_cadenaId_definicionKpiId_periodoInicio_p_key" RENAME TO "observaciones_kpi_cadenaId_definicionKpiId_periodoInicio_pe_key";
