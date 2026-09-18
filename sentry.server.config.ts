// Sentry — configuracion del runtime Node.js (route handlers, server
// components, jobs). Cargado manualmente desde src/instrumentation.ts
// (register(), rama NEXT_RUNTIME === "nodejs") -- sin `npx @sentry/wizard`,
// ver PLAN-DE-TRABAJO.md Seccion 18.1.B para la justificacion.
import * as Sentry from "@sentry/nextjs";
import { scrubEventoSentry } from "@/infra/sentryScrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  // Apagado al inicio (PLAN-DE-TRABAJO.md): sin DSN o con trafico bajo,
  // no vale la pena el volumen de transacciones todavia.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
  // El SDK por defecto adjunta datos potencialmente sensibles (IP, cookies,
  // body del request) a cada evento -- explicitamente apagado. La segunda
  // capa (scrubEventoSentry) redacta ademas por nombre real de campo.
  sendDefaultPii: false,
  beforeSend: scrubEventoSentry,
  beforeSendTransaction: scrubEventoSentry,
});
