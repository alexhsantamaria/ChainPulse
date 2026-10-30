ALTER TABLE public.usuarios_plataforma
  ADD COLUMN activo boolean NOT NULL DEFAULT true,
  ADD COLUMN "sessionVersion" integer NOT NULL DEFAULT 1,
  ADD COLUMN "mfaUltimoContadorUsado" integer;
