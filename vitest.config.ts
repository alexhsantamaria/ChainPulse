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
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Mismo alcance que "test": solo el codigo que corren los tests
      // unitarios (sin red). Los archivos de test/integration no cuentan
      // como "cobertura" de si mismos.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        "src/**/__tests__/**",
      ],
      // Informativo por ahora, sin umbral bloqueante (hallazgo H13,
      // PLAN-DE-TRABAJO.md Seccion 18.4.D). Cuando el equipo decida fijar
      // un piso, descomentar:
      // thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
