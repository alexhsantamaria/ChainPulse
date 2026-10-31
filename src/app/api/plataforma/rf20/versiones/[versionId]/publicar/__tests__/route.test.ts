import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireAdministradorPlataformaRuta: (...args: unknown[]) => requireAdminMock(...args),
}));

const publicarMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  publicarCuestionarioVersion: (...args: unknown[]) => publicarMock(...args),
}));

function postRequest(body: unknown) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/versiones/v1/publicar", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://plataforma.example.com" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  requireAdminMock.mockResolvedValue({
    sesion: { usuarioId: "admin1", rol: "ADMINISTRADOR_PLATAFORMA", sessionVersion: 1 },
  });
});

describe("POST /api/plataforma/rf20/versiones/[versionId]/publicar", () => {
  it("publica y reenvia versionVigenteEsperadaId exactamente como llego", async () => {
    publicarMock.mockResolvedValue({ publicada: true, motivo: "" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ versionVigenteEsperadaId: "v0" }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(200);
    expect(publicarMock).toHaveBeenCalledWith({
      versionId: "v1",
      actorId: "admin1",
      versionVigenteEsperadaId: "v0",
    });
  });

  it("acepta null cuando el llamador cree que no hay vigente", async () => {
    publicarMock.mockResolvedValue({ publicada: true, motivo: "" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ versionVigenteEsperadaId: null }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(200);
  });

  it("falta el campo (ni string ni null) devuelve 400", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({}), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(400);
    expect(publicarMock).not.toHaveBeenCalled();
  });

  it("carrera de publicacion concurrente mapea a 409", async () => {
    publicarMock.mockResolvedValue({ publicada: false, motivo: "VERSION_PUBLICADA_CONCURRENTE" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ versionVigenteEsperadaId: "v0" }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(409);
  });

  it("un curador sin rol ADMINISTRADOR_PLATAFORMA no puede publicar", async () => {
    const { NextResponse } = await import("next/server");
    requireAdminMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false }, { status: 403 }) });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ versionVigenteEsperadaId: null }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(403);
    expect(publicarMock).not.toHaveBeenCalled();
  });
});
