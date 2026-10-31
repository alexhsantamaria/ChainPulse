import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireAdminMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireAdministradorPlataformaRuta: (...args: unknown[]) => requireAdminMock(...args),
}));

const retirarMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  retirarCuestionarioVersion: (...args: unknown[]) => retirarMock(...args),
}));

function postRequest() {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/versiones/v1/retirar", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://plataforma.example.com" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  requireAdminMock.mockResolvedValue({
    sesion: { usuarioId: "admin1", rol: "ADMINISTRADOR_PLATAFORMA", sessionVersion: 1 },
  });
});

describe("POST /api/plataforma/rf20/versiones/[versionId]/retirar", () => {
  it("retira la version publicada vigente", async () => {
    retirarMock.mockResolvedValue({ retirada: true, motivo: "" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(200);
    expect(retirarMock).toHaveBeenCalledWith("v1", "admin1");
  });

  it("version que no esta PUBLICADA mapea el rechazo a 409", async () => {
    retirarMock.mockResolvedValue({ retirada: false, motivo: "VERSION_NO_PUBLICADA" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(409);
  });

  it("sin rol ADMINISTRADOR_PLATAFORMA no retira", async () => {
    const { NextResponse } = await import("next/server");
    requireAdminMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false }, { status: 403 }) });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(403);
    expect(retirarMock).not.toHaveBeenCalled();
  });
});
