import { z } from "zod";

export const editarMetadataSchema = z.object({
  notasCambio: z.string().trim().max(2000).nullable(),
});
