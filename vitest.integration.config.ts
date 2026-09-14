// Configuracion — Vitest para las pruebas de integracion (RNF1) que
// necesitan una conexion real a Neon (DATABASE_URL). Separada a proposito
// de vitest.config.ts: `npm run test` (el que corre en cada commit, en
// Mac, sin acceso de red ni .env -- ver ADR-0003) nunca debe intentar
// abrir una conexion real. Esta configuracion se corre a mano con
// `npm run test:integration`, en Windows, mismo criterio que
// `prisma generate`/`migrate`/`build`.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
