// Sentry — configuracion del runtime del navegador. Convencion nueva de
// Next.js 15.3+/Sentry SDK 10 (reemplaza sentry.client.config.ts, que
// queda deprecado y no funciona con Turbopack): Next.js carga este
// archivo automaticamente por su nombre, igual que ya hace con
// src/middleware.ts -- sin registro manual en instrumentation.ts.
//
// DSN publico a proposito (NEXT_PUBLIC_*): termina en el bundle del
// navegador, un DSN de Sentry no es un secreto (solo permite enviar
// eventos, no leerlos) -- mismo criterio que NEXTAUTH_URL.
import * as Sentry from "@sentry/nextjs";
import { scrubEventoSentry } from "@/infra/sentryScrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
  sendDefaultPii: false,
  beforeSend: scrubEventoSentry,
  beforeSendTransaction: scrubEventoSentry,
});

// Requerido por el SDK para instrumentar navegaciones client-side
// (App Router) -- sin esto, Sentry avisa "ACTION REQUIRED" en cada build.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
