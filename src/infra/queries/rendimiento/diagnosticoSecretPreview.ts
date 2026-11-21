import { createHmac, timingSafeEqual } from "node:crypto";

const DOMINIO_HMAC = "chainpulse-preview-secret-diagnostic-v1\0";
const BYTES_NONCE = 32;
const PATRON_NONCE = /^[A-Za-z0-9_-]{43}$/;
const PATRON_PRUEBA = /^[a-f0-9]{64}$/;

export interface EntradaDiagnosticoSecretPreview {
  nonce: string;
  prueba: string;
}

interface EntornoDiagnosticoSecretPreview {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
}

export function esEntradaDiagnosticoSecretPreview(
  valor: unknown,
): valor is EntradaDiagnosticoSecretPreview {
  if (!valor || typeof valor !== "object") return false;
  const entrada = valor as Record<string, unknown>;
  if (typeof entrada.nonce !== "string" || typeof entrada.prueba !== "string") return false;
  if (!PATRON_NONCE.test(entrada.nonce) || !PATRON_PRUEBA.test(entrada.prueba)) return false;
  try {
    return Buffer.from(entrada.nonce, "base64url").byteLength === BYTES_NONCE;
  } catch {
    return false;
  }
}

/**
 * Prueba efimera y ligada a un nonce. Nunca es un hash reutilizable del
 * secreto: cada corrida usa un nonce aleatorio nuevo y separacion de dominio.
 */
export function construirPruebaSecretPreview(secret: string, nonce: string): string {
  if (!secret) throw new Error("SECRETO_DIAGNOSTICO_VACIO");
  if (!PATRON_NONCE.test(nonce) || Buffer.from(nonce, "base64url").byteLength !== BYTES_NONCE) {
    throw new Error("NONCE_DIAGNOSTICO_INVALIDO");
  }
  return createHmac("sha256", secret).update(`${DOMINIO_HMAC}${nonce}`, "utf8").digest("hex");
}

export function compararPruebaSecretPreview(
  secretEfectivo: string,
  entrada: EntradaDiagnosticoSecretPreview,
): boolean {
  if (!esEntradaDiagnosticoSecretPreview(entrada)) return false;
  const esperado = Buffer.from(construirPruebaSecretPreview(secretEfectivo, entrada.nonce), "hex");
  const recibido = Buffer.from(entrada.prueba, "hex");
  return esperado.byteLength === recibido.byteLength && timingSafeEqual(esperado, recibido);
}

export function entornoAutorizaDiagnosticoSecretPreview(
  env: EntornoDiagnosticoSecretPreview | NodeJS.ProcessEnv,
): boolean {
  return (
    env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === "codex/diagnostico-secret-efectivo-preview"
  );
}
