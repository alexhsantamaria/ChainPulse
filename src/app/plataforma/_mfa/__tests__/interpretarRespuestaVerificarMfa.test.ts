import { describe, expect, it } from "vitest";
import {
  DESTINO_PREAUTH_INVALIDO,
  DESTINO_TRAS_MFA_PLATAFORMA,
  extraerSecretoDeOtpauthUrl,
  interpretarRespuestaEnrolar,
  interpretarRespuestaVerificarMfa,
} from "../interpretarRespuestaVerificarMfa";

describe("interpretarRespuestaVerificarMfa", () => {
  it("200 ok -- navega al modulo RF20", () => {
    expect(interpretarRespuestaVerificarMfa(200, { ok: true }, null)).toEqual({
      tipo: "ir",
      destino: DESTINO_TRAS_MFA_PLATAFORMA,
    });
  });

  it("401 CODIGO_INVALIDO -- mensaje de codigo incorrecto, se queda en la pagina", () => {
    const resultado = interpretarRespuestaVerificarMfa(401, { ok: false, error: "CODIGO_INVALIDO" }, null);
    expect(resultado).toEqual({
      tipo: "error",
      mensaje: "Código incorrecto. Revisá la hora de tu teléfono e intentá de nuevo.",
    });
  });

  it("401 PREAUTH_INVALIDO -- navega a login, no se queda mostrando el formulario", () => {
    expect(interpretarRespuestaVerificarMfa(401, { ok: false, error: "PREAUTH_INVALIDO" }, null)).toEqual({
      tipo: "ir",
      destino: DESTINO_PREAUTH_INVALIDO,
    });
  });

  it("429 -- mensaje con Retry-After", () => {
    expect(interpretarRespuestaVerificarMfa(429, { ok: false }, "15")).toEqual({
      tipo: "error",
      mensaje: "Demasiados intentos. Esperá 15 segundos e intentá de nuevo.",
    });
  });
});

describe("interpretarRespuestaEnrolar", () => {
  it("200 ok con otpauthUrl -- la devuelve para generar el QR", () => {
    const url = "otpauth://totp/x?secret=ABC123";
    expect(interpretarRespuestaEnrolar(200, { ok: true, otpauthUrl: url })).toEqual({
      tipo: "otpauthUrl",
      otpauthUrl: url,
    });
  });

  it("401 -- navega a login", () => {
    expect(interpretarRespuestaEnrolar(401, { ok: false, error: "PREAUTH_INVALIDO" })).toEqual({
      tipo: "irALogin",
    });
  });

  it("409 rechazo de enrolamiento -- mensaje de error, no navega", () => {
    const resultado = interpretarRespuestaEnrolar(409, { ok: false, error: "ENROLAMIENTO_INVALIDO" });
    expect(resultado.tipo).toBe("error");
  });

  it("200 pero sin otpauthUrl -- no confia en un payload incompleto", () => {
    expect(interpretarRespuestaEnrolar(200, { ok: true }).tipo).toBe("error");
  });
});

describe("extraerSecretoDeOtpauthUrl", () => {
  it("extrae el parametro secret de una otpauthUrl valida", () => {
    expect(extraerSecretoDeOtpauthUrl("otpauth://totp/plataforma:u1?secret=ABCDEF&issuer=chainpulse")).toBe(
      "ABCDEF",
    );
  });

  it("URL invalida -- null, nunca lanza", () => {
    expect(extraerSecretoDeOtpauthUrl("no-es-una-url")).toBeNull();
  });

  it("sin parametro secret -- null", () => {
    expect(extraerSecretoDeOtpauthUrl("otpauth://totp/plataforma:u1?issuer=chainpulse")).toBeNull();
  });
});
