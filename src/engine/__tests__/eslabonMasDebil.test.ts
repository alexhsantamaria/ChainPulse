// Pruebas — valida la identificacion de eslabones mas debiles.
import { describe, expect, it } from "vitest";
import { calcularEslabonesMasDebiles } from "../eslabonMasDebil";
import type { ValoresConexion } from "@/domain/types";

// RF7 / Seccion 12 / ADR-0002 (plan de pruebas minimo): frontera de
// Pareto, nunca un ganador arbitrario en un empate ambiguo, orden de
// lectura deterministico byte a byte.
describe("calcularEslabonesMasDebiles", () => {
  it("caso no ambiguo: A domina a B -> un solo eslabon mas debil", () => {
    const conexiones: ValoresConexion[] = [
      { conexionId: "A", salud: 20, criticidad: 90, gradoDependencia: "ALTA", riesgo: 50 },
      { conexionId: "B", salud: 60, criticidad: 40, gradoDependencia: "BAJA", riesgo: 20 },
    ];
    const r = calcularEslabonesMasDebiles(conexiones);
    expect(r.conjuntoNoDominado.map((c) => c.conexionId)).toEqual(["A"]);
    expect(r.esAmbiguo).toBe(false);
  });

  it("caso ambiguo (cruce): ninguna domina -> se muestran ambas, nunca una sola", () => {
    const conexiones: ValoresConexion[] = [
      { conexionId: "A", salud: 20, criticidad: 40, gradoDependencia: "ALTA", riesgo: 50 },
      { conexionId: "B", salud: 60, criticidad: 90, gradoDependencia: "BAJA", riesgo: 20 },
    ];
    const r = calcularEslabonesMasDebiles(conexiones);
    expect(r.conjuntoNoDominado).toHaveLength(2);
    expect(r.esAmbiguo).toBe(true);
    // orden de lectura: criticidad descendente primero
    expect(r.conjuntoNoDominado[0]?.conexionId).toBe("B");
  });

  it("empate total en salud y criticidad: ambas quedan, desempate por riesgo descendente", () => {
    const conexiones: ValoresConexion[] = [
      { conexionId: "X", salud: 50, criticidad: 50, gradoDependencia: "ALTA", riesgo: 30 },
      { conexionId: "Y", salud: 50, criticidad: 50, gradoDependencia: "ALTA", riesgo: 70 },
    ];
    const r = calcularEslabonesMasDebiles(conexiones);
    expect(r.conjuntoNoDominado).toHaveLength(2);
    expect(r.conjuntoNoDominado[0]?.conexionId).toBe("Y");
  });

  it("empate total incluso en riesgo: desempata por dependencia descendente y luego id", () => {
    const conexiones: ValoresConexion[] = [
      { conexionId: "B", salud: 50, criticidad: 50, gradoDependencia: "MEDIA", riesgo: 30 },
      { conexionId: "A", salud: 50, criticidad: 50, gradoDependencia: "CRITICA", riesgo: 30 },
      { conexionId: "C", salud: 50, criticidad: 50, gradoDependencia: "CRITICA", riesgo: 30 },
    ];
    const r = calcularEslabonesMasDebiles(conexiones);
    // CRITICA antes que MEDIA; entre A y C (mismo todo), A antes que C por id
    expect(r.conjuntoNoDominado.map((c) => c.conexionId)).toEqual(["A", "C", "B"]);
  });

  it("el orden es estable sin importar el orden de entrada (determinismo del motor)", () => {
    const conexiones: ValoresConexion[] = [
      { conexionId: "A", salud: 20, criticidad: 40, gradoDependencia: "ALTA", riesgo: 50 },
      { conexionId: "B", salud: 60, criticidad: 90, gradoDependencia: "BAJA", riesgo: 20 },
    ];
    const r1 = calcularEslabonesMasDebiles(conexiones);
    const r2 = calcularEslabonesMasDebiles([...conexiones].reverse());
    expect(r1.conjuntoNoDominado.map((c) => c.conexionId)).toEqual(
      r2.conjuntoNoDominado.map((c) => c.conexionId),
    );
  });
});
