-- Incremento 4 Bloque B -- metadata de cifrado de aplicacion (envelope
-- encryption AES-256-GCM) para el CSV subido a R2. Decision confirmada
-- por Alex el 2026-09-24 (docs/ADR/0006-cifrado-r2.md, ver tambien
-- PLAN-DE-TRABAJO.md): el objeto que llega a R2 es SIEMPRE ciphertext,
-- nunca el CSV en claro, ni siquiera transitoriamente. Estas cinco
-- columnas son SOLO la DEK (Data Encryption Key) ya ENVUELTA (cifrada
-- con la clave maestra R2_ENCRYPTION_KEY_ACTIVA o una clave ya rotada) --
-- nunca la DEK en claro, ni el contenido del archivo, que jamas toca
-- Postgres (ver "objetoStorageKey", columna preexistente).
--
-- Todas nullable: quedan NULL entre "fila creada" y "el servidor cifro
-- el archivo y subio el objeto a R2" -- ambos pasos ocurren en la misma
-- operacion (nunca hay un estado intermedio de objeto sin cifrar en R2).
--
-- "cifradoClaveId" es lo que permite rotar R2_ENCRYPTION_KEY_ACTIVA sin
-- re-cifrar ningun archivo ya subido: cada fila recuerda con que clave
-- maestra se envolvio SU dek, sin importar cual sea la clave activa hoy
-- -- ver src/infra/storage/cifradoObjeto.ts y SEGURIDAD-credenciales.md
-- para la politica completa de custodia/rotacion/retencion.
ALTER TABLE "importaciones_csv"
  ADD COLUMN "cifradoVersion" INTEGER,
  ADD COLUMN "cifradoClaveId" TEXT,
  ADD COLUMN "cifradoDek" TEXT,
  ADD COLUMN "cifradoDekIv" TEXT,
  ADD COLUMN "cifradoDekAuthTag" TEXT;
