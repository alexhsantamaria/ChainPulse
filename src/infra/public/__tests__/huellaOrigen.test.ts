// Pruebas — extraccion de la huella de origen cruda desde Headers.
import { describe, expect, it } from "vitest";
import { extraerHuellaOrigenCruda } from "../huellaOrigen";

describe("extraerHuellaOrigenCruda", () => {
  it("toma la primera IP de x-forwarded-for cuando hay varias (cliente real primero)", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" });
    expect(extraerHuellaOrigenCruda(headers)).toBe("203.0.113.5");
  });

  it("recorta espacios alrededor de la IP", () => {
    const headers = new Headers({ "x-forwarded-for": "  203.0.113.5  ,10.0.0.1" });
    expect(extraerHuellaOrigenCruda(headers)).toBe("203.0.113.5");
  });

  it("usa x-real-ip como respaldo si no hay x-forwarded-for", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(extraerHuellaOrigenCruda(headers)).toBe("198.51.100.7");
  });

  it("prefiere x-forwarded-for sobre x-real-ip si ambas estan presentes", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.7" });
    expect(extraerHuellaOrigenCruda(headers)).toBe("203.0.113.5");
  });

  it("devuelve un valor fijo si no hay ninguna cabecera", () => {
    const headers = new Headers();
    expect(extraerHuellaOrigenCruda(headers)).toBe("origen-desconocido");
  });

  it("ignora x-forwarded-for vacia y cae al valor fijo si tampoco hay x-real-ip", () => {
    const headers = new Headers({ "x-forwarded-for": "" });
    expect(extraerHuellaOrigenCruda(headers)).toBe("origen-desconocido");
  });
});
