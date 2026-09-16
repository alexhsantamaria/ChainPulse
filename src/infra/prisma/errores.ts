// Infraestructura — helper de error de Prisma (Ronda 5 de revision,
// R5-23). Duck-typing en vez de `instanceof Prisma.PrismaClientKnownRequestError`
// porque `engineType="client"` (ADR-0003, adenda ARM64) no reexporta ese
// tipo desde "@prisma/client" -- el codigo de error si esta presente en
// runtime. El mismo bloque de 3 lineas estaba copiado literal en
// conexiones/route.ts, registro.ts y aceptarInvitacion.ts; este archivo
// es ahora el unico lugar que lo define.
export function codigoErrorPrisma(err: unknown): string | undefined {
  return err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
}

/** true si el error es una violacion de restriccion unica (P2002) de Prisma. */
export function esViolacionUnica(err: unknown): boolean {
  return codigoErrorPrisma(err) === "P2002";
}
