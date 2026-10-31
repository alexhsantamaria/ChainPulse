import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const editarPreguntaMock = vi.fn();
const eliminarPreguntaMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  editarPreguntaVersion: (...args: unknown[]) => editarPreguntaMock(...args),
  eliminarPreguntaVersion: (...args: unknown[]) => eliminarPreguntaMock(...args),
}));

const PATCH_VALIDO = { texto: "nuevo texto", dimension: "EVIDENCIA", opciones: [], esNoPuntuable: false };

function patchRequest(body: unknown) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/preguntas/p1", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://plataforma.example.com" },
    body: JSON.stringify(body),
  });
}

function deleteRequest() {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/preguntas/p1", {
    method: "DELETE",
    headers: { "content-type": "application/json", origin: "https://plataforma.example.com" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  requireSesionMock.mockResolvedValue({ sesion: { usuarioId: "u1", rol: "CURADOR", sessionVersion: 1 } });
});

describe("PATCH /api/plataforma/rf20/preguntas/[preguntaId]", () => {
  it("edita la pregunta (sin codigo ni orden en el payload)", async () => {
    editarPreguntaMock.mockResolvedValue({ ok: true, motivo: "" });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest(PATCH_VALIDO), { params: Promise.resolve({ preguntaId: "p1" }) });

    expect(respuesta.status).toBe(200);
    expect(editarPreguntaMock).toHaveBeenCalledWith({ preguntaId: "p1", ...PATCH_VALIDO });
  });

  it("pregunta inexistente mapea a 404", async () => {
    editarPreguntaMock.mockResolvedValue({ ok: false, motivo: "PREGUNTA_INEXISTENTE" });
    const { PATCH } = await import("../route");
    const respuesta = await PATCH(patchRequest(PATCH_VALIDO), { params: Promise.resolve({ preguntaId: "noexiste" }) });

    expect(respuesta.status).toBe(404);
  });
});

describe("DELETE /api/plataforma/rf20/preguntas/[preguntaId]", () => {
  it("elimina la pregunta de un borrador", async () => {
    eliminarPreguntaMock.mockResolvedValue({ ok: true, motivo: "" });
    const { DELETE } = await import("../route");
    const respuesta = await DELETE(deleteRequest(), { params: Promise.resolve({ preguntaId: "p1" }) });

    expect(respuesta.status).toBe(200);
    expect(eliminarPreguntaMock).toHaveBeenCalledWith("p1");
  });

  it("version no es BORRADOR mapea el rechazo a 409", async () => {
    eliminarPreguntaMock.mockResolvedValue({ ok: false, motivo: "VERSION_NO_ES_BORRADOR" });
    const { DELETE } = await import("../route");
    const respuesta = await DELETE(deleteRequest(), { params: Promise.resolve({ preguntaId: "p1" }) });

    expect(respuesta.status).toBe(409);
  });
});
