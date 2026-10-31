import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const crearPreguntaMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  crearPreguntaVersion: (...args: unknown[]) => crearPreguntaMock(...args),
}));

const PREGUNTA_VALIDA = {
  codigo: "Q1",
  orden: 1,
  texto: "texto",
  dimension: "ALINEACION",
  opciones: [],
  esNoPuntuable: false,
};

function postRequest(body: unknown) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/versiones/v1/preguntas", {
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

describe("POST /api/plataforma/rf20/versiones/[versionId]/preguntas", () => {
  it("agrega la pregunta y responde 201 con el id generado", async () => {
    crearPreguntaMock.mockResolvedValue({ ok: true, motivo: "", id: "p1" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(PREGUNTA_VALIDA), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(201);
    expect(await respuesta.json()).toEqual({ ok: true, id: "p1" });
    expect(crearPreguntaMock).toHaveBeenCalledWith({ versionId: "v1", ...PREGUNTA_VALIDA });
  });

  it("rechazo de gobernanza (version no es BORRADOR) mapea a 409", async () => {
    crearPreguntaMock.mockResolvedValue({ ok: false, motivo: "VERSION_NO_ES_BORRADOR", id: "" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest(PREGUNTA_VALIDA), { params: Promise.resolve({ versionId: "v1" }) });

    expect(respuesta.status).toBe(409);
  });

  it("dimension invalida (fuera del enum) devuelve 400 sin invocar la funcion", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ ...PREGUNTA_VALIDA, dimension: "NO_EXISTE" }), {
      params: Promise.resolve({ versionId: "v1" }),
    });

    expect(respuesta.status).toBe(400);
    expect(crearPreguntaMock).not.toHaveBeenCalled();
  });
});
