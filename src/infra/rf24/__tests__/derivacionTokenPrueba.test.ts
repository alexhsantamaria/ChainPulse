// Prueba unitaria -- derivacion determinista de token RF24 (HMAC-SHA256
// versionado), fallo seguro de claves y comparacion en tiempo constante.
// Sin Prisma ni red: corre en `npm run test`. Prueba el helper EXCLUSIVO
// DE PRUEBA ./derivacionTokenPrueba (reubicado desde
// src/infra/rf24/tokenDerivacion.ts -- CORRECCION Alex 2026-10-22, punto
// 6 -- ver la cabecera de ese archivo para el porque).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  DOMINIO_DERIVACION,
  Rf24ClaveDerivacionError,
  compararHashesEnTiempoConstante,
  derivarToken,
  hashearToken,
  obtenerClaveDerivacion,
  validarClaveActivaAlArranque,
} from "./derivacionTokenPrueba";

const VARIABLE_CLAVE_V1 = "RF24_TOKEN_DERIVE_KEY_V1";
const VARIABLE_CLAVE_V2 = "RF24_TOKEN_DERIVE_KEY_V2";

function claveValidaBase64(): string {
  return randomBytes(32).toString("base64");
}

let respaldoV1: string | undefined;
let respaldoV2: string | undefined;

beforeEach(() => {
  respaldoV1 = process.env[VARIABLE_CLAVE_V1];
  respaldoV2 = process.env[VARIABLE_CLAVE_V2];
  delete process.env[VARIABLE_CLAVE_V1];
  delete process.env[VARIABLE_CLAVE_V2];
});

afterEach(() => {
  if (respaldoV1 === undefined) delete process.env[VARIABLE_CLAVE_V1];
  else process.env[VARIABLE_CLAVE_V1] = respaldoV1;
  if (respaldoV2 === undefined) delete process.env[VARIABLE_CLAVE_V2];
  else process.env[VARIABLE_CLAVE_V2] = respaldoV2;
});

describe("obtenerClaveDerivacion", () => {
  it("lee y decodifica una clave base64 valida de exactamente 32 bytes", () => {
    const claveBase64 = claveValidaBase64();
    process.env[VARIABLE_CLAVE_V1] = claveBase64;
    const clave = obtenerClaveDerivacion(1);
    expect(clave.length).toBe(32);
    expect(clave.toString("base64")).toBe(claveBase64);
  });

  it("falla de forma segura (Rf24ClaveDerivacionError) si la variable no existe", () => {
    expect(() => obtenerClaveDerivacion(1)).toThrow(Rf24ClaveDerivacionError);
    expect(() => obtenerClaveDerivacion(1)).toThrow(/RF24_TOKEN_DERIVE_KEY_V1/);
  });

  it("falla de forma segura si la clave decodifica a menos de 32 bytes", () => {
    process.env[VARIABLE_CLAVE_V1] = randomBytes(16).toString("base64");
    expect(() => obtenerClaveDerivacion(1)).toThrow(Rf24ClaveDerivacionError);
    expect(() => obtenerClaveDerivacion(1)).toThrow(/32/);
  });

  it("falla de forma segura si la clave decodifica a mas de 32 bytes", () => {
    process.env[VARIABLE_CLAVE_V1] = randomBytes(48).toString("base64");
    expect(() => obtenerClaveDerivacion(1)).toThrow(Rf24ClaveDerivacionError);
  });

  it("nunca incluye el valor de la clave en el mensaje de error", () => {
    const valorSecreto = "esto-no-es-base64-valido-y-no-debe-aparecer-en-el-error";
    process.env[VARIABLE_CLAVE_V1] = valorSecreto;
    try {
      obtenerClaveDerivacion(1);
      throw new Error("se esperaba que obtenerClaveDerivacion lanzara");
    } catch (error) {
      expect(error).toBeInstanceOf(Rf24ClaveDerivacionError);
      expect((error as Error).message).not.toContain(valorSecreto);
    }
  });
});

