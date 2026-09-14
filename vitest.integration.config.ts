// Configuracion — Vitest para las pruebas de integracion (RNF1 y los
// flujos criticos de mutacion) que necesitan una conexion real a Neon
// (DATABASE_URL). Separada a proposito de vitest.config.ts: `npm run
// test` (el que corre en cada commit, en Mac, sin acceso de red ni .env
// -- ver ADR-0003) nunca debe intentar abrir una conexion real. Esta
// configuracion se corre a mano con `npm run test:integration`, en
// Windows, mismo criterio que `prisma generate`/`migrate`/`build`.
//
// fileParallelism: false -- hallazgo real al agregar el segundo archivo
// de integracion (flujosMutacion.integration.test.ts): Vitest corre los
// archivos de prueba en paralelo por defecto, asi que con dos archivos
// *.integration.test.ts cada uno abriendo sus propias conexiones/
// transacciones contra la misma base Neon al mismo tiempo, algunas
// transacciones tardaban mas que el timeout interactivo default de
// Prisma (5000ms) -- mismo tipo de problema que ya habia documentado
// RNF1 ("Neon duerme... no alcanzaba a despertarla con dos conexiones
// simultaneas"), ahora entre archivos en vez de entre conexiones sueltas
// dentro de un mismo archivo. Forzar los archivos a correr en serie evita
// la contencion sin tocar el codigo de produccion (que en uso normal,
// con una sola conexion a la vez, nunca mostro este problema -- ver
// validacion manual de RF5-RF9 en Windows en las secciones de arriba).
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
