import { describe, expect, it } from "vitest";
import {
  compararPruebaSecretPreview,
  construirPruebaSecretPreview,
  entornoAutorizaDiagnosticoSecretPreview,
  esEntradaDiagnosticoSecretPreview,
} from "../diagnosticoSecretPreview";

const NONCE = Buffer.alloc(32, 7).toString("base64url");

describe("diagnosticoSecretPreview", () => {
  it("acepta una prueba construida con el mismo secreto exacto", () => {
    const prueba = construirPruebaSecretPreview("secreto exacto con espacios internos", NONCE);
    expect(compararPruebaSecretPreview("secreto exacto con espacios internos", { nonce: NONCE, prueba })).toBe(true);
  });

  it("rechaza otro secreto, incluso si solo cambia whitespace en los extremos", () => {
    const prueba = construirPruebaSecretPreview(" secreto ", NONCE);
    expect(compararPruebaSecretPreview("secreto", { nonce: NONCE, prueba })).toBe(false);
  });

  it("la prueba cambia con el nonce y no es un fingerprint estable", () => {
    const otroNonce = Buffer.alloc(32, 8).toString("base64url");
    expect(construirPruebaSecretPreview("secreto", NONCE)).not.toBe(
      construirPruebaSecretPreview("secreto", otroNonce),
    );
  });

  it.each([
    null,
    {},
    { nonce: "corto", prueba: "a".repeat(64) },
    { nonce: NONCE, prueba: "A".repeat(64) },
    { nonce: NONCE, prueba: "a".repeat(63) },
    { nonce: NONCE, prueba: "z".repeat(64) },
  ])("rechaza entradas malformadas: %j", (entrada) => {
    expect(esEntradaDiagnosticoSecretPreview(entrada)).toBe(false);
  });

  it("solo habilita el endpoint en Preview y en la rama diagnostica exacta", () => {
    expect(
      entornoAutorizaDiagnosticoSecretPreview({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "codex/diagnostico-secret-efectivo-preview",
      }),
    ).toBe(true);
    expect(
      entornoAutorizaDiagnosticoSecretPreview({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "codex/diagnostico-secret-efectivo-preview",
      }),
    ).toBe(false);
    expect(
      entornoAutorizaDiagnosticoSecretPreview({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "main",
      }),
    ).toBe(false);
  });
});
