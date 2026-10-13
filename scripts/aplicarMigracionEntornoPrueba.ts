// Script -- aplica "prisma migrate deploy" EXCLUSIVAMENTE contra el
// entorno de prueba identificado (Alex, 2026-10-04, corregido en
// tercera ronda). Envoltorio fino: toda la logica esta en
// src/infra/pruebaRevocacion/orquestarAplicarMigracion.ts.
//
// Dos autorizaciones DISTINTAS, ninguna sustituye a la otra:
//   ENTORNO_PRUEBA_CONFIRMADO="<destino exacto>"  -- "esta conexion es
//                                                     de prueba" (ver
//                                                     destinoPrueba.ts)
//   AUTORIZO_APLICAR_MIGRACION_PRUEBA="si"        -- "autorizo aplicar
//                                                     la migracion
//                                                     pendiente ahi"
//
// El subproceso de Prisma fija --schema (ruta absoluta de este repo) y
// cwd de forma explicita, y se lanza via process.execPath + la entrada
// JS de Prisma resuelta localmente (nunca execFileSync("npx"/"npx.cmd",
// ...), Alex, 2026-10-04, punto 3 de la tercera correccion) -- ver
// src/infra/pruebaRevocacion/subproceso.ts. Antes de correr esto en
// Windows, usa scripts/verificarLanzamientoPrismaEntornoPrueba.ts para
// confirmar que el lanzamiento en si funciona ahi (no toca ninguna
// base de datos).
//
// PENDIENTE DE AUTORIZACION -- no se corrio todavia. Corre:
//   npx tsx scripts/aplicarMigracionEntornoPrueba.ts
import { orquestarAplicarMigracion } from "../src/infra/pruebaRevocacion/orquestarAplicarMigracion";

async function main() {
  await orquestarAplicarMigracion();
  console.log("\nMigracion aplicada. Siguiente paso del plan: scripts/verificarColumnaSessionVersionEntornoPrueba.ts");
}

main().catch(() => {
  console.error("APLICACION_DE_MIGRACION_ABORTADA -- ver el mensaje de error impreso arriba para el detalle.");
  process.exitCode = 1;
});
