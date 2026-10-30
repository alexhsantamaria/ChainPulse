// MFA obligatorio de UsuarioPlataforma. El contador entregado a Postgres
// es el contador TOTP absoluto, nunca el delta relativo devuelto por
// OTPAuth.validate().
import type { PrismaClient } from "@prisma/client";
import * as OTPAuth from "otpauth";
import { prisma } from "../prisma/client";

const ISSUER = "ChainPulse";
const DIGITS = 6;
export const PERIOD_MFA_PLATAFORMA_SEGUNDOS = 30;
type ClienteSql = Pick<PrismaClient, "$queryRaw">;

export function generarSecretoMfaPlataforma(email: string): {
  secretoBase32: string;
  otpauthUrl: string;
} {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_MFA_PLATAFORMA_SEGUNDOS,
    secret: new OTPAuth.Secret({ size: 20 }),
  });
  return { secretoBase32: totp.secret.base32, otpauthUrl: totp.toString() };
}

export function construirOtpauthUrlMfaPlataforma(
  etiqueta: string,
  secretoBase32: string,
): string {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: etiqueta,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_MFA_PLATAFORMA_SEGUNDOS,
    secret: OTPAuth.Secret.fromBase32(secretoBase32),
  }).toString();
}

export interface EstadoMfaPlataforma {
  mfaSecret: string | null;
  mfaHabilitado: boolean;
}

export async function leerMfaPlataforma(
  usuarioId: string,
  cliente: ClienteSql = prisma,
): Promise<EstadoMfaPlataforma | null> {
  const filas = await cliente.$queryRaw<EstadoMfaPlataforma[]>`
    SELECT * FROM public.leer_mfa_plataforma(${usuarioId})
  `;
  return filas[0] ?? null;
}

export function verificarYCalcularContador(
  secretoBase32: string,
  codigo: string,
  timestamp: number = Date.now(),
): { valido: boolean; contadorAceptado: number | null } {
  if (!codigo) return { valido: false, contadorAceptado: null };
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_MFA_PLATAFORMA_SEGUNDOS,
    secret: OTPAuth.Secret.fromBase32(secretoBase32),
  });
  const delta = totp.validate({ token: codigo, timestamp, window: 1 });
  if (delta === null) return { valido: false, contadorAceptado: null };
  const contadorAceptado =
    Math.floor(timestamp / 1000 / PERIOD_MFA_PLATAFORMA_SEGUNDOS) + delta;
  return { valido: true, contadorAceptado };
}

export interface ResultadoEnrolamientoMfaPlataforma {
  ok: boolean;
  motivo: "USUARIO_INEXISTENTE" | "MFA_YA_ACTIVO" | "PENDIENTE_EXISTENTE" | "NUEVO_SECRETO_REGISTRADO";
  secretoEfectivo: string | null;
}

export async function enrolarMfaPlataforma(
  usuarioId: string,
  secretoCandidato: string,
  cliente: ClienteSql = prisma,
): Promise<ResultadoEnrolamientoMfaPlataforma | null> {
  const filas = await cliente.$queryRaw<ResultadoEnrolamientoMfaPlataforma[]>`
    SELECT * FROM public.enrolar_mfa_plataforma(${usuarioId}, ${secretoCandidato})
  `;
  return filas[0] ?? null;
}

export async function activarMfaPlataforma(
  usuarioId: string,
  contador: number,
  cliente: ClienteSql = prisma,
): Promise<boolean> {
  const filas = await cliente.$queryRaw<{ activado: boolean }[]>`
    SELECT * FROM public.activar_mfa_plataforma(${usuarioId}, ${contador})
  `;
  return filas[0]?.activado === true;
}

export async function consumirContadorTotpPlataforma(
  usuarioId: string,
  contador: number,
  cliente: ClienteSql = prisma,
): Promise<boolean> {
  const filas = await cliente.$queryRaw<{ consumido: boolean }[]>`
    SELECT * FROM public.consumir_contador_totp_plataforma(${usuarioId}, ${contador})
  `;
  return filas[0]?.consumido === true;
}
