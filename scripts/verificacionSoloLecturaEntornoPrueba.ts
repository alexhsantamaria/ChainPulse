// Script de SOLO LECTURA -- diagnostico previo a validar la revocacion
// de sesiones contra un entorno de prueba identificado (Alex,
// 2026-10-04, corregido en tercera ronda). NO modifica ningun dato, NO
// aplica ninguna migracion. Envoltorio fino: toda la logica esta en
// src/infra/pruebaRevocacion/orquestarDiagnostico.ts (asi se puede
// probar con vitest, que no recorre "scripts/").
//
// Requiere, en el entorno de ESTA sesion de terminal (nunca en un
// archivo que termine commiteado):
//   ENTORNO_PRUEBA_CONFIRMADO  -- el destino EXACTO que confirmaste a
//                                 mano (host:puerto/base?schema=esquema,
//                                 ver destinoPrueba.ts), no un "si"
//                                 suelto. Corré este script sin
//                                 fijarla todavia, mira lo que imprime
//                                 resumenUrl() y RECIEN AHI fijala con
//                                 ese valor exacto.
//   DATABASE_URL       -- rol chainpulse_app, el mismo que usa la app.
//   SEED_DATABASE_URL  -- rol neondb_owner, solo para leer
//                         "_prisma_migrations" (sin GRANT a chainpulse_app).
//
// Corre: npx tsx scripts/verificacionSoloLecturaEntornoPrueba.ts
import { orquestarDiagnostico } from "../src/infra/pruebaRevocacion/orquestarDiagnostico";
import { destinoConfirmado, resumenUrl } from "../src/infra/pruebaRevocacion/destinoPrueba";

async function main() {
  // Si todavia no se fijo ENTORNO_PRUEBA_CONFIRMADO, igual mostramos el
  // destino resuelto (sin tocar nada) para que la persona sepa que
  // valor exacto confirmar -- exigirEntornoConfirmado() (dentro del
  // orquestador) aborta recien despues de esto.
  if (!process.env.ENTORNO_PRUEBA_CONFIRMADO && process.env.DATABASE_URL) {
    const destino = resumenUrl("DATABASE_URL", process.env.DATABASE_URL);
    console.log("Destino resuelto de DATABASE_URL:", JSON.stringify(destino));
    console.log('Si es tu entorno de prueba, fija ENTORNO_PRUEBA_CONFIRMADO="' + destinoConfirmado(destino) + '" y volve a correr.\n');
  }

  const resultado = await orquestarDiagnostico();
  console.log("DATABASE_URL      ->", JSON.stringify(resultado.destinoApp));
  console.log("SEED_DATABASE_URL ->", JSON.stringify(resultado.destinoAdmin));
  console.log(`\nAplicadas: ${resultado.estado.aplicadas.length}`);
  console.log(`Pendientes: ${resultado.estado.pendientes.length}`, resultado.estado.pendientes);
  console.log(
    `\nOK -- unica pendiente esperada. Siguiente paso: scripts/aplicarMigracionEntornoPrueba.ts (requiere su ` +
      "propia autorizacion, distinta de la de este script).",
  );
}

main().catch(() => {
  // Nunca se lee e.message/String(e) aca -- cada punto de aborto real
  // (ver orquestarDiagnostico.ts y destinoPrueba.ts) ya registro su
  // propio codigo fijo via logError() antes de lanzar, visible arriba
  // en esta misma salida.
  console.error("DIAGNOSTICO_ABORTADO -- ver el mensaje de error impreso arriba para el detalle.");
  process.exitCode = 1;
});
