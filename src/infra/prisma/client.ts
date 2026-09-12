// Infraestructura — instancia base de Prisma Client, sin scope de tenant.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ADR-0003 (adenda ARM64): sin este adapter, PrismaClient carga un motor
// nativo (query_engine-*.node) que no existe para Windows ARM64 — ver el
// comentario de engineType en prisma/schema.prisma. El adapter usa el
// driver "pg" (node-postgres) puro TypeScript, portable a cualquier
// arquitectura.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Cliente base sin scope de tenant. NO se usa directamente en codigo de
// aplicacion fuera de src/infra — ver tenantClient.ts (RNF1, capa 1) y
// prisma/rls.sql (RNF1, capa 2). Usarlo sin pasar por tenantClient() es
// el error exacto que ADR-0001 identifica como el riesgo a mitigar.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
