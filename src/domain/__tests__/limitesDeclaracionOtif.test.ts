// Pruebas -- limites explicitos de la declaracion OTIF nivel 2 (modo
// "pegado"), Incremento 4 Bloque B (Alex, 2026-10-10).
import { describe, expect, it } from "vitest";
import { MAX_FILAS_PEGADO_OTIF, validarLimiteFilasPegadoOtif } from "../limitesDeclaracionOtif";

describe("validarLimiteFilasPegadoOtif", () => {
  it("acepta exactamente el limite", () => {
    expect(validarLimiteFilasPegadoOtif(MAX_FILAS_PEGADO_OTIF)).toEqual({ valido: true });
  });

  it("rechaza un numero de filas por encima del limite, con el detalle para la UI", () => {
    const resultado = validarLimiteFilasPegadoOtif(MAX_FILAS_PEGADO_OTIF + 1);
    expect(resultado).toEqual({ valido: false, motivo: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_OTIF, recibidas: MAX_FILAS_PEGADO_OTIF + 1 });
  });

  it("acepta 0 filas (la tabla vacia es un error distinto, decidido en declarar.ts, no aca)", () => {
    expect(validarLimiteFilasPegadoOtif(0)).toEqual({ valido: true });
  });
});
