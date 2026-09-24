// Pruebas -- limites de tamano/filas de una importacion CSV (Incremento
// 4, Bloque B, preparacion).
import { describe, expect, it } from "vitest";
import {
  MAX_FILAS,
  MAX_TAMANO_ARCHIVO_BYTES,
  validarLimitesArchivoCsv,
} from "../limitesImportacionCsv";

describe("validarLimitesArchivoCsv", () => {
  it("acepta un archivo dentro de ambos limites", () => {
    const r = validarLimitesArchivoCsv({ tamanoBytes: 1024, numeroFilas: 100 });
    expect(r.valido).toBe(true);
    expect(r.motivo).toBeUndefined();
  });

  it("acepta exactamente en el limite (inclusive)", () => {
    const r = validarLimitesArchivoCsv({
      tamanoBytes: MAX_TAMANO_ARCHIVO_BYTES,
      numeroFilas: MAX_FILAS,
    });
    expect(r.valido).toBe(true);
  });

  it("rechaza un archivo que supera el limite de tamano, con mensaje claro", () => {
    const r = validarLimitesArchivoCsv({
      tamanoBytes: MAX_TAMANO_ARCHIVO_BYTES + 1,
      numeroFilas: 10,
    });
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe("ARCHIVO_MUY_GRANDE");
    expect(r.mensaje).toMatch(/dividirlo|dividilo/i);
  });

  it("rechaza un archivo que supera el limite de filas, con mensaje claro", () => {
    const r = validarLimitesArchivoCsv({
      tamanoBytes: 1024,
      numeroFilas: MAX_FILAS + 1,
    });
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe("DEMASIADAS_FILAS");
    // El numero va formateado con separador de miles (toLocaleString) --
    // se compara contra el mismo formato, no contra el numero crudo.
    expect(r.mensaje).toContain(MAX_FILAS.toLocaleString("es-PE"));
  });

  it("si ambos limites se exceden, reporta tamano primero (motivo unico, no ambos)", () => {
    const r = validarLimitesArchivoCsv({
      tamanoBytes: MAX_TAMANO_ARCHIVO_BYTES + 1,
      numeroFilas: MAX_FILAS + 1,
    });
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe("ARCHIVO_MUY_GRANDE");
  });
});
