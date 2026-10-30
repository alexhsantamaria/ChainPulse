import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verificarPreauthMock = vi.fn();
vi.mock("@/auth.config.plataforma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth.config.plataforma")>();
  return { ...actual, verificarTokenPreauthPlataforma: (...args: unknown[]) => verificarPreauthMock(...args) };
});

const enrolarMock = vi.fn();
vi.mock("@/infra/auth/mfaPlataforma", () => ({
  generarSecretoMfaPlataforma: () => ({ secretoBase32: "CANDIDATO", otpauthUrl: "ignorado" }),
  enrolarMfaPlataforma: (...args: unknown[]) => enrolarMock(...args),
  construirOtpauthUrlMfaPlataforma: (_etiqueta: string, secreto: string) => `otpauth://totp/${secreto}`,
}));

function request(conCookie = true) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/mfa/enrolar", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://plataforma.example.com",
      ...(conCookie ? { cookie: "chainpulse_plataforma_preauth=preauth" } : {}),
    },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  verificarPreauthMock.mockResolvedValue({ usuarioId: "u1" });
  enrolarMock.mockResolvedValue({ ok: true, motivo: "PENDIENTE_EXISTENTE", secretoEfectivo: "EFECTIVO" });
});

describe("POST /api/plataforma/mfa/enrolar", () => {
  it("renderiza siempre el secreto efectivo devuelto por Postgres", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(request());

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, otpauthUrl: "otpauth://totp/EFECTIVO" });
    expect(enrolarMock).toHaveBeenCalledWith("u1", "CANDIDATO");
  });

  it("sin preauth valido rechaza antes de generar o persistir", async () => {
    verificarPreauthMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const respuesta = await POST(request(false));

    expect(respuesta.status).toBe(401);
    expect(enrolarMock).not.toHaveBeenCalled();
  });
});
