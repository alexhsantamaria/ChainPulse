import { describe, expect, it } from "vitest";
import { ejecutarDependenciaCritica } from "../dependenciaCritica";

describe("ejecutarDependenciaCritica", () => {
  it("I5-25: sin conexiones con impactoFalla, responde sin datos", () => {
    const r = ejecutarDependenciaCritica({
      conexiones: [{ id: "c1", origenNombre: "A", destinoNombre: "B", impactoFalla: null, tieneAlternativa: null, alternativaProbada: null }],
    });
    expect(r.ok).toBe(false);
  });

  it("elige el mayor impactoFalla sin alternativa probada", () => {
    const r = ejecutarDependenciaCritica({
      conexiones: [
        { id: "c1", origenNombre: "A", destinoNombre: "B", impactoFalla: "MEDIO", tieneAlternativa: true, alternativaProbada: true },
        { id: "c2", origenNombre: "C", destinoNombre: "D", impactoFalla: "CRITICO", tieneAlternativa: false, alternativaProbada: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("\"C\"");
    expect(r.interpretacion).toContain("ausencia de una alternativa probada");
  });

  it("entre iguales en impacto, prioriza la sin alternativa probada", () => {
    const r = ejecutarDependenciaCritica({
      conexiones: [
        { id: "c1", origenNombre: "ConAlt", destinoNombre: "X", impactoFalla: "ALTO", tieneAlternativa: true, alternativaProbada: true },
        { id: "c2", origenNombre: "SinAlt", destinoNombre: "Y", impactoFalla: "ALTO", tieneAlternativa: false, alternativaProbada: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.respuestaDirecta).toContain("SinAlt");
  });

  it("es determinista: mismo empate, mismo ganador por id (I5-26)", () => {
    const conexiones = [
      { id: "z1", origenNombre: "A", destinoNombre: "B", impactoFalla: "ALTO" as const, tieneAlternativa: false, alternativaProbada: null },
      { id: "a1", origenNombre: "C", destinoNombre: "D", impactoFalla: "ALTO" as const, tieneAlternativa: false, alternativaProbada: null },
    ];
    const r1 = ejecutarDependenciaCritica({ conexiones });
    const r2 = ejecutarDependenciaCritica({ conexiones });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
