// Pruebas — etiquetaSegura()/registrarFalloSeguro() (tercera ronda de
// revision, a pedido de Alex, 2026-10-04). Antes, un codigo de error NO
// reconocido se interpolaba igual en la etiqueta ("[<codigo-crudo>]
// error no clasificado"); estas pruebas confirman el arreglo: el codigo
// crudo solo se interpola cuando es EXACTAMENTE una de las claves fijas
// conocidas, nunca para cualquier otro valor (incluido uno que simule un
// secreto).
import { describe, expect, it, vi } from "vitest";
import { etiquetaSegura, registrarFalloSeguro } from "../etiquetaErrorSegura";

describe("etiquetaSegura", () => {
  it("codigo reconocido -- interpola el codigo (es una constante fija de este modulo, no un dato externo)", () => {
    const err = Object.assign(new Error("detalle interno irrelevante"), { code: "42501" });
    expect(etiquetaSegura(err)).toBe("[42501] permiso denegado");
  });

  it("sin codigo -- etiqueta generica fija, sin interpolar nada", () => {
    expect(etiquetaSegura(new Error("algo"))).toBe("[ERROR] error no clasificado");
  });

  it("codigo no reconocido -- etiqueta generica fija, el codigo NO se interpola", () => {
    const err = Object.assign(new Error("algo"), { code: "ALGO_NO_LISTADO" });
    expect(etiquetaSegura(err)).toBe("[ERROR] error no clasificado");
  });

  it("codigo no reconocido que simula un secreto -- el secreto nunca aparece en la etiqueta", () => {
    const secreto = "SECRETO_SIMULADO_EN_CODE_k3Qp9";
    const err = Object.assign(new Error("algo"), { code: secreto });
    const etiqueta = etiquetaSegura(err);
    expect(etiqueta).toBe("[ERROR] error no clasificado");
    expect(etiqueta).not.toContain(secreto);
  });

  it("codigo no es un string (p. ej. un objeto o numero) -- etiqueta generica, nunca se interpola tal cual", () => {
    const err = Object.assign(new Error("algo"), { code: { token: "SECRETO_OBJETO_zz1" } });
    const etiqueta = etiquetaSegura(err);
    expect(etiqueta).toBe("[ERROR] error no clasificado");
    expect(etiqueta).not.toContain("SECRETO_OBJETO_zz1");
  });

  it("err no es un objeto (string/undefined/null) -- etiqueta generica, nunca lanza", () => {
    expect(etiquetaSegura("texto plano")).toBe("[ERROR] error no clasificado");
    expect(etiquetaSegura(undefined)).toBe("[ERROR] error no clasificado");
    expect(etiquetaSegura(null)).toBe("[ERROR] error no clasificado");
  });

  it("codigo heredado de Object.prototype (p. ej. \"toString\" o \"constructor\") -- hasOwnProperty evita el falso match, etiqueta generica", () => {
    const err = Object.assign(new Error("algo"), { code: "constructor" });
    expect(etiquetaSegura(err)).toBe("[ERROR] error no clasificado");
  });

  it("codigo P2010 (Prisma, no SQLSTATE de Postgres -- agregado sexta ronda, caso real: tipo de columna no soportado por el driver) -- etiqueta fija reconocida", () => {
    const err = Object.assign(new Error("Failed to deserialize column of type 'name'"), { code: "P2010" });
    expect(etiquetaSegura(err)).toBe("[P2010] consulta cruda fallida (posible tipo de columna no soportado por el driver)");
  });

  it("codigo P2010 con un secreto simulado en el mensaje -- el secreto nunca aparece en la etiqueta", () => {
    const secreto = "SECRETO_SIMULADO_EN_P2010_j4Nw";
    const err = Object.assign(new Error(`detalle interno del driver -- ${secreto}`), { code: "P2010" });
    const etiqueta = etiquetaSegura(err);
    expect(etiqueta).toBe("[P2010] consulta cruda fallida (posible tipo de columna no soportado por el driver)");
    expect(etiqueta).not.toContain(secreto);
  });
});

describe("registrarFalloSeguro", () => {
  it("registra solo contexto + etiqueta segura, nunca el codigo crudo si no esta en la lista permitida", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secreto = "SECRETO_SIMULADO_EN_REGISTRO_q8Lm";
    const err = Object.assign(new Error(`mensaje con ${secreto} adentro`), { code: secreto });

    registrarFalloSeguro("contextoDePrueba", err);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const registrado = String(consoleErrorSpy.mock.calls[0]?.[0]);
    expect(registrado).toBe("[contextoDePrueba] [ERROR] error no clasificado");
    expect(registrado).not.toContain(secreto);
    consoleErrorSpy.mockRestore();
  });
});
