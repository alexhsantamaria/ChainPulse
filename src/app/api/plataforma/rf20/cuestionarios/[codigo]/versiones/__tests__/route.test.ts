import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const listarVersionesMock = vi.fn();
vi.mock("@/infra/rf20/consultas", () => ({
  listarVersionesPorCodigo: (...args: unknown[]) => listarVersionesMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireSesionMock.mockResolvedValue({ sesion: { usuarioId: "u1", rol: "CURADOR", sessionVersion: 1 } });
});

describe("GET /api/plataforma/rf20/cuestionarios/[codigo]/versiones", () => {
  it("lista las versiones del codigo pedido en la URL", async () => {
    listarVersionesMock.mockResolvedValue([{ id: "v1", numero: 1, estado: "BORRADOR" }]);
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("https://x/"), { params: Promise.resolve({ codigo: "mi-codigo" }) });

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({
      ok: true,
      codigo: "mi-codigo",
      versiones: [{ id: "v1", numero: 1, estado: "BORRADOR" }],
    });
    expect(listarVersionesMock).toHaveBeenCalledWith("mi-codigo");
  });

  it("sin sesion valida no consulta", async () => {
    const { NextResponse } = await import("next/server");
    requireSesionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false }, { status: 401 }) });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("https://x/"), { params: Promise.resolve({ codigo: "mi-codigo" }) });

    expect(respuesta.status).toBe(401);
    expect(listarVersionesMock).not.toHaveBeenCalled();
  });
});
