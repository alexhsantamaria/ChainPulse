// Infraestructura — logica PURA de aislamiento de tenant (R5-6 y su
// hallazgo colateral: extraida de tenantClient.ts en la Ronda 5 de
// revision para que las pruebas unitarias de injectTenantFilter() puedan
// importar solo esto, sin arrastrar la construccion del singleton real de
// PrismaClient (src/infra/prisma/client.ts). Antes de esta extraccion,
// tenantClient.test.ts (Ronda 5) importaba estas funciones desde
// tenantClient.ts, que en su primera linea hace `import { prisma } from
// "./client"` — eso alcanza para que "npm run test" (sin red, sin
// "prisma generate" corrido) explote con "PrismaClient did not initialize
// yet" al solo cargar el modulo, el mismo problema que el comentario de
// src/infra/retencion.ts ya documenta para ese archivo. Este modulo no
// importa Prisma en absoluto: es seguro de importar desde cualquier
// prueba unitaria sin tocar la base de datos.
//
// tenantClient.ts sigue siendo el punto de entrada publico de estas tres
// exportaciones (las re-exporta) para no romper a quien ya las importa
// desde ahi (tenantTransaction.ts, etc.) — este archivo es un detalle de
// implementacion interno, no una segunda API paralela.

// RNF1, capa 1 (middleware de Prisma) — ADR-0001.
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

// Exportado (Incremento 2, PLAN-DE-TRABAJO.md Seccion 18.3.B): lo reusa
// src/infra/prisma/tenantTransaction.ts para inyectar el mismo filtro de
// tenant dentro de una transaccion manual con set_config, sin duplicar
// esta logica. "ConsentimientoCuenta" es la primera tabla tenant-scoped
// nueva desde el Incremento 1 (Seccion 18.2.A) — toda tabla nueva con
// empresaId propio se agrega aqui en la misma migracion que la crea,
// nunca despues (regla de docs/PATRONES.md, Seccion 18.1.C).
// Incremento 3 (Mapa y profundidad, requirements.md Seccion 14) --
// Cadena/Nodo/ConexionCadena/HallazgoCadena tienen empresaId propio
// denormalizado (mismo criterio que Eslabon/Conexion/ConsentimientoCuenta,
// PATRONES.md Seccion 5) y entran aqui en la misma migracion que las crea
// (20260920040000_incremento3_mapa_bloque_a). FlujoConexionCadena NO entra
// -- es una tabla hija sin empresaId propio, mismo patron que
// RespuestaCruda: se protege via el filtro ya aplicado a su padre
// (ConexionCadena) mas la politica RLS por subconsulta de la migracion.
export const TENANT_SCOPED_MODELS = new Set([
  "Empresa",
  "Usuario",
  "Eslabon",
  "Conexion",
  "CicloPulso",
  "ConsentimientoCuenta",
  "Cadena",
  "Nodo",
  "ConexionCadena",
  "HallazgoCadena",
]);

export function uncapitalize(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

// Empresa se filtra por "id"; el resto de los modelos tenant-scoped tiene
// una columna "empresaId" propia.
export function injectTenantFilter(
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

  // R5-6 -- "upsert" tiene DOS ramas de datos, no una: si solo se
  // inyectara el filtro en "where" (como el resto de las operaciones),
  // la rama "create" quedaria sin el campo de tenant cuando el registro
  // no existe todavia -- en el mejor caso falla por NOT NULL, en el peor
  // (si el campo tuviera un default) crearia una fila fuera del tenant
  // correcto. Se inyecta en ambas ramas.
  if (operation === "upsert") {
    const where = { ...(base.where as object), [tenantField]: empresaId };
    const create = { ...(base.create as object), [tenantField]: empresaId };
    return { ...base, where, create };
  }

  const where = { ...(base.where as object), [tenantField]: empresaId };
  return { ...base, where };
}
