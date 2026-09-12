// Script — crea una empresa y un administrador de prueba con contraseña
// hasheada, para poder probar el login (ADR-0003) mientras no existe la
// UI de registro de RF1. Corre siempre contra SEED_DATABASE_URL (rol
// neondb_owner) y NUNCA contra DATABASE_URL (rol chainpulse_app, RNF1):
// este script crea una empresa desde cero, y las politicas RLS de
// "empresas" (prisma/rls.sql) rechazan ese INSERT si no hay ya un
// tenant activo en la sesion — exactamente el mismo caso de una
// migracion. Definir SEED_DATABASE_URL en .env (ver .env.example) antes
// de correr: npm run prisma:seed
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/infra/auth/password";

const seedDatabaseUrl = process.env.SEED_DATABASE_URL;
if (!seedDatabaseUrl) {
  throw new Error(
    "Falta SEED_DATABASE_URL en .env — este script necesita el rol " +
      "neondb_owner (bypasea RLS a proposito, igual que una migracion), " +
      "no el rol chainpulse_app de DATABASE_URL. Ver .env.example.",
  );
}

// ADR-0003 (adenda ARM64): mismo motivo que src/infra/prisma/client.ts —
// sin adapter, este script tambien intenta cargar el motor nativo que no
// existe para Windows ARM64.
const adapter = new PrismaPg({ connectionString: seedDatabaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  // "||" (no "??"): SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD pueden estar
  // definidas pero vacias en .env.example (""), y en ese caso tambien
  // deben caer al valor por defecto, no quedar en cadena vacia.
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@chainpulse.test";
  const passwordPlano = process.env.SEED_ADMIN_PASSWORD?.trim() || "CambiarEstaClave123!";

  const empresa = await prisma.empresa.upsert({
    where: { id: "empresa-piloto-1" },
    update: {},
    create: { id: "empresa-piloto-1", nombre: "Empresa Piloto 1" },
  });

  const passwordHash = await hashPassword(passwordPlano);

  await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: {
      empresaId: empresa.id,
      email,
      nombre: "Administrador de prueba",
      rol: "ADMINISTRADOR",
      passwordHash,
    },
  });

  console.log(`Usuario de prueba listo: ${email} / ${passwordPlano}`);
  console.log("Cambia esta contraseña o borra este usuario antes de cargar datos reales.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
