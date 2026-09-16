-- R5-25 (Ronda 5, BAJO) -- indices que faltaban desde la migracion del
-- Incremento 2: "curadorId" de CuestionarioVersion (nullable, pero sin
-- indice cualquier lookup/JOIN por curador es un scan completo) y
-- "preguntaVersionId" de Respuesta (el unique existente la tiene como
-- SEGUNDA columna, asi que no sirve para resolver consultas que filtran
-- solo por preguntaVersionId -- regla del prefijo izquierdo).
CREATE INDEX "cuestionario_versiones_curadorId_idx" ON "cuestionario_versiones"("curadorId");
CREATE INDEX "respuestas_preguntaVersionId_idx" ON "respuestas"("preguntaVersionId");

-- R5-18 (Ronda 5, BAJO) -- los dos indices de consentimiento (RF23/RF24)
-- se recrean con "createdAt" al final: la consulta real es "el
-- consentimiento vigente mas reciente para esta finalidad", que hoy
-- resuelve el filtro con el indice pero ordena aparte (sort en memoria).
-- Se elimina el indice viejo y se crea el nuevo con el mismo nombre que
-- hubiera generado `prisma migrate dev` a partir del schema ya editado,
-- para que una futura corrida no detecte "drift".
DROP INDEX "consentimientos_expres_evaluacionExpresV2Id_finalidad_idx";
CREATE INDEX "consentimientos_expres_evaluacionExpresV2Id_finalidad_createdAt_idx"
  ON "consentimientos_expres"("evaluacionExpresV2Id", "finalidad", "createdAt");

DROP INDEX "consentimientos_cuenta_empresaId_usuarioId_finalidad_idx";
CREATE INDEX "consentimientos_cuenta_empresaId_usuarioId_finalidad_createdAt_idx"
  ON "consentimientos_cuenta"("empresaId", "usuarioId", "finalidad", "createdAt");
