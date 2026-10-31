import { z } from "zod";

export const validarOpcionesSchema = z.object({
  opciones: z.unknown().refine((v) => v !== undefined, { message: "opciones requerido" }),
});
