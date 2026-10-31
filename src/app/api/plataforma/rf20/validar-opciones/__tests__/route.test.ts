import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSesionMock = vi.fn();
vi.mock("@/infra/auth/sessionPlataforma", () => ({
  requireSesionPlataformaRuta: (...args: unknown[]) => requireSesionMock(...args),
}));

const validarMock = vi.fn();
vi.mock("@/infra/rf20/gobernanzaVersiones", () => ({
  validarEstructuraOpcionesPregunta: (...args: unknown[]) => validarMock(...args),
}));

function postRequest(body: unknown) {
  return new NextRequest("https://plataforma.example.com/api/plataforma/rf20/validar-opciones", {
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

describe("POST /api/plataforma/rf20/validar-opciones", () => {
  it("invoca exactamente la funcion que usara publicar y reenvia valido/motivo", async () => {
    validarMock.mockResolvedValue({ valido: false, motivo: "OPCIONES_DUPLICADAS" });
    const opciones = [{ valor: "a", texto: "A", orden: 0 }];
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ opciones }));

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, valido: false, motivo: "OPCIONES_DUPLICADAS" });
    expect(validarMock).toHaveBeenCalledWith(opciones);
  });

  it("siempre responde 200 con ok:true aunque la estructura sea invalida (no es un rechazo HTTP)", async () => {
    validarMock.mockResolvedValue({ valido: true, motivo: "" });
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({ opciones: [] }));

    expect(respuesta.status).toBe(200);
  });

  it("falta el campo opciones devuelve 400", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(postRequest({}));

    expect(respuesta.status).toBe(400);
    expect(validarMock).not.toHaveBeenCalled();
  });
});
