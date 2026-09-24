// Pruebas -- sanitizacion de inyeccion de formulas CSV (Incremento 4,
// Bloque B, preparacion).
import { describe, expect, it } from "vitest";
import { esFormulaPeligrosa, sanitizarCeldaTexto, sanitizarFilaCsv } from "../sanitizacionCsv";

describe("esFormulaPeligrosa", () => {
  it("detecta los 4 caracteres marcados por Alex al inicio de la celda", () => {
    expect(esFormulaPeligrosa("=cmd|'/c calc'!A1")).toBe(true);
    expect(esFormulaPeligrosa("+1+1")).toBe(true);
    expect(esFormulaPeligrosa("-2+3")).toBe(true);
    expect(esFormulaPeligrosa("@SUM(A1:A9)")).toBe(true);
  });

  it("ignora espacios en blanco iniciales antes de mirar el primer caracter", () => {
    expect(esFormulaPeligrosa("   =cmd")).toBe(true);
    expect(esFormulaPeligrosa("\t=cmd")).toBe(true);
  });

  it("no marca texto normal, ni un caracter peligroso que no esta al inicio", () => {
    expect(esFormulaPeligrosa("SKU-001")).toBe(false);
    expect(esFormulaPeligrosa("Almacen Lima")).toBe(false);
    expect(esFormulaPeligrosa("Pedido con - guion en el medio")).toBe(false);
  });

  it("cadena vacia no es peligrosa", () => {
    expect(esFormulaPeligrosa("")).toBe(false);
    expect(esFormulaPeligrosa("   ")).toBe(false);
  });
});

describe("sanitizarCeldaTexto", () => {
  it("prefija con apostrofo cuando la celda es peligrosa, preservando el valor original", () => {
    expect(sanitizarCeldaTexto("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(sanitizarCeldaTexto("+1+1")).toBe("'+1+1");
    expect(sanitizarCeldaTexto("-2+3")).toBe("'-2+3");
    expect(sanitizarCeldaTexto("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
  });

  it("no toca texto seguro", () => {
    expect(sanitizarCeldaTexto("SKU-001")).toBe("SKU-001");
    expect(sanitizarCeldaTexto("Almacen Lima")).toBe("Almacen Lima");
  });

  it("es idempotente -- no duplica el apostrofo si ya esta sanitizada", () => {
    const sanitizada = sanitizarCeldaTexto("=cmd");
    expect(sanitizarCeldaTexto(sanitizada)).toBe(sanitizada);
  });
});

describe("sanitizarFilaCsv", () => {
  it("sanitiza solo los campos de texto declarados, deja el resto intacto", () => {
    const fila = {
      sku: "=cmd|'/c calc'!A1",
      ubicacion: "Almacen Lima",
      stockDisponible: "-5", // string cruda antes del parseo numerico -- no es un campo de texto
      fecha: "2026-09-24",
    };
    const resultado = sanitizarFilaCsv(fila, ["sku", "ubicacion"]);
    expect(resultado.sku).toBe("'=cmd|'/c calc'!A1");
    expect(resultado.ubicacion).toBe("Almacen Lima");
    // stockDisponible no estaba en camposTexto -- se devuelve sin tocar,
    // el "-" inicial sigue ahi para que el parseo numerico lo lea como
    // signo negativo legitimo.
    expect(resultado.stockDisponible).toBe("-5");
    expect(resultado.fecha).toBe("2026-09-24");
  });

  it("no muta la fila original (funcion pura)", () => {
    const fila = { sku: "=cmd" };
    const original = { ...fila };
    sanitizarFilaCsv(fila, ["sku"]);
    expect(fila).toEqual(original);
  });

  it("deja sin tocar valores que no son string, aunque el campo este en camposTexto", () => {
    const fila = { sku: "=cmd", cantidad: 5 as unknown };
    const resultado = sanitizarFilaCsv(fila, ["sku", "cantidad"]);
    expect(resultado.cantidad).toBe(5);
  });
});
