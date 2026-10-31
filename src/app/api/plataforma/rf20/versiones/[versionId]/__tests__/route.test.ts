import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const obtenerDetalleMock = vi.fn();
vi.mock("@/infra/rf20/consultas", () => ({
  obtenerDetalleVersion: (...args: unknown[]) => obtenerDetalleMock(...args),
}));

const editarMetadataMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  editarMetadataCuestionarioVersion: (...args: unknown[]) => editarMetadataMock(...args),
}));

function patchRequest(body: unknown) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/versiones/v1", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://plataforma.example.com" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  requireSesionMock.mockResolvedValue({ sesion: { usuarioId: "u1", rol: "CURADOR", sessionVersion: 1 } });
});

describe("GET /api/plataforma/rf20/versiones/[versionId]", () => {
  it("devuelve 404 con motivo VERSION_INEXISTENTE cuando no existe", async () => {
    obtenerDetalleMock.mockResolvedValue(null);
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("https://x/"), { params: Promise.resolve({ versionId: "noexiste" }) });

    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ ok: false, motivo: "VERSION_INEXISTENTE" });
  });

  it("devuelve el detalle cuando existe", async () => {
    obtenerDetalleMock.mockResolvedValue({ id: "v1", codigo: "c", numero: 1, preguntas: [] });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("https://x/"), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()).version.id).toBe("v1");
  });
});

describe("PATCH /api/plataforma/rf20/versiones/[versionId]", () => {
  it("edita notasCambio y devuelve ok", async () => {
    editarMetadataMock.mockResolvedValue({ ok: true, motivo: "" });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ notasCambio: "texto" }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(200);
    expect(editarMetadataMock).toHaveBeenCalledWith("v1", "texto");
  });

  it("rechazo de gobernanza (version no es BORRADOR) mapea a 409", async () => {
    editarMetadataMock.mockResolvedValue({ ok: false, motivo: "VERSION_NO_ES_BORRADOR" });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({ notasCambio: null }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toEqual({ ok: false, motivo: "VERSION_NO_ES_BORRADOR" });
  });

  it("body invalido (notasCambio ausente) devuelve 400", async () => {
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest({}), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(400);
    expect(editarMetadataMock).not.toHaveBeenCalled();
  });
});
