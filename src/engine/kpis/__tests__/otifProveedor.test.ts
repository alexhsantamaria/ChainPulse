import { describe, expect, it } from "vitest";
import { calcularOtifProveedor, type FilaOtifProveedor } from "../otifProveedor";

function fila(over: Partial<FilaOtifProveedor> = {}): FilaOtifProveedor {
  return {
    proveedorAlias: "Proveedor A",
    fechaPromesa: new Date("2026-01-10"),
    fechaRecepcion: new Date("2026-01-10"),
    cantidadPedida: 50,
    cantidadRecibida: 50,
    ...over,
  };
}

describe("calcularOtifProveedor", () => {
  it("cuenta una recepcion completa y a tiempo", () => {
    const r = calcularOtifProveedor([fila()]);
    expect(r.valor).toBe(1);
  });

  it("no cuenta una recepcion tardia", () => {
    const r = calcularOtifProveedor([fila({ fechaRecepcion: new Date("2026-01-15") })]);
    expect(r.valor).toBe(0);
  });

  it("no cuenta una recepcion incompleta", () => {
    const r = calcularOtifProveedor([fila({ cantidadRecibida: 30 })]);
    expect(r.valor).toBe(0);
  });

  it("excluye recepciones todavia no cerradas", () => {
    const r = calcularOtifProveedor([fila({ fechaRecepcion: null, cantidadRecibida: null })]);
    expect(r.filasExcluidas).toBe(1);
    expect(r.valor).toBeNull();
  });
});
