-- ChainPulse -- RF24 (derechos/retiro), migracion 2 de 3.
--
-- Diseno cerrado (ver cabecera de la migracion 1 de este mismo paquete
-- para el orden de autoridad completo). Depende de que la migracion 1
-- (20261022080000_rf24_enum_bucket_limite_tasa) ya haya sido COMMITeada
-- en una transaccion anterior -- esta migracion no usa los valores
-- nuevos del enum BucketLimiteTasa (eso es codigo de aplicacion, PR-B),
-- asi que no hay conflicto de orden, pero la dependencia de aplicacion
-- (esta migracion debe aplicarse despues) se deja explicita.
--
-- ALCANCE EXACTO de esta migracion:
--   A) Los 4 enums nuevos de RF24 (CREATE TYPE -- a diferencia de
--      ALTER TYPE ... ADD VALUE, un enum recien creado SI puede usarse
--      dentro de la misma transaccion/migracion que lo crea).
--   B) La tabla "solicitudes_derechos" con el modelo de despacho y
--      fencing ya cerrado (tokenHash, tokenKeyVersion, envioConfirmadoEn,
--      intentosEnvio, reclamoId, reclamadoHasta) + sus constraints,
--      indices y FK hacia evaluaciones_expres_v2.
--   C) La tabla senuelo "intentos_solicitud_derechos_descartados" (sin
--      FK, sin dato identificante).
--   D) La columna "accesoPublicoRevocadoEn" en "evaluaciones_expres_v2".
--   E) [CORRECCION Alex, 2026-10-22, puntos 3 y 4 sobre la entrega
--      original de PR-A] El FK real de "resueltoPorUsuarioId" hacia
--      "usuarios" (antes una columna suelta sin relacion) + 5
--      constraints de integridad adicionales sobre "solicitudes_
--      derechos": coherencia resueltoCanal/administrador, pareja
--      tokenHash/tokenKeyVersion, envio confirmado solo con token
--      preparado, pareja reclamoId/reclamadoHasta, intentosEnvio no
--      negativo y tokenKeyVersion positivo. Ver el detalle de cada una
--      junto a su ALTER TABLE abajo.
--
-- PRIVILEGIOS -- DECISION INTENCIONAL, no un olvido: a diferencia de
-- cada tabla anterior de este proyecto (que otorga GRANT a chainpulse_app
-- inmediatamente despues de crearse), estas 2 tablas NO reciben ningun
-- privilegio directo (ni SELECT, ni INSERT, ni UPDATE, ni DELETE) para
-- chainpulse_app en esta migracion. Toda interaccion pasa exclusivamente
-- por las funciones SECURITY DEFINER de la migracion 3 -- ver esa
-- migracion para los GRANT EXECUTE correspondientes. El REVOKE ALL ...
-- FROM PUBLIC de abajo es ademas-de-cinturon-y-tirantes (Postgres no
-- otorga privilegios de tabla a PUBLIC por defecto) -- se deja explicito
-- por el mismo criterio de explicitud ya usado en el resto del proyecto
-- para las funciones.
--
-- RLS -- DECISION INTENCIONAL, documentada aqui: ninguna de estas 2
-- tablas tiene columna "empresaId" (no son datos multi-tenant de un
-- Usuario/Empresa) -- igual que "evaluaciones_expres_v2" y sus hijas ya
-- existentes (Respuesta, ConsentimientoExpres, HallazgoExpres,
-- confirmado en prisma/rls.sql, ninguna tiene politica RLS), estas 2
-- tablas NO reciben ninguna politica RLS. Esta ausencia se reverifica
-- explicitamente en el gate de la rama temporal de Neon (v5 Seccion 19)
-- como parte de la verificacion de privilegios, no se asume aqui sin
-- prueba.
--
-- Transaccional de punta a punta (sin CREATE INDEX CONCURRENTLY ni
-- ninguna sentencia no transaccional) -- mismo criterio que
-- 20261015060000_incremento5_consulta_log.

BEGIN;

-- CreateEnum
CREATE TYPE "AlcanceRetiro" AS ENUM ('DIAGNOSTICO', 'INVESTIGACION', 'AMBAS_FINALIDADES');

-- CreateEnum
CREATE TYPE "TipoSolicitudDerechos" AS ENUM ('RETIRO_CONSENTIMIENTO', 'ELIMINACION_CONTACTO', 'RETIRO_Y_ELIMINACION');

