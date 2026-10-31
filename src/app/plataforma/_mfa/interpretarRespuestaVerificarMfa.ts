// Logica pura (sin fetch, sin DOM) que CodigoMfaPlataformaForm.tsx usa
// para decidir que mostrar/adonde navegar segun la respuesta de POST
// /api/plataforma/mfa/verificar. Separada del componente por el mismo
// motivo que interpretarRespuestaLogin.ts (ver ese archivo): es la parte
// de la UI de MFA que se puede probar sin jsdom/Testing Library.
export const DESTINO_TRAS_MFA_PLATAFORMA = "/plataforma/rf20/cuestionarios";
export const DESTINO_PREAUTH_INVALIDO = "/plataforma/login";

export type ResultadoInterpretado =
  | { tipo: "ir"; destino: string }
  | { tipo: "error"; mensaje: string };

export function interpretarRespuestaVerificarMfa(
  status: number,
  resultado: { ok?: boolean; error?: string } | null,
  retryAfterHeader: string | null,
): ResultadoInterpretado {
  if (status === 429) {
    return {
      tipo: "error",
      mensaje: `Demasiados intentos. Esperá ${
        retryAfterHeader ? `${retryAfterHeader} segundos` : "unos segundos"
      } e intentá de nuevo.`,
    };
  }
  // El preauth vencio o nunca existio (cookie ausente/expirada) -- nunca
  // se queda mostrando el formulario, vuelve a pedir login.
  if (resultado?.error === "PREAUTH_INVALIDO") {
    return { tipo: "ir", destino: DESTINO_PREAUTH_INVALIDO };
  }
  if (status < 200 || status >= 300 || !resultado?.ok) {
    return { tipo: "error", mensaje: "Código incorrecto. Revisá la hora de tu teléfono e intentá de nuevo." };
  }
  return { tipo: "ir", destino: DESTINO_TRAS_MFA_PLATAFORMA };
}

/**
 * La API de enrolamiento solo devuelve la otpauthUrl completa, nunca el
 * secreto suelto -- este parseo de texto (no una operacion criptografica)
 * es lo unico que permite ofrecer el fallback "no puedo escanear".
 */
export function extraerSecretoDeOtpauthUrl(otpauthUrl: string): string | null {
  try {
    return new URL(otpauthUrl).searchParams.get("secret");
  } catch {
    return null;
  }
}

export type ResultadoEnrolarInterpretado =
  | { tipo: "otpauthUrl"; otpauthUrl: string }
  | { tipo: "irALogin" }
  | { tipo: "error"; mensaje: string };

/** Mismo proposito que interpretarRespuestaVerificarMfa(), para POST /api/plataforma/mfa/enrolar. */
export function interpretarRespuestaEnrolar(
  status: number,
  resultado: { ok?: boolean; otpauthUrl?: string; error?: string } | null,
): ResultadoEnrolarInterpretado {
  if (status === 401 || resultado?.error === "PREAUTH_INVALIDO") {
    return { tipo: "irALogin" };
  }
  if (status < 200 || status >= 300 || !resultado?.ok || typeof resultado.otpauthUrl !== "string") {
    return { tipo: "error", mensaje: "No se pudo generar el código de activación. Volvé a intentar." };
  }
  return { tipo: "otpauthUrl", otpauthUrl: resultado.otpauthUrl };
}
