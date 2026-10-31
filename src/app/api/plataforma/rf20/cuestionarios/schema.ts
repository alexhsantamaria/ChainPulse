import { z } from "zod";

export const crearCuestionarioSchema = z.object({
  codigo: z.string().trim().min(1).max(100),
});