-- CreateEnum
CREATE TYPE "EstadoSolicitudDerechos" AS ENUM ('PENDIENTE', 'PROCESADA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoResolucion" AS ENUM ('AUTOMATICO', 'SOPORTE');

-- AlterTable (evaluaciones_expres_v2 -- Seccion 10 de v5: revocacion de
-- acceso publico, comprobada antes de cualquier otra logica en las 4
-- rutas publicas que dependen solo del id de esta tabla)
ALTER TABLE "evaluaciones_expres_v2" ADD COLUMN "accesoPublicoRevocadoEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "solicitudes_derechos" (
    "id" TEXT NOT NULL,
    "evaluacionExpresV2Id" TEXT NOT NULL,
    "tipo" "TipoSolicitudDerechos" NOT NULL,
    "alcanceRetiro" "AlcanceRetiro",
    "tokenHash" TEXT,
    "tokenKeyVersion" INTEGER,
    "huellaOrigenHashSolicitud" TEXT,
    "envioConfirmadoEn" TIMESTAMP(3),
    "intentosEnvio" INTEGER NOT NULL DEFAULT 0,
    "reclamoId" TEXT,
    "reclamadoHasta" TIMESTAMP(3),
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "consumidoEn" TIMESTAMP(3),
    "estado" "EstadoSolicitudDerechos" NOT NULL DEFAULT 'PENDIENTE',
    "resueltoCanal" "EstadoResolucion",
    "resueltoPorUsuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadaEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitudes_derechos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intentos_solicitud_derechos_descartados" (
    "id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intentos_solicitud_derechos_descartados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique -- lookup por token en la confirmacion del visitante)
CREATE UNIQUE INDEX "solicitudes_derechos_tokenHash_key" ON "solicitudes_derechos"("tokenHash");

-- CreateIndex
CREATE INDEX "solicitudes_derechos_evaluacionExpresV2Id_createdAt_idx" ON "solicitudes_derechos"("evaluacionExpresV2Id", "createdAt");

-- CreateIndex
CREATE INDEX "solicitudes_derechos_estado_expiraEn_idx" ON "solicitudes_derechos"("estado", "expiraEn");

-- CreateIndex (soporta el reclamo atomico por lotes -- WHERE estado=
-- 'PENDIENTE' AND "envioConfirmadoEn" IS NULL AND "reclamadoHasta" ...)
CREATE INDEX "solicitudes_derechos_estado_envioConfirmadoEn_idx" ON "solicitudes_derechos"("estado", "envioConfirmadoEn");

-- CreateIndex -- CORRECCION Alex 2026-10-22 (segunda ronda, punto 2):
-- soporta la busqueda "que solicitudes resolvio este administrador" sin
-- escanear toda la tabla; la columna ahora ademas es el lado referenciado
-- por un ON DELETE RESTRICT, por lo que una eventual verificacion previa
-- de "tiene filas referenciadas" tambien se beneficia de este indice.
CREATE INDEX "solicitudes_derechos_resueltoPorUsuarioId_idx" ON "solicitudes_derechos"("resueltoPorUsuarioId");

-- AddForeignKey
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "solicitudes_derechos_evaluacionExpresV2Id_fkey" FOREIGN KEY ("evaluacionExpresV2Id") REFERENCES "evaluaciones_expres_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey -- CORRECCION Alex 2026-10-22 punto 3 (primera ronda),
-- endurecida en la segunda ronda (punto 2): antes "resueltoPorUsuarioId"
-- era una columna TEXT suelta, sin FK ni relacion declarada en
-- schema.prisma; la primera correccion la fijo con ON DELETE SET NULL
-- (mismo criterio que "importaciones_csv_confirmadaPorId_fkey",
-- Incremento 4 Bloque B). Alex pidio endurecerla a ON DELETE RESTRICT:
-- un administrador que resolvio al menos una SolicitudDerechos por el
-- canal SOPORTE NO puede borrarse mientras esa fila exista -- preserva
-- la trazabilidad real de quien resolvio cada solicitud de derechos en
-- vez de dejarla huerfana (NULL) silenciosamente. Quien quiera borrar
-- a ese Usuario debe primero decidir que hacer con esas filas
-- (reasignarlas, purgarlas via retencion, etc.) -- nunca perder el
-- registro de forma automatica.
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "solicitudes_derechos_resueltoPorUsuarioId_fkey" FOREIGN KEY ("resueltoPorUsuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateConstraint -- retiro exige alcance; eliminacion de contacto nunca
-- lo acepta (v5 Seccion 1; evita un estado ambiguo de "retiro sin decir
-- de que").
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "alcance_retiro_coherente" CHECK (
  ("tipo" = 'ELIMINACION_CONTACTO' AND "alcanceRetiro" IS NULL)
  OR ("tipo" IN ('RETIRO_CONSENTIMIENTO', 'RETIRO_Y_ELIMINACION') AND "alcanceRetiro" IS NOT NULL)
);

-- CreateConstraint -- formato exacto de un sha256 en hexadecimal (64
-- caracteres). NULL es valido (fila aun no preparada -- Seccion 6 de v5).
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "token_hash_formato" CHECK (
  "tokenHash" IS NULL OR ("tokenHash" ~ '^[0-9a-f]{64}$')
);

-- CreateConstraint -- CORRECCION Alex 2026-10-22 punto 3: coherencia
-- entre resueltoCanal y la presencia de un administrador identificado.
-- El canal AUTOMATICO (funcion 3, procesar_solicitud_derechos) NUNCA
-- fija resueltoPorUsuarioId; el canal SOPORTE (funcion 4,
-- resolver_solicitud_por_soporte) SIEMPRE lo fija. Una fila sin
-- resolver todavia (resueltoCanal NULL) tampoco tiene administrador.
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "resuelto_canal_administrador_coherente" CHECK (
  ("resueltoCanal" IS NULL AND "resueltoPorUsuarioId" IS NULL)
  OR ("resueltoCanal" = 'AUTOMATICO' AND "resueltoPorUsuarioId" IS NULL)
  OR ("resueltoCanal" = 'SOPORTE' AND "resueltoPorUsuarioId" IS NOT NULL)
);

-- CreateConstraint -- CORRECCION Alex 2026-10-22 punto 4(a): tokenHash y
-- tokenKeyVersion viajan SIEMPRE juntos (asignar_token_pendiente los
-- escribe en la misma UPDATE; las funciones 9/10/12 los limpian en la
-- misma UPDATE) -- nunca uno sin el otro.
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "token_hash_version_pareja" CHECK (
  ("tokenHash" IS NULL AND "tokenKeyVersion" IS NULL)
  OR ("tokenHash" IS NOT NULL AND "tokenKeyVersion" IS NOT NULL)
);

-- CreateConstraint -- CORRECCION Alex 2026-10-22 punto 4(b): un envio no
-- puede quedar confirmado sin un token ya preparado (orden exigido:
-- asignar_token_pendiente ANTES de confirmar_envio_token -- la propia
-- funcion 7 ya lo exige en su WHERE, esto lo cierra tambien a nivel de
-- tabla). Excepcion deliberada para estados terminales: purgar_
-- solicitudes_derechos_segun_retencion (funcion 12) nulifica tokenHash
-- a las 72h aunque envioConfirmadoEn (un registro historico que nunca
-- se borra hasta que la fila entera se elimina al año) siga poblado --
-- sin esta excepcion, la propia purga violaria esta constraint.
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "envio_confirmado_requiere_token" CHECK (
  "envioConfirmadoEn" IS NULL
  OR "tokenHash" IS NOT NULL
  OR estado IN ('PROCESADA', 'EXPIRADA', 'CANCELADA')
);

-- CreateConstraint -- CORRECCION Alex 2026-10-22 punto 4(c): reclamoId y
-- reclamadoHasta viajan SIEMPRE juntos (funcion 5 los escribe juntos;
-- las funciones 3/7/8/9/10 los limpian juntos) -- nunca uno sin el otro.
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "reclamo_lease_pareja" CHECK (
  ("reclamoId" IS NULL AND "reclamadoHasta" IS NULL)
  OR ("reclamoId" IS NOT NULL AND "reclamadoHasta" IS NOT NULL)
);

-- CreateConstraint -- CORRECCION Alex 2026-10-22 punto 4(d): intentosEnvio
-- nunca es negativo (defensivo -- la funcion 5 solo lo incrementa).
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "intentos_envio_no_negativo" CHECK (
  "intentosEnvio" >= 0
);

-- CreateConstraint -- CORRECCION Alex 2026-10-22 punto 4(e): tokenKeyVersion,
-- cuando no es NULL, es siempre positiva (version de clave HMAC real,
-- nunca 0 ni negativa).
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "token_key_version_positivo" CHECK (
  "tokenKeyVersion" IS NULL OR "tokenKeyVersion" > 0
);

-- Privilegios -- ver nota de cabecera: intencionalmente SIN ningun GRANT
-- a chainpulse_app sobre estas 2 tablas. Explicito, no implicito.
REVOKE ALL ON "solicitudes_derechos" FROM PUBLIC;
REVOKE ALL ON "intentos_solicitud_derechos_descartados" FROM PUBLIC;

COMMIT;
