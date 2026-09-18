// Configuracion — ajustes de Next.js para el proyecto.
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withSentryConfig(nextConfig, {
  // org/project/authToken quedan sin valor hasta que exista CI
  // (PLAN-DE-TRABAJO.md Seccion 18.1.B: SENTRY_AUTH_TOKEN se difiere).
  // Sin authToken el plugin no sube sourcemaps y no falla el build --
  // se activa solo con agregar las 3 variables, sin tocar este archivo.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: false,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
