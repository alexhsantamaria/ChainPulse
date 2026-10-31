import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const listarMock = vi.fn();
vi.mock("@/infra/rf20/consultas", () => ({
  listarCuestionarios: (...args: unknown[]) => listarMock(...args),
}));

const crearMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  crearCuestionarioVersion: (...args: unknown[]) => crearMock(...args),
}));

function postRequest(body: unknown, conOrigen = true) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/cuestionarios", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(conOrigen ? { origin: "https://plataforma.example.com" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
  requireSesionMock.mockResolvedValue({ sesion: { usuarioId: "u1", rol: "CURADOR", sessionVersion: 1 } });
});

describe("GET /api/plataforma/rf20/cuestionarios", () => {
  it("devuelve la lista cuando hay sesion valida", async () => {
    listarMock.mockResolvedValue([{ codigo: "x", totalVersiones: 1 }]);
    const { GET } = await import("../route");
    const respuesta = await GET();

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, cuestionarios: [{ codigo: "x", totalVersiones: 1 }] });
  });

  it("sin sesion valida devuelve la respuesta del guard sin consultar", async () => {
    const { NextResponse } = await import("next/server");
    requireSesionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false }, { status: 401 }) });
    const { GET } = await import("../route");
    const respuesta = await GET();

    expect(respuesta.status).toBe(401);
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("error interno al consultar devuelve 500", async () => {
    listarMock.mockRejectedValue(new Error("boom"));
    const { GET } = await import("../route");
    const respuesta = await GET();

    expect(respuesta.status).toBe(500);
  });
});

describe("POST /api/plataforma/rf20/cuestionarios", () => {
  it("crea la primera version de un codigo nuevo", async () => {
    crearMock.mockResolvedValue({ id: "v1", numero: 1 });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ codigo: "nuevo-codigo" }));

    expect(respuesta.status).toBe(201);
    expect(await respuesta.json()).toEqual({ ok: true, id: "v1", numero: 1 });
    expect(crearMock).toHaveBeenCalledWith("nuevo-codigo", "u1");
  });

  it("rechaza origen no permitido antes de exigir sesion o crear", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ codigo: "x" }, false));

    expect(respuesta.status).toBe(403);
    expect(requireSesionMock).not.toHaveBeenCalled();
    expect(crearMock).not.toHaveBeenCalled();
  });

  it("body invalido (codigo vacio) devuelve 400 sin invocar la funcion de gobernanza", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ codigo: "" }));

    expect(respuesta.status).toBe(400);
    expect(crearMock).not.toHaveBeenCalled();
  });
});
