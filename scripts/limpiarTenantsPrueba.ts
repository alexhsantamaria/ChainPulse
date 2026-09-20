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
// Dos roles, a proposito, en dos pasos separados (primera version de este
// script no lo hacia asi y por eso no encontraba nada -- ver abajo):
//   1. BUSCAR con SEED_DATABASE_URL (neondb_owner, bypassea RLS): un
//      SELECT por nombre sin conocer el empresaId de antemano es
//      exactamente lo que RLS esta disenado para bloquear con el rol
//      normal de la app -- sin app.tenant_id fijado, "empresas" (like
//      cualquier tabla con RLS) no devuelve NINGUNA fila para
//      chainpulse_app, huerfana o no. Es solo lectura, sin riesgo.
//   2. BORRAR con el prisma normal (DATABASE_URL, chainpulse_app) + un
//      set_config('app.tenant_id', <ese id>, true) explicito, mismo
//      patron que borrarFixtureTenant() en
//      aislamientoMultitenant.integration.test.ts -- RLS scopea el
//      deleteMany({}) sin where a SOLO ese tenant. Nunca se usa
//      neondb_owner para borrar: un deleteMany({}) sin where bajo un rol
//      que bypassea RLS borraria esa tabla ENTERA, de todos los tenants.
//
// Uso:
//   npm run limpiar:tenants-prueba          -- lista y borra
//   npm run limpiar:tenants-prueba -- --dry-run   -- solo lista, no borra
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/infra/prisma/client";

const MARCA = "borrar si queda huerfana";

interface EmpresaHuerfana {
  id: string;
  nombre: string;
}

async function buscarHuerfanas(): Promise<EmpresaHuerfana[]> {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado (ver .env.example) -- hace falta el rol neondb_owner para buscar por nombre sin conocer el tenant de antemano (RLS bloquea cualquier SELECT sin app.tenant_id ya fijado).",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  const ownerPrisma = new PrismaClient({ adapter });
  try {
    return await ownerPrisma.empresa.findMany({
      where: { nombre: { contains: MARCA } },
      select: { id: true, nombre: true },
    });
  } finally {
    await ownerPrisma.$disconnect();
  }
}

async function borrarTenant(empresaId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    // Mismo orden seguro que borrarFixtureTenant(): conexiones_cadena ->
    // nodos es ON DELETE RESTRICT, se borra a mano antes de que el
    // cascade de "borrar Empresa" intente borrar nodos primero.
    await tx.respuestaCruda.deleteMany({});
    await tx.conexionCadena.deleteMany({});
    await tx.empresa.delete({ where: { id: empresaId } });
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const huerfanas = await buscarHuerfanas();

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
    await borrarTenant(empresa.id);
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
