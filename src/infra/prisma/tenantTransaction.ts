// Infraestructura — transaccion manual de tenant con inyeccion automatica de filtro (RNF1, capa 1).
//
// Declarado estandar oficial en PLAN-DE-TRABAJO.md Seccion 18.3.B (Ronda 4
// de cierre de brechas), a partir del patron manual + set_config ya usado
// en registrarEmpresaYAdmin() (src/infra/auth/registro.ts). Resuelve un
// gap real: tenantClient() inyecta el filtro de tenant automaticamente,
// pero abre una transaccion NUEVA por cada operacion ($allOperations ->
// prisma.$transaction() por llamada) — no da atomicidad entre dos
// llamadas (ej. crear una Cadena y sus Nodos en la misma operacion,
// Incremento 3). tenantTransaction() da las dos cosas a la vez: una sola
// transaccion Y la inyeccion automatica, reutilizando (nunca duplicando)
// TENANT_SCOPED_MODELS/injectTenantFilter/uncapitalize de tenantClient.ts.
//
// Cuando usar cada uno (ver tambien docs/PATRONES.md):
//   - Lectura, o escritura a un solo modelo tenant-scoped -> tenantClient(empresaId)
//   - Operacion que escribe en 2+ modelos que deben confirmarse o fallar
//     juntos -> tenantTransaction(empresaId, fn)
//   - Dentro del callback de tenantTransaction(): usar solo el `tx`
//     recibido, nunca instanciar tenantClient() adentro.
//   - CSV masivo (Incremento 4): tenantTransaction() por lote de ~500
//     filas, nunca el archivo completo (riesgo de timeout/idle-in-transaction
//     en Neon con una sola transaccion gigante).
//
// Convencion de nombre (heuristica barata de revision, H3 de la Ronda 3):
// toda funcion que use tenantTransaction() se nombra "xxxAtomico"/
// "crearXxxCompleto", para que un `grep -rn "tenantClient(" src/` que
// encuentre mas de una llamada en la misma funcion sea candidato a
// revision.
import { prisma } from "./client";
import { TENANT_SCOPED_MODELS, injectTenantFilter } from "./tenantClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo criterio que tenantClient.ts: tipos exactos pendientes de `prisma generate` con red real.
type ScopedTx = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
function buildScopedTx(tx: any, empresaId: string): ScopedTx {
  return new Proxy(tx, {
    get(target, modelProp: string) {
      const delegate = target[modelProp];
      // Ronda 5 de revision: metodos de nivel superior del propio `tx`
      // (`$executeRaw`, `$queryRaw`, etc., ver src/infra/auth/rateLimit.ts)
      // son funciones, no "modelos" -- se devuelven ligadas (`.bind(target)`)
      // en vez de sin ligar, porque el Proxy invoca la funcion con `this`
      // apuntando al propio Proxy, no al `target` real, y el cliente de
      // Prisma generado puede depender de campos privados de la instancia
      // real para resolver la conexion -- sin el bind, una llamada como
      // `tx.$executeRaw\`...\`` a traves de este Proxy podria fallar en
      // runtime aunque typecheck/lint no lo detecten (nunca se habia
      // ejercitado este camino: tenantTransaction() no tenia ningun uso
      // real hasta esta ronda).
      if (typeof delegate === "function") return delegate.bind(target);
      if (delegate === null || typeof delegate !== "object") return delegate;
      const model = modelProp.charAt(0).toUpperCase() + modelProp.slice(1);
      if (!TENANT_SCOPED_MODELS.has(model)) return delegate;
      return new Proxy(delegate, {
        get(mTarget, operation: string) {
          const fn = mTarget[operation];
          if (typeof fn !== "function") return fn;
          return (args: Record<string, unknown>) =>
            fn.call(mTarget, injectTenantFilter(model, operation, args, empresaId));
        },
      });
    },
  });
}

export async function tenantTransaction<T>(
  empresaId: string,
  fn: (tx: ScopedTx) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  if (!empresaId) {
    // Mismo criterio de "fallar cerrado" que tenantClient().
    throw new Error("tenantTransaction requiere un empresaId no vacio");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    return fn(buildScopedTx(tx, empresaId));
  }, options);
}
