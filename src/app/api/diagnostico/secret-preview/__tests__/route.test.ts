import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { construirPruebaSecretPreview } from "@/infra/queries/rendimiento/diagnosticoSecretPreview";

const NONCE = Buffer.alloc(32, 11).toString("base64url");

function request(body: unknown): Request {
  return new Request("https://preview.example/api/diagnostico/secret-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/diagnostico-secret-efectivo-preview");
  vi.stubEnv("NEXTAUTH_SECRET", "secreto-runtime-exacto");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/diagnostico/secret-preview", () => {
  it("devuelve coincide=true sin exponer secreto, prueba ni nonce", async () => {
    const prueba = construirPruebaSecretPreview("secreto-runtime-exacto", NONCE);
    const { POST } = await import("../route");
    const respuesta = await POST(request({ nonce: NONCE, prueba }));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, coincide: true });
    const serializado = JSON.stringify(await (await POST(request({ nonce: NONCE, prueba }))).json());
    expect(serializado).not.toContain("secreto-runtime-exacto");
    expect(serializado).not.toContain(prueba);
    expect(serializado).not.toContain(NONCE);
  });

  it("devuelve coincide=false para un secreto distinto", async () => {
    const prueba = construirPruebaSecretPreview("otro-secreto", NONCE);
    const { POST } = await import("../route");
    const respuesta = await POST(request({ nonce: NONCE, prueba }));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, coincide: false });
  });

  it("se oculta como 404 fuera de Preview o de la rama exacta", async () => {
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    const { POST } = await import("../route");
    const respuesta = await POST(request({ nonce: NONCE, prueba: "a".repeat(64) }));
    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ ok: false, error: "NO_ENCONTRADO" });
  });

  it("falla cerrado si el runtime no tiene NEXTAUTH_SECRET", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    const { POST } = await import("../route");
    const respuesta = await POST(request({ nonce: NONCE, prueba: "a".repeat(64) }));
    expect(respuesta.status).toBe(503);
  });

  it("rechaza cuerpo invalido o excesivo sin reflejarlo", async () => {
    const { POST } = await import("../route");
    const invalida = await POST(request({ nonce: "mal", prueba: "dato-sensible" }));
    expect(invalida.status).toBe(400);
    expect(JSON.stringify(await invalida.json())).not.toContain("dato-sensible");

    const excesiva = await POST(request({ relleno: "x".repeat(700) }));
    expect(excesiva.status).toBe(400);
  });
});
