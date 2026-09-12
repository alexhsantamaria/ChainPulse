// Infraestructura — extension de Prisma que inyecta el filtro de tenant en cada consulta (RNF1, capa 1).
import { Prisma } from "@prisma/client";
import { prisma } from "./client";

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
// Modelos con "empresaId" propio: se envuelve cada consulta en una
// transaccion que primero fija la variable de sesion de Postgres que
// consume prisma/rls.sql (capa 2), y se inyecta el filtro de tenant en el
// WHERE de cada operacion. Aunque una consulta "olvide" el filtro en el
// codigo de aplicacion, RLS igual la bloquea del lado de la base — las
// dos capas son independientes a proposito (ADR-0001, "cinturon y
// tirantes").
//
// EvaluacionExpres y sus hijas NO pasan por aqui: no tienen empresaId
// (adenda de ADR-0001) y se consultan con `prisma` directo.

const TENANT_SCOPED_MODELS = new Set([
  "Empresa",
  "Usuario",
  "Eslabon",
  "Conexion",
  "CicloPulso",
]);

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

function uncapitalize(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

// Empresa se filtra por "id"; el resto de los modelos tenant-scoped tiene
// una columna "empresaId" propia.
function injectTenantFilter(
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  empresaId: string,
): Record<string, unknown> {
  const tenantField = model === "Empresa" ? "id" : "empresaId";
  const base = args ?? {};

  if (operation === "create") {
    return {
      ...base,
      data: { ...(base.data as object), [tenantField]: empresaId },
    };
  }

  if (operation === "createMany" && Array.isArray((base as { data?: unknown[] }).data)) {
    const data = (base as { data: Record<string, unknown>[] }).data;
    return { ...base, data: data.map((d) => ({ ...d, [tenantField]: empresaId })) };
  }

  const where = { ...(base.where as object), [tenantField]: empresaId };
  return { ...base, where };
}

export type TenantPrismaClient = ReturnType<typeof tenantClient>;
export { Prisma };
