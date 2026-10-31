import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const corregirMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  corregirCuestionarioVersion: (...args: unknown[]) => corregirMock(...args),
}));

function postRequest() {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/versiones/v1/corregir", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://plataforma.example.com" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  requireSesionMock.mockResolvedValue({ sesion: { usuarioId: "u1", rol: "CURADOR", sessionVersion: 1 } });
});

describe("POST /api/plataforma/rf20/versiones/[versionId]/corregir", () => {
  it("crea el borrador derivado y responde 201 con id/numero", async () => {
    corregirMock.mockResolvedValue({ id: "v2", numero: 2 });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(201);
    expect(await respuesta.json()).toEqual({ ok: true, id: "v2", numero: 2 });
    expect(corregirMock).toHaveBeenCalledWith("v1", "u1");
  });

  it("origen inexistente (RAISE EXCEPTION de Postgres) mapea a 404, no a 500", async () => {
    corregirMock.mockRejectedValue(new Error("RF20_ORIGEN_INEXISTENTE: no existe"));
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(), { params: Promise.resolve({ versionId: "noexiste" }) });

    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ ok: false, motivo: "RF20_ORIGEN_INEXISTENTE" });
  });

  it("cualquier otro error inesperado sigue siendo 500 generico", async () => {
    corregirMock.mockRejectedValue(new Error("otra falla"));
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(500);
  });
});
