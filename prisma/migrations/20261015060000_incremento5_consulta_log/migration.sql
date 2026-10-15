-- Incremento 5 (Consultas deterministicas mediante catalogo cerrado),
-- I5-13 "Registro auditable de cada consulta" -- ver el comentario de
-- cabecera de ConsultaLog en schema.prisma. Autorizado por Alex (Seccion
-- 8 de la autorizacion de Incremento 5): SOLO se crea este archivo de
-- migracion, SIN ejecutarla contra ninguna base real (sin
-- `prisma migrate dev`/`deploy`, sin Neon) -- queda como archivo
-- versionado y revisable, pendiente de autorizacion posterior para
-- aplicarse. CREATE TABLE puro: ninguna migracion de datos, no existen
-- filas previas.

-- Correccion (auditoria previa al merge, sin ejecutar nada): todo el
-- DDL de este archivo se envuelve explicitamente en BEGIN/COMMIT.
-- Prisma 6 + PostgreSQL no garantiza automaticamente que
-- `prisma migrate deploy` aplique este archivo dentro de una unica
-- transaccion implicita salvo que el propio archivo la declare; este
-- archivo no contiene sentencias no transaccionales (no hay
-- CREATE INDEX CONCURRENTLY ni similares), por lo que envolverlo es
-- seguro y atomico: todo se aplica o nada se aplica.

BEGIN;

-- CreateTable
CREATE TABLE "consultas_log" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "catalogoId" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3),
    "periodoFin" TIMESTAMP(3),
    "resultadoOk" BOOLEAN NOT NULL,
    "numerador" DOUBLE PRECISION,
    "denominador" DOUBLE PRECISION,
    "ruleVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultas_log_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "consultas_log" ADD CONSTRAINT "consultas_log_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultas_log" ADD CONSTRAINT "consultas_log_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultas_log" ADD CONSTRAINT "consultas_log_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTA (auditoria previa al merge): las 3 FK anteriores usan
-- ON DELETE CASCADE. Esto significa que "consultas_log" NO es
-- append-only en sentido absoluto: si se borra la empresa, el
-- usuario o la cadena referenciada, las filas de auditoria
-- correspondientes se eliminan en cascada junto con ellas, en lugar
-- de preservarse indefinidamente. Esta es la misma convencion ya
-- usada en las demas FK de este archivo y es coherente con que hoy
-- no existe ningun flujo de borrado fisico de empresas/usuarios/
-- cadenas en el codigo de la aplicacion -- pero si ese borrado se
-- implementara en el futuro, el historial de auditoria de las
-- consultas de esa empresa/usuario/cadena desaparecera con ella.
-- Mantener CASCADE (en vez de, por ejemplo, SET NULL o RESTRICT) es
-- una decision que Alex debe confirmar o cambiar explicitamente; no
-- se modifica en esta correccion sin esa justificacion explicita.

-- CreateIndex
CREATE INDEX "consultas_log_empresaId_idx" ON "consultas_log"("empresaId");

-- CreateIndex
CREATE INDEX "consultas_log_cadenaId_idx" ON "consultas_log"("cadenaId");

-- CreateIndex
CREATE INDEX "consultas_log_usuarioId_idx" ON "consultas_log"("usuarioId");

-- CreateIndex
CREATE INDEX "consultas_log_catalogoId_idx" ON "consultas_log"("catalogoId");

-- RLS (docs/PATRONES.md Seccion 5, politica escrita en la MISMA
-- migracion que crea la tabla -- mismo criterio ya establecido desde
-- ConsentimientoCuenta/Cadena/ObservacionKpi). "consultas_log" tiene
-- empresaId propio: comparacion directa.
ALTER TABLE "consultas_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_consultas_log ON "consultas_log"
  USING ("empresaId" = current_setting('app.tenant_id', true));

-- Grants -- sin este GRANT explicito, chainpulse_app (el rol de runtime)
-- no hereda privilegios sobre una tabla nueva (mismo motivo documentado
-- en 20260924020000_incremento4_kpis_bloque_a y en cada migracion desde
-- entonces). Un registro de auditoria append-only NUNCA deberia recibir
-- UPDATE/DELETE desde la aplicacion -- se otorga SELECT/INSERT unicamente
-- (a diferencia de las tablas mutables de arriba, que si otorgan las 4),
-- para que un error de programacion no pueda alterar ni borrar un log ya
-- escrito; el rol de base de datos es la segunda capa de defensa, la
-- primera es que el codigo de aplicacion (registrarConsulta.ts) nunca
-- expone un update/delete sobre este modelo.
GRANT SELECT, INSERT ON "consultas_log" TO chainpulse_app;

COMMIT;
