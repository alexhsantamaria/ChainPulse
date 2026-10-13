// Script -- comprobacion INOCUA de que el lanzamiento de la CLI de
// Prisma (process.execPath + la entrada JS resuelta localmente)
// funciona en esta maquina, SEPARADA de cualquier migracion real
// (Alex, 2026-10-04, punto 3 de la tercera correccion). No requiere
// --schema, no requiere ENTORNO_PRUEBA_CONFIRMADO ni
// AUTORIZO_APLICAR_MIGRACION_PRUEBA, no toca ninguna base de datos --
// corre unicamente "<cli-resuelta> --version". Pensado para validar en
// Windows, antes de confiar en aplicarMigracionEntornoPrueba.ts, que el
// mecanismo de resolucion + lanzamiento en si funciona ahi.
//
// Toda la logica esta en src/infra/pruebaRevocacion/subproceso.ts
// (verificarLanzamientoPrisma + resolverEntradaCliPrisma). Este script
// es un envoltorio fino, igual que el resto de scripts/*.ts.
//
// Corre:
//   npx tsx scripts/verificarLanzamientoPrismaEntornoPrueba.ts
import { verificarLanzamientoPrisma } from "../src/infra/pruebaRevocacion/subproceso";

function main(): void {
  const salida = verificarLanzamientoPrisma("verificar-lanzamiento-prisma");
  console.log("Lanzamiento de la CLI de Prisma OK. Salida de --version:\n");
  console.log(salida);
}

try {
  main();
} catch {
  console.error(
    "VERIFICACION_DE_LANZAMIENTO_DE_PRISMA_ABORTADA -- ver el mensaje de error impreso arriba para el detalle.",
  );
  process.exitCode = 1;
}
