// Helper de pruebas (sin DB, sin jsdom) -- simula una zona horaria del
// host (via process.env.TZ) para una prueba, y la restaura a su valor
// EXACTO original al terminar, ausencia incluida.
//
// Correccion de ronda de revision (2026-11-16): las primeras versiones
// de estas pruebas hacian `process.env.TZ = tzOriginal` directamente en
// el finally/afterEach -- si TZ NO estaba definida antes (el caso real
// en este sandbox, confirmado: process.env.TZ es `undefined` por
// defecto), `tzOriginal` es `undefined`, y asignar `undefined` a una
// variable de entorno en Node la convierte en la CADENA literal
// `"undefined"` (toda variable de entorno es siempre un string) -- NO
// la deja ausente. Esto significa que, sin esta correccion, cada prueba
// que usara este patron dejaba `process.env.TZ` en `"undefined"` (un
// valor de zona horaria invalido) para cualquier prueba que corriera
// despues en el mismo proceso/worker de Vitest, en vez de restaurar la
// ausencia real.
//
// Se centraliza aqui (en vez de repetir el if/else en cada archivo) para
// que una sola prueba (entornoPruebaZonaHoraria.test.ts, en esta misma
// carpeta) cubra la logica de restauracion que usan TODAS las pruebas de
// date-only/timestamps en zona horaria negativa de src/app/dashboard/
// kpis/ -- en vez de que cada archivo reimplemente su propia copia sin
// prueba dedicada.
export function fijarZonaHorariaDePrueba(zona: string): () => void {
  const valorOriginal = process.env.TZ;
  process.env.TZ = zona;
  return () => restaurarZonaHoraria(valorOriginal);
}

export function restaurarZonaHoraria(valorOriginal: string | undefined): void {
  if (valorOriginal === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = valorOriginal;
  }
}
