import { z } from "zod";

export const editarPreguntaSchema = z.object({
  texto: z.string().trim().min(1).max(2000),
  dimension: z.enum(["ALINEACION", "COORDINACION", "INTEGRACION", "EVIDENCIA", "RESILIENCIA"]),
  opciones: z.unknown().refine((v) => v !== undefined, { message: "opciones requerido" }),
  esNoPuntuable: z.boolean(),
});
