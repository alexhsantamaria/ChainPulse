import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const reordenarMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  reordenarPreguntasVersion: (...args: unknown[]) => reordenarMock(...args),
}));

function postRequest(body: unknown) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/versiones/v1/reordenar", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://plataforma.example.com" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  requireSesionMock.mockResolvedValue({ sesion: { usuarioId: "u1", rol: "CURADOR", sessionVersion: 1 } });
});

describe("POST /api/plataforma/rf20/versiones/[versionId]/reordenar", () => {
  it("reenvia los ordenes y responde ok", async () => {
    reordenarMock.mockResolvedValue({ reordenado: true, motivo: "" });
    const ordenes = [{ id: "p1", orden: 2 }, { id: "p2", orden: 1 }];
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ ordenes }), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(200);
    expect(reordenarMock).toHaveBeenCalledWith("v1", ordenes);
  });

  it("secuencia con huecos/duplicados mapea el rechazo a 409", async () => {
    reordenarMock.mockResolvedValue({ reordenado: false, motivo: "SECUENCIA_INVALIDA" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ ordenes: [{ id: "p1", orden: 1 }] }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toEqual({ ok: false, motivo: "SECUENCIA_INVALIDA" });
  });

  it("payload vacio (ordenes: []) devuelve 400 sin invocar la funcion", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ ordenes: [] }), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(400);
    expect(reordenarMock).not.toHaveBeenCalled();
  });
});
