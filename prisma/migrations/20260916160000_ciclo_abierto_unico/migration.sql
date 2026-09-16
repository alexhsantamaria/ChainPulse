-- R5-7 (Ronda 5, ALTO) -- RF5 exige un solo ciclo ABIERTO por empresa, pero
-- antes de esta migracion esa regla se comprobaba solo a nivel aplicacion
-- (un findFirst antes del create en abrirCiclo.ts), lo que deja una
-- ventana de carrera entre dos invocaciones concurrentes: ambas pueden
-- pasar el findFirst antes de que la primera termine su create.
--
-- Un indice UNICO PARCIAL (solo sobre las filas con estado = 'ABIERTO')
-- cierra la ventana a nivel de base de datos: Postgres solo permite una
-- fila ABIERTO por empresaId, sin importar la concurrencia. No es
-- representable en schema.prisma (Prisma no expresa indices parciales en
-- su DSL), asi que -- mismo patron que prisma/rls.sql -- queda como SQL a
-- mano en esta migracion; schema.prisma trae un comentario que remite aqui
-- para que una futura `prisma migrate dev` no lo de por sorpresa ni lo
-- intente borrar por "drift".
CREATE UNIQUE INDEX "ciclos_pulso_empresaId_abierto_key"
  ON "ciclos_pulso" ("empresaId")
  WHERE "estado" = 'ABIERTO';
