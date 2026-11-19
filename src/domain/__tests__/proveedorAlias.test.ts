import { describe, expect, it } from "vitest";
import { compararClavesProveedor, normalizarAliasProveedor } from "../proveedorAlias";

describe("normalizarAliasProveedor", () => {
  it("recorta espacios al inicio y al final", () => {
    const r = normalizarAliasProveedor("  Proveedor A  ");
    expect(r).not.toBeNull();
    expect(r?.visible).toBe("Proveedor A");
  });

  it("colapsa espacios internos multiples a uno solo, en visible y en clave", () => {
    const r = normalizarAliasProveedor("Proveedor     A");
    expect(r?.visible).toBe("Proveedor A");
    expect(r?.clave).toBe("proveedor a");
  });

  it("colapsa tabs y saltos de linea internos como espacio", () => {
    const r = normalizarAliasProveedor("Proveedor\t\nA");
    expect(r?.visible).toBe("Proveedor A");
  });

  it("la clave aplica case folding pero visible preserva el casing original", () => {
    const r = normalizarAliasProveedor("PROVEEDOR a");
    expect(r?.visible).toBe("PROVEEDOR a");
    expect(r?.clave).toBe("proveedor a");
  });

  it("identidad entre mayusculas/minusculas y espacios: 3 variantes producen la MISMA clave", () => {
    const a = normalizarAliasProveedor("Proveedor A");
    const b = normalizarAliasProveedor("proveedor a");
    const c = normalizarAliasProveedor("  PROVEEDOR   A  ");
    expect(a?.clave).toBe(b?.clave);
    expect(b?.clave).toBe(c?.clave);
    // pero cada `visible` conserva su propia forma (salvo colapso de espacios)
    expect(a?.visible).toBe("Proveedor A");
    expect(b?.visible).toBe("proveedor a");
    expect(c?.visible).toBe("PROVEEDOR A");
  });

  it("alias vacio tras recortar (solo espacios) devuelve null, nunca una clave vacia", () => {
    expect(normalizarAliasProveedor("   ")).toBeNull();
    expect(normalizarAliasProveedor("")).toBeNull();
    expect(normalizarAliasProveedor("\t\n  ")).toBeNull();
  });

  it("nunca usa toLocaleLowerCase (case folding estable, independiente del locale del host)", () => {
    // Regresion explicita: si alguna vez se reemplazara toLowerCase() por
    // toLocaleLowerCase("tr"), "I" mapearia a "ı" (dotless i) en vez de
    // "i", y esta aserción fallaria -- prueba de que el folding actual es
    // el de ECMA-262 (tabla fija), nunca el del locale turco.
    const r = normalizarAliasProveedor("PROVEEDOR I");
    expect(r?.clave).toBe("proveedor i");
    expect(r?.clave.includes("ı")).toBe(false);
  });
});

describe("compararClavesProveedor", () => {
  it("ordena ascendentemente por puntos de codigo, nunca con localeCompare", () => {
    expect(compararClavesProveedor("a", "b")).toBeLessThan(0);
    expect(compararClavesProveedor("b", "a")).toBeGreaterThan(0);
    expect(compararClavesProveedor("a", "a")).toBe(0);
  });

  it("es consistente para ordenar un arreglo (sort) de forma deterministica", () => {
    const claves = ["proveedor c", "proveedor a", "proveedor b"];
    claves.sort(compararClavesProveedor);
    expect(claves).toEqual(["proveedor a", "proveedor b", "proveedor c"]);
  });
});
