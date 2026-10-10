// Pruebas -- leerCuerpoJsonLimitado(), lectura de body limitada por bytes
// REALES, nunca solo por Content-Length (Alex, 2026-10-10). Usa Request
// nativo (undici/Node): un body string no setea Content-Length solo
// (confirmado empiricamente), y el header se puede sobreescribir sin que
// cambie el contenido real del stream -- asi se pueden probar los casos
// de header ausente/mentiroso/invalido contra el tamano real.
import { describe, expect, it } from "vitest";
import { leerCuerpoJsonLimitado } from "../leerCuerpoJsonLimitado";

const LIMITE = 1000; // bytes, limite de prueba (no el de produccion)

function construirRequest(bodyTexto: string, headers?: Record<string, string>): Request {
  return new Request("http://localhost/x", { method: "POST", body: bodyTexto, headers });
}

describe("leerCuerpoJsonLimitado -- Content-Length ausente", () => {
  it("body mayor al limite, SIN header Content-Length -> CUERPO_DEMASIADO_GRANDE (la lectura real lo detecta igual)", async () => {
    const payload = JSON.stringify({ x: "a".repeat(LIMITE + 50) });
    const request = construirRequest(payload); // sin headers -> Node no setea content-length solo
    expect(request.headers.get("content-length")).toBeNull();
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: false, motivo: "CUERPO_DEMASIADO_GRANDE" });
  });

  it("body dentro del limite, sin header -> se lee y parsea normalmente", async () => {
    const payload = JSON.stringify({ x: "a".repeat(10) });
    const request = construirRequest(payload);
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: true, datos: { x: "a".repeat(10) } });
  });
});

describe("leerCuerpoJsonLimitado -- Content-Length menor que el tamano real (header mentiroso)", () => {
  it("Content-Length declara 5 pero el body real supera el limite -> CUERPO_DEMASIADO_GRANDE (nunca confia solo en el header)", async () => {
    const payload = JSON.stringify({ x: "a".repeat(LIMITE + 50) });
    const request = construirRequest(payload, { "content-length": "5" });
    expect(request.headers.get("content-length")).toBe("5");
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: false, motivo: "CUERPO_DEMASIADO_GRANDE" });
  });
});

describe("leerCuerpoJsonLimitado -- header invalido", () => {
  it("Content-Length no numerico -> se ignora el rechazo temprano, decide la lectura real (body dentro del limite pasa)", async () => {
    const payload = JSON.stringify({ x: "a".repeat(10) });
    const request = construirRequest(payload, { "content-length": "no-es-un-numero" });
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: true, datos: { x: "a".repeat(10) } });
  });

  it("Content-Length no numerico con body real que excede el limite -> CUERPO_DEMASIADO_GRANDE igual, por la lectura real", async () => {
    const payload = JSON.stringify({ x: "a".repeat(LIMITE + 50) });
    const request = construirRequest(payload, { "content-length": "no-es-un-numero" });
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: false, motivo: "CUERPO_DEMASIADO_GRANDE" });
  });
});

describe("leerCuerpoJsonLimitado -- limite exacto (bytes reales, no caracteres)", () => {
  it("body de exactamente `LIMITE` bytes se acepta", async () => {
    // JSON.stringify de un string de N caracteres ascii agrega 2 comillas
    // -- se descuenta para que el body entero (incluidas las comillas)
    // tenga EXACTAMENTE LIMITE bytes.
    const payload = JSON.stringify("a".repeat(LIMITE - 2));
    expect(Buffer.byteLength(payload, "utf-8")).toBe(LIMITE);
    const request = construirRequest(payload);
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado.ok).toBe(true);
  });

  it("body de LIMITE + 1 bytes se rechaza", async () => {
    const payload = JSON.stringify("a".repeat(LIMITE - 1));
    expect(Buffer.byteLength(payload, "utf-8")).toBe(LIMITE + 1);
    const request = construirRequest(payload);
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: false, motivo: "CUERPO_DEMASIADO_GRANDE" });
  });
});

describe("leerCuerpoJsonLimitado -- JSON invalido dentro del limite", () => {
  it("body dentro del limite pero no es JSON valido -> CUERPO_INVALIDO (nunca CUERPO_DEMASIADO_GRANDE)", async () => {
    const request = construirRequest("esto no es json");
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: false, motivo: "CUERPO_INVALIDO" });
  });

  it("body vacio -> CUERPO_INVALIDO", async () => {
    const request = construirRequest("");
    const resultado = await leerCuerpoJsonLimitado(request, LIMITE);
    expect(resultado).toEqual({ ok: false, motivo: "CUERPO_INVALIDO" });
  });
});
