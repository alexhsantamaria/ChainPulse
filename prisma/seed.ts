// Script — crea una empresa y un administrador de prueba con contraseña
// hasheada, para poder probar el login (ADR-0003) mientras no existe la
// UI de registro de RF1. Correr con DATABASE_URL = neondb_owner (bypasea
// RLS a proposito, igual que una migracion): npm run prisma:seed
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/infra/auth/password";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@chainpulse.test";
  const passwordPlano = process.env.SEED_ADMIN_PASSWORD ?? "CambiarEstaClave123!";

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
