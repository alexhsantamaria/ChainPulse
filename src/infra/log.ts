// Infraestructura — logging minimo y estructurado (Ronda 5 de revision,
// R5-22). No es un sistema de observabilidad completo (eso sigue siendo
// Sentry, ya evaluado en PLAN-DE-TRABAJO.md Seccion 18.1.B para las rutas
// nuevas del Incremento 2) -- esto reemplaza el `console.error(err)`
// suelto que estaba disperso en ~10 archivos, sin nivel ni contexto, por
// una sola linea JSON a stdout con un "contexto" (que ruta/funcion) y el
// mensaje del error, para que al menos se pueda grep/filtrar en los logs
// de Vercel por contexto sin tener que abrir cada stack trace.
export function logError(contexto: string, err: unknown): void {
  const mensaje = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(
    JSON.stringify({ nivel: "error", contexto, mensaje, stack, timestamp: new Date().toISOString() }),
  );
}
