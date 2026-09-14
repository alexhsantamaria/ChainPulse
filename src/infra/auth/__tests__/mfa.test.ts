// Prueba unitaria — propiedades criptográficas del TOTP (MFA, ADR-0003).
// Sin Prisma ni red: corre en `npm run test` (Mac), a diferencia de la
// activación de MFA en sí (que sí necesita persistir mfaHabilitado en la
// base) — esa parte queda cubierta por
// src/infra/__tests__/flujosMutacion.integration.test.ts.
import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { construirOtpauthUrl, generarSecretoMfa, verificarCodigoMfa } from "../mfa";

function generarCodigoValido(secretoBase32: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "ChainPulse",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretoBase32),
  });
  return totp.generate();
}

describe("generarSecretoMfa", () => {
  it("genera un secreto base32 y una URL otpauth:// para el email dado", () => {
    const { secretoBase32, otpauthUrl } = generarSecretoMfa("admin@chainpulse.test");
    expect(secretoBase32).toBeTruthy();
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(otpauthUrl).toContain(encodeURIComponent("admin@chainpulse.test"));
  });

  it("genera un secreto distinto en cada llamada", () => {
    const a = generarSecretoMfa("admin@chainpulse.test");
    const b = generarSecretoMfa("admin@chainpulse.test");
    expect(a.secretoBase32).not.toBe(b.secretoBase32);
  });
});

describe("construirOtpauthUrl", () => {
  it("reconstruye la misma URL a partir de un secreto ya existente, sin regenerarlo", () => {
    const { secretoBase32, otpauthUrl } = generarSecretoMfa("admin@chainpulse.test");
    const reconstruida = construirOtpauthUrl("admin@chainpulse.test", secretoBase32);
    // El orden de los parametros de query puede variar entre llamadas de
    // OTPAuth -- se compara por el secreto embebido, no por igualdad
    // textual exacta de la URL completa.
    expect(reconstruida).toContain(`secret=${secretoBase32}`);
    expect(otpauthUrl).toContain(`secret=${secretoBase32}`);
  });
});

describe("verificarCodigoMfa", () => {
  it("acepta un código válido generado con el mismo secreto", () => {
    const { secretoBase32 } = generarSecretoMfa("admin@chainpulse.test");
    const codigo = generarCodigoValido(secretoBase32);
    expect(verificarCodigoMfa(secretoBase32, codigo)).toBe(true);
  });

  it("rechaza un código que no corresponde al secreto", () => {
    const { secretoBase32 } = generarSecretoMfa("admin@chainpulse.test");
    const otro = generarSecretoMfa("otro@chainpulse.test");
    const codigoDeOtroSecreto = generarCodigoValido(otro.secretoBase32);
    // Colisión estadísticamente despreciable (1 en 1.000.000), pero por
    // las dudas se reintenta con un código fijo claramente inválido si
    // por azar coincidiera.
    const codigo = codigoDeOtroSecreto === generarCodigoValido(secretoBase32) ? "000000" : codigoDeOtroSecreto;
    expect(verificarCodigoMfa(secretoBase32, codigo)).toBe(false);
  });

  it("rechaza un código vacío", () => {
    const { secretoBase32 } = generarSecretoMfa("admin@chainpulse.test");
    expect(verificarCodigoMfa(secretoBase32, "")).toBe(false);
  });

  it("rechaza un código con el formato correcto pero desfasado varias ventanas de tiempo", () => {
    const { secretoBase32 } = generarSecretoMfa("admin@chainpulse.test");
    const totp = new OTPAuth.TOTP({
      issuer: "ChainPulse",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretoBase32),
    });
    // verificarCodigoMfa tolera window: 1 (+-30s) -- 10 minutos antes cae
    // muy afuera de esa tolerancia.
    const codigoViejo = totp.generate({ timestamp: Date.now() - 10 * 60 * 1000 });
    expect(verificarCodigoMfa(secretoBase32, codigoViejo)).toBe(false);
  });
});
