import { z } from "zod";

export const crearPreguntaSchema = z.object({
  codigo: z.string().trim().min(1).max(50),
  orden: z.number().int(),
  texto: z.string().trim().min(1).max(2000),
  dimension: z.enum(["ALINEACION", "COORDINACION", "INTEGRACION", "EVIDENCIA", "RESILIENCIA"]),
  // La estructura de "opciones" (array, {valor,texto,orden}, sin
  // duplicados, orden 0..N-1) NO se revalida aqui -- eso duplicaria
  // validar_estructura_opciones_pregunta() (§7.8), que es quien decide.
  // Un borrador puede guardar "opciones" todavia mal formadas; solo se
  // exige que el campo exista.
  opciones: z.unknown().refine((v) => v !== undefined, { message: "opciones requerido" }),
  esNoPuntuable: z.boolean(),
});
