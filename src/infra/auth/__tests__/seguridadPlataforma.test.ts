import { beforeEach, describe, expect, it } from "vitest";
import { validarSolicitudEscrituraPlataforma } from "../seguridadPlataforma";

beforeEach(() => {
  process.env.PLATAFORMA_ORIGENES_PERMITIDOS = "https://plataforma.example.com";
});

function request(headers: Record<string, string>) {
  return new Request("https://plataforma.example.com/api/plataforma/login", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("validarSolicitudEscrituraPlataforma", () => {
  it("acepta JSON con Origin permitido", () => {
    expect(
      validarSolicitudEscrituraPlataforma(
        request({ "content-type": "application/json", origin: "https://plataforma.example.com" }),
      ),
    ).toBeNull();
  });

  it("rechaza formularios y origenes ajenos", async () => {
    const tipo = validarSolicitudEscrituraPlataforma(
      request({ "content-type": "application/x-www-form-urlencoded", origin: "https://plataforma.example.com" }),
    );
    expect(tipo?.status).toBe(415);

    const origen = validarSolicitudEscrituraPlataforma(
      request({ "content-type": "application/json", origin: "https://atacante.example" }),
    );
    expect(origen?.status).toBe(403);
    await expect(origen?.json()).resolves.toEqual({ ok: false, error: "ORIGEN_NO_PERMITIDO" });
  });

  it("sin Origin exige Host permitido", () => {
    expect(
      validarSolicitudEscrituraPlataforma(
        request({ "content-type": "application/json", host: "plataforma.example.com" }),
      ),
    ).toBeNull();
    expect(
      validarSolicitudEscrituraPlataforma(
        request({ "content-type": "application/json", host: "otro.example.com" }),
      )?.status,
    ).toBe(403);
  });
});
