// Configuracion — ajustes de Vitest para correr las pruebas del motor
// (unitarias, sin red). Las pruebas de integracion de RNF1
// (*.integration.test.ts) quedan afuera a proposito -- ver
// vitest.integration.config.ts, que necesita DATABASE_URL real.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // PR 8 correccion (ronda 2): agregado SOLO para que las pruebas de
  // src/app/plataforma/login/__tests__/page.test.ts (y cualquier otra
  // que ejecute una Server Component .tsx sin renderizarla a DOM) no
  // revienten con "React is not defined" -- tsconfig.json usa
  // jsx:"preserve" (Next.js hace su propia transformacion vía SWC), asi
  // que esbuild (el transformador de Vitest para .tsx, sin relacion con
  // el build real de Next) caia a su default classico
  // (React.createElement sin React en scope). "automatic" es el mismo
  // runtime de JSX que React 19/Next ya usan en produccion -- esto NO
  // cambia nada del build de Next (esta config es exclusiva de
  // Vitest), no agrega ninguna dependencia nueva, y no habilita
  // renderizado a DOM (eso seguiria necesitando jsdom/happy-dom +
  // Testing Library, no agregados aqui -- ver informe de entrega).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    // "scripts/**/*.test.ts" agregado en PR 8 (ronda 3, Alex): primera
    // prueba de un script de scripts/ en este repo
    // (restablecer-mfa-plataforma-mantenimiento.test.ts) -- sin esto,
    // Vitest nunca la recolectaba (exit code 1, "No test files found").
    // "src/**/*.test.tsx" agregado en Incremento 5 PR1 (ronda 2, Alex,
    // 2026-11-18): primera prueba de RENDER real de un componente
    // cliente en este repo (ConsultasPanel.test.tsx, con
    // @testing-library/react + jsdom) -- sin este patron, Vitest nunca
    // recolecta un archivo ".test.tsx" (el resto de la suite sigue
    // siendo ".test.ts"). Es el UNICO cambio de alcance global que pidio
    // esa correccion -- el entorno jsdom en si se activa por archivo con
    // el pragma "// @vitest-environment jsdom", no aca.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "scripts/**/*.integration.test.ts"],
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
