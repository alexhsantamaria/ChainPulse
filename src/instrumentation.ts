// Next.js — hook de instrumentacion (Next 15, sin flag experimental).
// register() corre una vez al arrancar cada runtime; carga el config de
// Sentry que corresponda segun NEXT_RUNTIME (el server y el edge no
// pueden compartir un solo sentry.config.ts: APIs distintas del SDK).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Hook oficial de Next.js 15 para errores no capturados de route
// handlers/server components -- red de seguridad ademas de los
// Sentry.captureException(err) explicitos en cada catch de
// src/app/api/public/evaluations/** (Sentry ya aplica su propio
// scrubbing de request/headers antes de llegar a beforeSend).
export { captureRequestError as onRequestError } from "@sentry/nextjs";
