// Configuracion — ajustes de Vitest para correr las pruebas del motor
// (unitarias, sin red). Las pruebas de integracion de RNF1
// (*.integration.test.ts) quedan afuera a proposito -- ver
// vitest.integration.config.ts, que necesita DATABASE_URL real.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
