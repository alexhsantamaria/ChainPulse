import { describe, expect, it } from "vitest";
import { calcularSalud } from "../salud";

// RF6 / ADR-0002 (plan de pruebas minimo): "no se"/"no aplica" nunca dan
// puntuacion cero — un falso cero aqui engaña al usuario.
describe("calcularSalud", () => {
  it("normaliza el promedio Likert 1-5 a la escala 0-100 (avg=4 -> 75)", () => {
    const r = calcularSalud([
      { valor: 5, noSabe: false, noAplica: false },
      { valor: 3, noSabe: false, noAplica: false },
    ]);
    expect(r.salud).toBe(75);
  });

  it("excluye 'no aplica' del calculo por completo, sin contarla como cero", () => {
    const r = calcularSalud([
      { valor: 5, noSabe: false, noAplica: false },
      { valor: null, noSabe: false, noAplica: true },
    ]);
    expect(r.salud).toBe(100);
    expect(r.respuestasNoAplica).toBe(1);
  });

  it("'no se' se registra aparte y no arrastra la salud hacia abajo", () => {
    const r = calcularSalud([
      { valor: 5, noSabe: false, noAplica: false },
      { valor: null, noSabe: true, noAplica: false },
    ]);
    expect(r.salud).toBe(100);
    expect(r.respuestasNoSabe).toBe(1);
    expect(r.coberturaConfianza).toBe(0.5);
  });

  it("devuelve salud null (no cero) cuando no hay ninguna respuesta valida", () => {
    const r = calcularSalud([{ valor: null, noSabe: true, noAplica: false }]);
    expect(r.salud).toBeNull();
  });
});
