import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolverBypassDiagnostico, verificarSecretPreview } from "../verificarSecretPreview";

const BASE = "https://preview-seguro-ejemplo.vercel.app";
const BYPASS = "b".repeat(32);

beforeEach(() => {
  vi.stubEnv("CARGA_CONSULTAS_HOST_CONFIRMADO", "preview-seguro-ejemplo.vercel.app");
  vi.stubEnv("AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL", "si");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verificarSecretPreview", () => {
  it.each([undefined, "", "x".repeat(31), "x".repeat(33), `${"x".repeat(31)} `, `${"x".repeat(30)}\t`])(
    "rechaza bypass invalido sin reflejarlo: %j",
    (valor) => {
      expect(() => resolverBypassDiagnostico(valor)).toThrow("BYPASS_DIAGNOSTICO_INVALIDO");
    },
  );

  it("envia solo nonce/prueba y bypass por header; devuelve el booleano saneado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, coincide: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const resultado = await verificarSecretPreview(fetchMock, {
      CARGA_CONSULTAS_BASE_URL: BASE,
      CARGA_CONSULTAS_NEXTAUTH_SECRET: "secreto-candidato",
      CARGA_CONSULTAS_VERCEL_BYPASS: BYPASS,
    });
    expect(resultado).toBe(true);
    const [url, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/diagnostico/secret-preview`);
    expect((opciones.headers as Record<string, string>)["x-vercel-protection-bypass"]).toBe(BYPASS);
    expect(url).not.toContain(BYPASS);
    expect(opciones.body).not.toContain("secreto-candidato");
    expect(opciones.body).not.toContain(BYPASS);
  });

  it("propaga coincide=false sin confundirlo con un error HTTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, coincide: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      verificarSecretPreview(fetchMock, {
        CARGA_CONSULTAS_BASE_URL: BASE,
        CARGA_CONSULTAS_NEXTAUTH_SECRET: "secreto-candidato",
        CARGA_CONSULTAS_VERCEL_BYPASS: BYPASS,
      }),
    ).resolves.toBe(false);
  });
});
