import { z } from "zod";

export const reordenarSchema = z.object({
  ordenes: z.array(z.object({ id: z.string().trim().min(1), orden: z.number().int() })).min(1),
});
