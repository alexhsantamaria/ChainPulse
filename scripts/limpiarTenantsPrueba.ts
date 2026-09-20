// Script de mantenimiento — borra tenants sinteticos huerfanos dejados por
// una corrida de test:integration que fallo a mitad de camino (si
// beforeAll revienta despues de crear el tenant pero antes de que la
// funcion retorne, el afterAll de la prueba nunca llega a tener el
// empresaId y no lo limpia — caso real: la corrida en Windows del
// 2026-09-20 que encontro el bug de HallazgoCadena.empresaId, ver
// PLAN-DE-TRABAJO.md Seccion "Incremento 3 — Bloque A").
//
// Solo toca empresas cuyo nombre contiene la marca "borrar si queda
// huerfana" -- la misma marca que ya usan a proposito TODOS los fixtures
// de prueba de integracion de este repo
// (aislamientoMultitenant.integration.test.ts,
// crearCadenaCompleta.integration.test.ts, flujosMutacion.integration.test.ts):
// nunca va a coincidir con el nombre de una empresa real.
//
// Uso:
//   npm run limpiar:tenants-prueba          -- lista y borra
//   npm run limpiar:tenants-prueba -- --dry-run   -- solo lista, no borra
//
// Corre contra DATABASE_URL (el mismo rol chainpulse_app que usa la app en
// runtime y que ya usan las pruebas de integracion) -- el borrado pasa por
// RLS igual que cualquier operacion de la aplicacion, nunca necesita
// neondb_owner.
import { prisma } from "../src/infra/prisma/client";

const MARCA = "borrar si queda huerfana";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const huerfanas = await prisma.empresa.findMany({
    where: { nombre: { contains: MARCA } },
    select: { id: true, nombre: true },
  });

  if (huerfanas.length === 0) {
    console.log("Sin tenants de prueba huerfanos que limpiar.");
    return;
  }

  console.log(`Encontrados ${huerfanas.length} tenant(s) de prueba:`);
  for (const empresa of huerfanas) {
    console.log(`  - ${empresa.id}  ${empresa.nombre}`);
  }

  if (dryRun) {
    console.log("(--dry-run: no se borro nada)");
    return;
  }

  for (const empresa of huerfanas) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresa.id}, true)`;
      // Mismo orden seguro que borrarFixtureTenant() en
      // aislamientoMultitenant.integration.test.ts: conexiones_cadena ->
      // nodos es ON DELETE RESTRICT, se borra a mano antes de que el
      // cascade de "borrar Empresa" intente borrar nodos primero.
      await tx.respuestaCruda.deleteMany({});
      await tx.conexionCadena.deleteMany({});
      await tx.empresa.delete({ where: { id: empresa.id } });
    });
    console.log(`Borrado: ${empresa.id}  ${empresa.nombre}`);
  }

  console.log("Listo.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
