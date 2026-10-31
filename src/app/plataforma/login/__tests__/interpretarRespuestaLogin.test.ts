import { describe, expect, it } from "vitest";
import { interpretarRespuestaLogin } from "../interpretarRespuestaLogin";

describe("interpretarRespuestaLogin", () => {
  it("200 ok con siguiente=activar-mfa -- navega ahi", () => {
    expect(interpretarRespuestaLogin(200, { ok: true, siguiente: "/plataforma/activar-mfa" }, null)).toEqual({
      tipo: "ir",
      destino: "/plataforma/activar-mfa",
    });
  });

  it("200 ok con siguiente=verificar-mfa -- navega ahi", () => {
    expect(interpretarRespuestaLogin(200, { ok: true, siguiente: "/plataforma/verificar-mfa" }, null)).toEqual({
      tipo: "ir",
      destino: "/plataforma/verificar-mfa",
    });
  });

  it("401 CREDENCIALES_INVALIDAS -- mensaje generico, nunca distingue el motivo", () => {
    const resultado = interpretarRespuestaLogin(401, { ok: false }, null);
    expect(resultado).toEqual({ tipo: "error", mensaje: "Email o contraseña incorrectos." });
  });

  it("429 con Retry-After -- mensaje incluye los segundos", () => {
    const resultado = interpretarRespuestaLogin(429, { ok: false }, "30");
    expect(resultado).toEqual({ tipo: "error", mensaje: "Demasiados intentos. Esperá 30 segundos e intentá de nuevo." });
  });

  it("429 sin Retry-After -- mensaje generico de espera", () => {
    const resultado = interpretarRespuestaLogin(429, null, null);
    expect(resultado.tipo).toBe("error");
    expect((resultado as { mensaje: string }).mensaje).toContain("unos segundos");
  });

  it("200 pero ok:true sin siguiente -- no confia en un payload incompleto", () => {
    expect(interpretarRespuestaLogin(200, { ok: true }, null).tipo).toBe("error");
  });

  it("500 -- error generico", () => {
    expect(interpretarRespuestaLogin(500, null, null).tipo).toBe("error");
  });
});
