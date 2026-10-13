// Script de SOLO LECTURA -- verifica que la columna "sessionVersion"
// quedo creada correctamente despues de aplicar la migracion (Alex,
// 2026-10-04, corregido en tercera ronda: filtra por el esquema
// esperado y compara el default por igualdad exacta, no ".includes").
// Envoltorio fino: toda la logica esta en
// src/infra/pruebaRevocacion/orquestarVerificarColumna.ts.
//
// Corre: npx tsx scripts/verificarColumnaSessionVersionEntornoPrueba.ts
import { orquestarVerificarColumna } from "../src/infra/pruebaRevocacion/orquestarVerificarColumna";

async function main() {
  const fila = await orquestarVerificarColumna();
  console.log('=== Columna "sessionVersion" en "usuarios" (information_schema, solo lectura) ===');
  console.log(fila);
  console.log('\nOK -- "sessionVersion" existe como INTEGER NOT NULL DEFAULT 1, como espera el codigo.');
}

main().catch(() => {
  console.error("VERIFICACION_DE_COLUMNA_ABORTADA -- ver el mensaje de error impreso arriba para el detalle.");
  process.exitCode = 1;
});
