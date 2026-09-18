// Infraestructura — scrubbing explicito de PII para eventos de Sentry
// (PLAN-DE-TRABAJO.md Seccion 18.1.B, Incremento 2: observabilidad
// minima antes de exponer /api/public/evaluations/* a trafico anonimo).
//
// Deliberadamente NO se depende solo del scrubbing generico por nombre de
// campo que trae Sentry (server_name/data scrubbing por defecto) --
// `sendDefaultPii: false` (en cada sentry.*.config.ts) ya evita que el
// SDK adjunte automaticamente cosas como el body crudo del request o la
// IP; esta funcion es la segunda capa, explicita: recorre el evento
// completo (extra, contexts, user, request.data/headers/cookies,
// breadcrumbs) y redacta por el nombre REAL de cada campo sensible del
// dominio, sin importar en que parte del evento haya terminado.
//
// Campos redactados: los mismos que EvaluacionExpres/EvaluacionExpresV2 y
// EvaluacionExpresConexion ya marcan como sensibles en prisma/schema.prisma
// (correo, telefono, nombreCompleto, empresaNombre, huellaOrigen,
// huellaOrigenHash, descripcionLibre) mas "email", para cuando exista
// UsuarioPlataforma.email (RF19).
const CAMPOS_SENSIBLES = new Set([
  "correo",
  "email",
  "telefono",
  "nombreCompleto",
  "empresaNombre",
  "huellaOrigen",
  "huellaOrigenHash",
  "descripcionLibre",
]);

const VALOR_REDACTADO = "[redactado]";

function redactarProfundo<T>(valor: T): T {
  if (valor === null || typeof valor !== "object") return valor;

  if (Array.isArray(valor)) {
    return valor.map((elemento) => redactarProfundo(elemento)) as unknown as T;
  }

  const resultado: Record<string, unknown> = {};
  for (const [clave, valorDelCampo] of Object.entries(valor as Record<string, unknown>)) {
    resultado[clave] = CAMPOS_SENSIBLES.has(clave) ? VALOR_REDACTADO : redactarProfundo(valorDelCampo);
  }
  return resultado as T;
}

/**
 * Usada como `beforeSend`/`beforeSendTransaction` en los 3 sentry.*.config.
 * Nunca lanza ni devuelve null -- un evento que no se puede recorrer (caso
 * limite improbable) se envia tal cual antes que perder la observabilidad
 * por un bug en el scrubbing mismo.
 */
export function scrubEventoSentry<T extends object>(event: T): T {
  try {
    return redactarProfundo(event as unknown as Record<string, unknown>) as unknown as T;
  } catch {
    return event;
  }
}
