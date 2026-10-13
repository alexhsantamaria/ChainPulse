// Script de LIMPIEZA -- borra EXACTAMENTE las filas listadas en el
// manifiesto de sembrarPruebaRevocacionAislada.ts, nunca ninguna otra
// fila (Alex, 2026-10-04, corregido en tercera ronda). Envoltorio fino:
// toda la logica esta en
// src/infra/pruebaRevocacion/orquestarLimpieza.ts.
//
// Punto 1 (segunda correccion): la correspondencia del manifiesto y el
// chequeo de relaciones CASCADE/SET NULL corren DENTRO de la misma
// transaccion que borra -- proteccion frente a cambios concurrentes.
// La empresa se borra EXPLICITAMENTE, nunca por cascada: primero se
// borran, por id exacto, los usuarios del manifiesto; se verifica,
// dentro de la misma transaccion, que no quede ninguno; solo entonces
// se borra la empresa. Si algo falla, nada se borro (atomica) y el
// manifiesto se conserva para reintentar.
//
// PENDIENTE DE AUTORIZACION -- no se corrio todavia. Requiere la ruta
// del manifiesto de la siembra como argumento. Corre:
//   npx tsx scripts/limpiarPruebaRevocacionAislada.ts <ruta-del-manifiesto>
import { orquestarLimpieza } from "../src/infra/pruebaRevocacion/orquestarLimpieza";

async function main() {
  const rutaManifiestoArg = process.argv[2];
  if (!rutaManifiestoArg) {
    throw new Error("FALTA_ARGUMENTO_RUTA_MANIFIESTO -- uso: limpiarPruebaRevocacionAislada.ts <ruta-del-manifiesto>");
  }

  const resultado = await orquestarLimpieza(rutaManifiestoArg);

  if (!resultado.ok) {
    console.error("LIMPIEZA_ABORTADA: ERROR_TRANSACCION_LIMPIEZA (no se borro nada -- la transaccion es atomica; el manifiesto se conserva)");
    process.exitCode = 1;
    return;
  }

  console.log(`Eliminados: ${resultado.cantidadBorrada} usuario(s) de prueba + 1 empresa de prueba.`);
  if (resultado.manifiestoBorrado) {
    console.log("Manifiesto borrado:", resultado.rutaManifiesto);
  } else {
    console.error(
      "La limpieza de la base SI tuvo exito, pero no se pudo borrar el archivo del manifiesto -- " +
        "borralo a mano:",
      resultado.rutaManifiesto,
    );
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("LIMPIEZA_ABORTADA -- ver el mensaje de error impreso arriba para el detalle.");
  process.exitCode = 1;
});
