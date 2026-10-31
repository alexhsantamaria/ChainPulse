import { z } from "zod";

export const publicarSchema = z.object({
  // Obligatorio y explicito -- nunca opcional: el llamador debe declarar
  // que version cree que esta vigente ahora mismo (o null, si cree que
  // no hay ninguna), para que publicar_cuestionario_version() (§7.8,
  // paso 3) pueda detectar con IS DISTINCT FROM una vigente cambiada
  // entre que la UI cargo la pantalla y que el curador confirmo publicar.
  versionVigenteEsperadaId: z.string().trim().min(1).nullable(),
});
