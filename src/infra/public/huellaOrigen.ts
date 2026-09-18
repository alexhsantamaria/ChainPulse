// Infraestructura publica — extrae la huella de origen cruda (IP) de un
// Request de Next.js, antes de hashearla (src/infra/rateLimit/huella.ts).
// Funcion pura sobre Headers, sin tocar Prisma ni el request completo, para
// poder probarla con `npm run test` sin depender del runtime de Next.
//
// Vercel agrega "x-forwarded-for" con la cadena de proxies (cliente real
// primero); no hay "x-real-ip" propio en ese runtime, pero se lee como
// respaldo por si el proyecto corre detras de otro proxy en el futuro.
// Sin ninguna de las dos cabeceras (dev local, o un proxy no reconocido),
// devuelve un valor fijo en vez de lanzar -- un rate limit que agrupe a
// todos los visitantes sin cabecera bajo el mismo balde es un compromiso
// aceptable frente a romper el flujo completo por falta de IP.
const HUELLA_ORIGEN_DESCONOCIDA = "origen-desconocido";

export function extraerHuellaOrigenCruda(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const primerIp = forwardedFor.split(",")[0]?.trim();
    if (primerIp) return primerIp;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return HUELLA_ORIGEN_DESCONOCIDA;
}
