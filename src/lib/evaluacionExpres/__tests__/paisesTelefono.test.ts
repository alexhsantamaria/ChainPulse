import { describe, expect, it } from "vitest";
import {
  banderaPais,
  PAIS_TELEFONO_DEFECTO,
  PAISES_TELEFONO,
  paisTelefonoPorCodigo,
} from "../paisesTelefono";

describe("banderaPais", () => {
  it("convierte PE en la bandera de Perú", () => {
    expect(banderaPais("PE")).toBe("🇵🇪");
  });

  it("convierte US en la bandera de Estados Unidos", () => {
    expect(banderaPais("US")).toBe("🇺🇸");
  });

  it("es insensible a mayúsculas/minúsculas", () => {
    expect(banderaPais("pe")).toBe(banderaPais("PE"));
  });
});

describe("PAISES_TELEFONO", () => {
  it("tiene a Perú primero, como país por defecto", () => {
    expect(PAISES_TELEFONO[0]?.codigoIso2).toBe("PE");
    expect(PAISES_TELEFONO[0]?.indicativo).toBe("+51");
    expect(PAISES_TELEFONO[0]?.codigoIso2).toBe(PAIS_TELEFONO_DEFECTO);
  });

  it("no tiene codigoIso2 duplicados", () => {
    const codigos = PAISES_TELEFONO.map((pais) => pais.codigoIso2);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("cada indicativo empieza con '+'", () => {
    for (const pais of PAISES_TELEFONO) {
      expect(pais.indicativo.startsWith("+")).toBe(true);
    }
  });
});

describe("paisTelefonoPorCodigo", () => {
  it("encuentra Perú por su código", () => {
    expect(paisTelefonoPorCodigo(PAIS_TELEFONO_DEFECTO)?.nombre).toBe("Perú");
  });

  it("devuelve undefined para un código inexistente", () => {
    expect(paisTelefonoPorCodigo("XX")).toBeUndefined();
  });
});
