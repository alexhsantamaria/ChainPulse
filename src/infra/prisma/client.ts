import { PrismaClient } from "@prisma/client";

// Cliente base sin scope de tenant. NO se usa directamente en codigo de
// aplicacion fuera de src/infra — ver tenantClient.ts (RNF1, capa 1) y
// prisma/rls.sql (RNF1, capa 2). Usarlo sin pasar por tenantClient() es
// el error exacto que ADR-0001 identifica como el riesgo a mitigar.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
