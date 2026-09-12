// Infraestructura — TOTP (MFA) obligatorio para ADMINISTRADOR (ADR-0003).
import * as OTPAuth from "otpauth";

const ISSUER = "ChainPulse";
const DIGITS = 6;
const PERIOD = 30;

export function generarSecretoMfa(email: string): { secretoBase32: string; otpauthUrl: string } {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: new OTPAuth.Secret({ size: 20 }),
  });
  return {
    secretoBase32: totp.secret.base32,
    otpauthUrl: totp.toString(),
  };
}

// Reconstruye la URL otpauth:// a partir de un secreto ya guardado (p.ej.
// en /activar-mfa, donde el secreto se genero antes, en el registro — RF1
// — y no debe regenerarse: cambiaria el secreto que ya se guardo en BD).
export function construirOtpauthUrl(email: string, secretoBase32: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretoBase32),
  });
  return totp.toString();
}

// window: 1 tolera +-30s de desfasaje de reloj entre servidor y app authenticator.
export function verificarCodigoMfa(secretoBase32: string, codigo: string): boolean {
  if (!codigo) return false;
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretoBase32),
  });
  return totp.validate({ token: codigo, window: 1 }) !== null;
}