describe("validarClaveActivaAlArranque", () => {
  it("no lanza cuando la clave de la version activa es valida", () => {
    process.env[VARIABLE_CLAVE_V1] = claveValidaBase64();
    expect(() => validarClaveActivaAlArranque(1)).not.toThrow();
  });

  it("lanza (fallo seguro de arranque) cuando la clave activa falta", () => {
    expect(() => validarClaveActivaAlArranque(1)).toThrow(Rf24ClaveDerivacionError);
  });
});

describe("derivarToken", () => {
  it("es deterministico: la misma solicitudId y version producen siempre el mismo token", () => {
    process.env[VARIABLE_CLAVE_V1] = claveValidaBase64();
    const tokenUno = derivarToken("solicitud-abc-123", 1);
    const tokenDos = derivarToken("solicitud-abc-123", 1);
    expect(tokenUno).toBe(tokenDos);
  });

  it("resuelve el Bloqueador 1: un reintento con la misma version reconstruye el mismo token, nunca uno nuevo", () => {
    process.env[VARIABLE_CLAVE_V1] = claveValidaBase64();
    const primerIntento = derivarToken("solicitud-reintento-1", 1);
    const reintento = derivarToken("solicitud-reintento-1", 1);
    const hashPrimerIntento = hashearToken(primerIntento);
    const hashReintento = hashearToken(reintento);
    expect(compararHashesEnTiempoConstante(hashPrimerIntento, hashReintento)).toBe(true);
  });

  it("produce tokens distintos para solicitudId distintas (separacion de dominio por solicitud)", () => {
    process.env[VARIABLE_CLAVE_V1] = claveValidaBase64();
    const tokenA = derivarToken("solicitud-a", 1);
    const tokenB = derivarToken("solicitud-b", 1);
    expect(tokenA).not.toBe(tokenB);
  });

  it("produce tokens distintos para la misma solicitudId bajo versiones de clave distintas", () => {
    process.env[VARIABLE_CLAVE_V1] = claveValidaBase64();
    process.env[VARIABLE_CLAVE_V2] = claveValidaBase64();
    const tokenV1 = derivarToken("solicitud-misma-id", 1);
    const tokenV2 = derivarToken("solicitud-misma-id", 2);
    expect(tokenV1).not.toBe(tokenV2);
  });

  it("usa el mensaje con el prefijo de separacion de dominio documentado", () => {
    expect(DOMINIO_DERIVACION).toBe("chainpulse:rf24:token-derivacion:");
  });

  it("propaga el fallo seguro de obtenerClaveDerivacion cuando la version pedida no tiene clave", () => {
    expect(() => derivarToken("solicitud-sin-clave", 9)).toThrow(Rf24ClaveDerivacionError);
  });
});

describe("hashearToken", () => {
  it("produce un hash sha256 hexadecimal de 64 caracteres", () => {
    const hash = hashearToken("token-de-ejemplo");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("es deterministico para el mismo token", () => {
    expect(hashearToken("token-x")).toBe(hashearToken("token-x"));
  });

  it("produce hashes distintos para tokens distintos", () => {
    expect(hashearToken("token-x")).not.toBe(hashearToken("token-y"));
  });
});

describe("compararHashesEnTiempoConstante", () => {
  it("devuelve true para dos hashes identicos", () => {
    const hash = hashearToken("token-z");
    expect(compararHashesEnTiempoConstante(hash, hash)).toBe(true);
  });

  it("devuelve false para dos hashes de igual longitud pero distinto contenido", () => {
    const hashA = hashearToken("token-a");
    const hashB = hashearToken("token-b");
    expect(hashA.length).toBe(hashB.length);
    expect(compararHashesEnTiempoConstante(hashA, hashB)).toBe(false);
  });

  it("devuelve false sin lanzar cuando las longitudes difieren", () => {
    expect(() =>
      compararHashesEnTiempoConstante("abc", hashearToken("token-cualquiera")),
    ).not.toThrow();
    expect(compararHashesEnTiempoConstante("abc", hashearToken("token-cualquiera"))).toBe(
      false,
    );
  });
});
