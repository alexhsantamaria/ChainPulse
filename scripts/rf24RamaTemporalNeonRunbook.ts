// Script -- runbook BLOQUEADO para validar RF24 (derechos/retiro) en
// una rama temporal de Neon (v5 Seccion 19 + autorizacion de PR-A,
// 2026-10-22: "crear el runbook bloqueado para futura validacion en
// una rama temporal Neon"). Envoltorio fino: toda la logica esta en
// src/infra/rf24/orquestarValidacionRamaTemporal.ts -- mismo patron que
// scripts/aplicarMigracionEntornoPrueba.ts.
//
// Dos autorizaciones DISTINTAS, ninguna sustituye a la otra:
//   ENTORNO_PRUEBA_CONFIRMADO="<destino exacto>"       -- "esta conexion
//                                                          es de prueba"
//                                                          (variable YA
//                                                          existente del
//                                                          proyecto, ver
//                                                          destinoPrueba.ts
//                                                          -- nunca una
//                                                          nueva para el
//                                                          mismo proposito)
//   AUTORIZO_VALIDAR_RF24_RAMA_TEMPORAL="si"           -- "autorizo
//                                                          aplicar las 3
//                                                          migraciones de
//                                                          RF24 Y correr
//                                                          las
//                                                          verificaciones
//                                                          de catalogo
//                                                          contra esa
//                                                          rama"
//
// Que valida, EXACTAMENTE (ver cabecera de orquestarValidacionRamaTemporal.ts
// para el detalle completo paso a paso): destino unico de DATABASE_URL/
// SEED_DATABASE_URL, rol efectivo de cada conexion, y el estado real de
// _prisma_migrations via decidirModoMigracionesRf24() -- flujo resumible
// con exactamente dos estados permitidos: "aplicar" (las 3 de RF24 son
// EXACTAMENTE las unicas pendientes, en orden -- entonces las aplica) o
// "continuar" (las 3 ya estan aplicadas o historicamente resueltas, cero
// pendientes en todo el repo -- entonces NUNCA vuelve a aplicar nada).
// Cualquier otro estado aborta. En AMBOS modos corre despues, contra
// catalogo REAL, las verificaciones que las Pruebas 3/4/5/6 de la entrega
// de PR-A dejaron "preparadas, no ejecutadas": privilegios de tabla de
// chainpulse_app (cero), EXECUTE de PUBLIC en las 12 funciones (cero),
// EXECUTE de chainpulse_app en las 11 publicas (presente), propietario de
// las 12 (neondb_owner), y ausencia de politica RLS en las 2 tablas
// nuevas.
//
// Antes de correr esto contra una rama real: usar
// scripts/verificarLanzamientoPrismaEntornoPrueba.ts (ya existente en
// este proyecto) para confirmar que el lanzamiento del subproceso de
// Prisma en si funciona en esa maquina, sin tocar ninguna base.
//
// PENDIENTE DE AUTORIZACION -- no se corrio todavia. Corre:
//   npx tsx scripts/rf24RamaTemporalNeonRunbook.ts
import { orquestarValidacionRamaTemporalRf24 } from "../src/infra/rf24/orquestarValidacionRamaTemporal";

async function main() {
  const resumen = await orquestarValidacionRamaTemporalRf24();
  console.log("\nRF24 -- validacion de rama temporal completada. Resumen:");
  console.log(JSON.stringify(resumen, null, 2));
  // Punto 4 (Alex, ronda 6): si hay EXECUTE inesperado a PUBLIC, las
  // firmas exactas se repiten aqui de forma explicita (no solo dentro del
  // JSON de arriba) -- nunca se corrige aqui ni se genera una migracion
  // nueva, solo se reporta.
  if (resumen.funcionesConExecuteInesperadoParaPublic.length > 0) {
    console.error(
      "\nATENCION -- GRANT EXECUTE a PUBLIC inesperado en: " +
        resumen.funcionesConExecuteInesperadoParaPublic.join(", "),
    );
  }
  const todoOk =
    resumen.tablasSinPrivilegiosDeChainpulseApp &&
    resumen.funcionesSinExecuteParaPublic &&
    resumen.funcionesPublicasConExecuteParaChainpulseApp &&
    resumen.funcionInternaSinGrant &&
    resumen.todasLasFuncionesSonDeNeondbOwner &&
    resumen.tablasSinPoliticaRls;
  if (!todoOk) {
    console.error("\nATENCION -- al menos una verificacion de catalogo NO cumplio lo esperado. Revisar el resumen de arriba antes de continuar con cualquier PR posterior.");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  // Correccion real (Alex, ejecucion en Windows): este catch descartaba el
  // objeto Error por completo (`catch (() => {...})` sin parametro), asi que
  // ningun detalle llegaba a la terminal mas alla de este mensaje generico --
  // ni siquiera cuando orquestarValidacionRamaTemporalRf24() SI construyo un
  // mensaje especifico. Ahora se imprime err.message: es SEGURO hacerlo
  // porque cada "throw" de ese modulo (y de subproceso.ts) construye su
  // PROPIO mensaje con texto fijo, nunca reenvia el error crudo del driver
  // ni ninguna URL de conexion (ver los comentarios "catch SIN binding" en
  // destinoPrueba.ts/subproceso.ts) -- por eso nunca se imprime err.stack
  // aqui, solo err.message, que ya esta garantizado seguro en origen.
  const mensaje = err instanceof Error ? err.message : String(err);
  console.error(`VALIDACION_DE_RAMA_TEMPORAL_ABORTADA -- ${mensaje}`);
  process.exitCode = 1;
});
