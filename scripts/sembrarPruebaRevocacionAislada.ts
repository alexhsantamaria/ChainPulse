// Script de SIEMBRA -- crea, en UNA transaccion, una empresa y 4
// usuarios de prueba AISLADOS para validar la revocacion de sesiones
// (Alex, 2026-10-04, corregido en tercera ronda). Envoltorio fino: toda
// la logica esta en src/infra/pruebaRevocacion/orquestarSiembra.ts.
//
// Punto 2 (segunda correccion): "La siembra termina con main() sin
// manejador final: corregilo" -- la llamada a main() de mas abajo
// SIEMPRE lleva su .catch(), nunca "main();" suelto.
//
// PENDIENTE DE AUTORIZACION -- no se corrio todavia. Requiere que la
// migracion de sessionVersion ya este aplicada en este entorno. Corre:
//   npx tsx scripts/sembrarPruebaRevocacionAislada.ts
import { orquestarSiembra } from "../src/infra/pruebaRevocacion/orquestarSiembra";

async function main() {
  const resultado = await orquestarSiembra();

  if (resultado.ok) {
    console.log("Empresa y usuarios de prueba creados. Manifiesto escrito en:", resultado.rutaManifiesto);
    console.log(JSON.stringify(resultado.manifiesto, null, 2));
    return;
  }

  if (resultado.motivo === "ERROR_TRANSACCION_SIEMBRA") {
    console.error("SIEMBRA_ABORTADA: ERROR_TRANSACCION_SIEMBRA (no se creo ningun dato -- la transaccion es atomica)");
    process.exitCode = 1;
    return;
  }

  // ERROR_ESCRITURA_MANIFIESTO -- los datos SI se crearon (la
  // transaccion tuvo exito); se imprime el manifiesto completo (ids
  // reales incluidos, no son un secreto) para que se guarde a mano.
  console.error("SIEMBRA_PARCIAL: ERROR_ESCRITURA_MANIFIESTO -- los datos de prueba SI se crearon. Guardá esto a mano:");
  console.error(JSON.stringify(resultado.manifiestoParaRecuperar, null, 2));
  process.exitCode = 1;
}

main().catch(() => {
  console.error("SIEMBRA_ABORTADA -- ver el mensaje de error impreso arriba para el detalle.");
  process.exitCode = 1;
});
