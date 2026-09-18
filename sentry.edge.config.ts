// Sentry — configuracion del runtime Edge. Necesario porque
// src/middleware.ts corre en Edge y, con el gate de rutas privadas, puede
// fallar de formas que hoy no se observan. Cargado manualmente desde
// src/instrumentation.ts (register(), rama NEXT_RUNTIME === "edge").
import * as Sentry from "@sentry/nextjs";
import { scrubEventoSentry } from "@/infra/sentryScrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
  sendDefaultPii: false,
  beforeSend: scrubEventoSentry,
  beforeSendTransaction: scrubEventoSentry,
});
