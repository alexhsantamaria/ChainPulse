// Infraestructura de scripts -- carga ".env" explicitamente al arrancar
// cualquier script de un solo uso de esta carpeta.
//
// Hallazgo real (Alex, 2026-09-24, al correr `npm run r2:probar`): un
// script de `scripts/` que NO importa a `PrismaClient` (como
// `probarR2.ts`, que solo habla con R2/crypto) NO tiene ninguna variable
// de `.env` disponible en `process.env` con `npm run <script>` ni con
// `tsx scripts/x.ts` solos -- ninguno de los dos carga `.env` por su
// cuenta. Los scripts existentes (`bootstrapPgBoss.ts`,
// `limpiarTenantsPrueba.ts`, `limpiarCadenasDuplicadas.ts`) "funcionaban"
// sin este loader porque siempre se corrieron con las variables ya
// puestas en el entorno de alguna otra forma (ninguna de esas formas
// documentada en este repo) -- no porque tuvieran su propio mecanismo.
// Para no repetir el mismo susto con el proximo script nuevo, TODOS los
// scripts de esta carpeta que necesiten `.env` importan esto primero:
//
//   import "./_cargarEnv";
//
// `process.loadEnvFile()` es nativo de Node (>=20.6, estable en la v22
// que usa este proyecto) -- cero dependencias nuevas (no se agrega
// `dotenv`). Sin argumento, busca ".env" relativo al directorio desde el
// que se corre el proceso (la raiz del repo, si se corre con
// `npm run ...`/`tsx scripts/x.ts` desde ahi, que es el uso esperado).
//
// Si ".env" no existe (ej. en GitHub Actions, donde las variables ya
// vienen inyectadas como secrets del entorno, no desde un archivo) esto
// NO debe romper el script -- se ignora el error puntual de archivo
// faltante y se sigue: las variables que ya esten en `process.env` por
// otra via (CI, `--env-file` manual, etc.) se respetan igual.
try {
  process.loadEnvFile();
} catch (error) {
  const codigo = (error as { code?: string })?.code;
  if (codigo !== "ENOENT") {
    throw error;
  }
  // ".env" no existe en el directorio actual -- no es un error real aca,
  // ver el comentario de arriba.
}
