import { describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import {
  PERIOD_MFA_PLATAFORMA_SEGUNDOS,
  activarMfaPlataforma,
  consumirContadorTotpPlataforma,
  enrolarMfaPlataforma,
  leerMfaPlataforma,
  verificarYCalcularContador,
} from "../mfaPlataforma";

// Los wrappers reciben un cliente inyectado en estas pruebas. El mock evita
// construir el PrismaClient global: las unitarias nunca necesitan .env ni red.
vi.mock("../../prisma/client", () => ({ prisma: { $queryRaw: vi.fn() } }));

describe("MFA de plataforma", () => {
  it("calcula el contador absoluto con el mismo timestamp usado por OTPAuth", () => {
    const secreto = OTPAuth.Secret.fromBase32("JBSWY3DPEHPK3PXP");
    const timestamp = 1_800_000_000_000;
    const totp = new OTPAuth.TOTP({
      issuer: "ChainPulse",
      algorithm: "SHA1",
      digits: 6,
      period: PERIOD_MFA_PLATAFORMA_SEGUNDOS,
      secret: secreto,
    });
    const codigo = totp.generate({ timestamp });

    expect(verificarYCalcularContador(secreto.base32, codigo, timestamp)).toEqual({
      valido: true,
      contadorAceptado: Math.floor(timestamp / 1000 / PERIOD_MFA_PLATAFORMA_SEGUNDOS),
    });
  });

  it("incluye el delta aceptado en el contador absoluto", () => {
    const secreto = OTPAuth.Secret.fromBase32("JBSWY3DPEHPK3PXP");
    const timestamp = 1_800_000_000_000;
    const periodoAnterior = timestamp - PERIOD_MFA_PLATAFORMA_SEGUNDOS * 1000;
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: secreto });
    const codigoAnterior = totp.generate({ timestamp: periodoAnterior });

    expect(verificarYCalcularContador(secreto.base32, codigoAnterior, timestamp)).toEqual({
      valido: true,
      contadorAceptado: Math.floor(periodoAnterior / 1000 / PERIOD_MFA_PLATAFORMA_SEGUNDOS),
    });
  });

  it("wrappers reflejan exactamente la primera fila devuelta por Postgres", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ mfaSecret: "ABC", mfaHabilitado: false }])
      .mockResolvedValueOnce([{ ok: true, motivo: "PENDIENTE_EXISTENTE", secretoEfectivo: "ABC" }])
      .mockResolvedValueOnce([{ activado: true }])
      .mockResolvedValueOnce([{ consumido: false }]);
    const cliente = { $queryRaw: queryRaw } as never;

    expect(await leerMfaPlataforma("u1", cliente)).toEqual({ mfaSecret: "ABC", mfaHabilitado: false });
    expect(await enrolarMfaPlataforma("u1", "DEF", cliente)).toEqual({
      ok: true,
      motivo: "PENDIENTE_EXISTENTE",
      secretoEfectivo: "ABC",
    });
    expect(await activarMfaPlataforma("u1", 10, cliente)).toBe(true);
    expect(await consumirContadorTotpPlataforma("u1", 10, cliente)).toBe(false);
  });
});
