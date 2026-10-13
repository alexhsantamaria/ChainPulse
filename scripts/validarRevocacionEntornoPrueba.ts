// Script de VALIDACION -- ejecuta los escenarios pedidos por Alex
// (sesion vigente, sesion revocada, usuario eliminado, JWT viejo sin
// claim, aislamiento de otro usuario) contra los usuarios de prueba
// creados por sembrarPruebaRevocacionAislada.ts, llamando a las
// funciones REALES de src/infra/auth/sessionVerification.ts -- sin
// mocks (2026-10-04, corregido en tercera ronda). Envoltorio fino: toda
// la logica esta en src/infra/pruebaRevocacion/orquestarValidacion.ts.
//
// Alcance explicito: esto valida UNICAMENTE la capa de funciones contra
// Postgres (verificarSesionVigente()/leerSessionVersionParaLogin() con
// RLS real). NO ejercita el login HTTP/JWT -- esa validacion end-to-end
// queda pendiente, como un paso SEPARADO todavia no planeado.
//
// Punto 5 (segunda correccion): si falla una precondicion (el estado
// inicial de A1 o de A4 no es el esperado), el orquestador aborta ANTES
// de la mutacion correspondiente -- ver el comentario de cabecera de
// orquestarValidacion.ts. Al empezar se exige que los 4 usuarios del
// manifiesto existan todavia (distinto del criterio, mas tolerante, que
// usa la limpieza).
//
// Solo toca las filas listadas en el manifiesto de la siembra -- nunca
// la cuenta ni la empresa real de Alex.
//
// PENDIENTE DE AUTORIZACION -- no se corrio todavia. Requiere la ruta
// del manifiesto de la siembra como argumento. Corre:
//   npx tsx scripts/validarRevocacionEntornoPrueba.ts <ruta-del-manifiesto>
import { orquestarValidacion } from "../src/infra/pruebaRevocacion/orquestarValidacion";

async function main() {
  const rutaManifiestoArg = process.argv[2];
  if (!rutaManifiestoArg) {
    throw new Error("FALTA_ARGUMENTO_RUTA_MANIFIESTO -- uso: validarRevocacionEntornoPrueba.ts <ruta-del-manifiesto>");
  }

  const resultado = await orquestarValidacion(rutaManifiestoArg);

  let fallas = 0;
  for (const c of resultado.comprobaciones) {
    console.log(`${c.paso ? "PASS " : "FALLA"} -- ${c.nombre}`);
    if (!c.paso) fallas++;
  }

  const total = resultado.comprobaciones.length;
  console.log(`\n${fallas === 0 ? `TODO OK -- ${total} comprobaciones, 0 fallas` : `${fallas} de ${total} COMPROBACION(ES) FALLARON`}`);
  console.log(
    "\nRecordatorio de alcance: esto valido la capa de funciones contra Postgres, no el login HTTP/JWT " +
      "(queda pendiente, por separado). A1/A3/A4 de este manifiesto ya quedaron mutados/eliminados por esta " +
      "corrida -- la limpieza (scripts/limpiarPruebaRevocacionAislada.ts) sigue pudiendo correr igual, valida " +
      "contra el manifiesto, no contra el estado previo a esta corrida.",
  );
  process.exitCode = fallas === 0 ? 0 : 1;
}

main().catch(() => {
  // Nunca e.message/String(e) aca -- incluye el caso de una
  // PRECONDICION fallida (el orquestador ya abortó antes de la mutacion
  // correspondiente y ya registro su codigo fijo mas arriba).
  console.error("VALIDACION_ABORTADA -- ver el mensaje de error impreso arriba para el detalle.");
  process.exitCode = 1;
});
