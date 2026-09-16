// Infraestructura — extension de Prisma que inyecta el filtro de tenant en cada consulta (RNF1, capa 1).
import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { TENANT_SCOPED_MODELS, injectTenantFilter, uncapitalize } from "./tenantScope";

// RNF1, capa 1 (middleware de Prisma) — ADR-0001.
//
// NOTA para quien retome esto: los tipos de `$extends`/`$allOperations`
// los genera `prisma generate` a partir de schema.prisma. Esta sesion no
// pudo ejecutar `prisma generate` (binaries.prisma.sh esta bloqueado por
// la politica de red del entorno — ver el mensaje que acompaña este
// commit/PR) asi que los parametros de abajo estan tipados como `any` a
// proposito, no por descuido: correr `npm run prisma:generate` una vez
// con acceso de red real y volver a `tsc --noEmit` debe bastar para que
// TypeScript infiera los tipos exactos del cliente generado; en ese punto
// vale la pena quitar los `any` y dejar que la inferencia haga el trabajo.
//
// R5-6 (Ronda 5) -- TENANT_SCOPED_MODELS, injectTenantFilter y
// uncapitalize se movieron a ./tenantScope.ts (modulo puro, sin import de
// Prisma) para que las pruebas unitarias de injectTenantFilter() no
// arrastren la construccion del singleton real de PrismaClient con solo
// cargar el modulo -- ver el comentario de cabecera de tenantScope.ts.
// Se re-exportan aqui sin cambios para no romper a quien ya las importa
// desde este archivo (tenantTransaction.ts, etc.).
export { TENANT_SCOPED_MODELS, injectTenantFilter, uncapitalize };

export function tenantClient(empresaId: string) {
  if (!empresaId) {
    // Fallar cerrado: sin tenantId no hay cliente, nunca un cliente
    // "abierto" a todos los tenants.
    throw new Error("tenantClient requiere un empresaId no vacio");
  }

  return prisma.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
          return prisma.$transaction(async (tx: any) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;

            const scopedArgs = injectTenantFilter(model, operation, args, empresaId);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
            return (tx as any)[uncapitalize(model)][operation](scopedArgs);
          });
        },
      },
    },
  });
}

export type TenantPrismaClient = ReturnType<typeof tenantClient>;
export { Prisma };
