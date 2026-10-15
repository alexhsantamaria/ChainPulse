// Pruebas -- limites explicitos de Incremento 5 (I5-14), mismo criterio
// que limitesDeclaracionOtif.test.ts.
import { describe, expect, it } from "vitest";
import {
  MAX_DIAS_PERIODO_CONSULTA,
  MAX_ELEMENTOS_LISTA_RESPUESTA,
  truncarListaRespuesta,
  validarPeriodoConsulta,
} from "../limitesConsultas";

describe("validarPeriodoConsulta", () => {
  it("acepta un periodo con inicio anterior a fin, dentro del limite de dias", () => {
    const resultado = validarPeriodoConsulta(new Date("2026-01-01"), new Date("2026-01-31"));
    expect(resultado).toEqual({ valido: true });
  });

  it("acepta inicio igual a fin (periodo de un solo dia)", () => {
    const fecha = new Date("2026-01-01");
    expect(validarPeriodoConsulta(fecha, fecha)).toEqual({ valido: true });
  });

  it("rechaza inicio posterior a fin con PERIODO_INVALIDO", () => {
    const resultado = validarPeriodoConsulta(new Date("2026-02-01"), new Date("2026-01-01"));
    expect(resultado).toEqual({ valido: false, motivo: "PERIODO_INVALIDO" });
  });

  it("rechaza un periodo que excede MAX_DIAS_PERIODO_CONSULTA con PERIODO_DEMASIADO_LARGO", () => {
    const inicio = new Date("2020-01-01");
    const fin = new Date(inicio.getTime() + (MAX_DIAS_PERIODO_CONSULTA + 1) * 24 * 60 * 60 * 1000);
    const resultado = validarPeriodoConsulta(inicio, fin);
    expect(resultado).toEqual({ valido: false, motivo: "PERIODO_DEMASIADO_LARGO" });
  });

  it("acepta un periodo de exactamente MAX_DIAS_PERIODO_CONSULTA dias (limite inclusive)", () => {
    const inicio = new Date("2020-01-01");
    const fin = new Date(inicio.getTime() + MAX_DIAS_PERIODO_CONSULTA * 24 * 60 * 60 * 1000);
    expect(validarPeriodoConsulta(inicio, fin)).toEqual({ valido: true });
  });
});

describe("truncarListaRespuesta", () => {
  it("devuelve la lista intacta cuando no excede el limite", () => {
    const lista = ["a", "b", "c"];
    expect(truncarListaRespuesta(lista)).toEqual(["a", "b", "c"]);
  });

  it("nunca muta la lista original (devuelve una copia)", () => {
    const lista = ["a", "b"];
    const resultado = truncarListaRespuesta(lista);
    resultado.push("c");
    expect(lista).toEqual(["a", "b"]);
  });

  it("trunca y agrega un ultimo elemento informativo cuando excede el limite", () => {
    const lista = Array.from({ length: MAX_ELEMENTOS_LISTA_RESPUESTA + 5 }, (_, i) => `elemento-${i}`);
    const resultado = truncarListaRespuesta(lista);
    expect(resultado).toHaveLength(MAX_ELEMENTOS_LISTA_RESPUESTA + 1);
    expect(resultado[MAX_ELEMENTOS_LISTA_RESPUESTA]).toContain("5 elemento(s) más");
  });

  it("acepta exactamente el limite sin truncar", () => {
    const lista = Array.from({ length: MAX_ELEMENTOS_LISTA_RESPUESTA }, (_, i) => `elemento-${i}`);
    expect(truncarListaRespuesta(lista)).toHaveLength(MAX_ELEMENTOS_LISTA_RESPUESTA);
  });
});
