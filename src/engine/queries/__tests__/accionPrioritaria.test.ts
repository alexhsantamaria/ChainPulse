import { describe, expect, it } from "vitest";
import { ejecutarAccionPrioritaria } from "../accionPrioritaria";

describe("ejecutarAccionPrioritaria", () => {
  it("I5-25: sin hallazgos, responde sin datos", () => {
    const r = ejecutarAccionPrioritaria({ hallazgos: [] });
    expect(r.ok).toBe(false);
  });

  it("DIFERENCIA es mas urgente que ACUERDO_PARCIAL", () => {
    const r = ejecutarAccionPrioritaria({
      hallazgos: [
        { id: "h1", dimension: "NODO_CRITICO", resultado: "ACUERDO_PARCIAL", createdAt: new Date("2026-10-01") },
        { id: "h2", dimension: "FUENTE_DATOS", resultado: "DIFERENCIA", createdAt: new Date("2026-09-01") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.hecho).toContain("id=h2");
  });

  it("entre iguales, el mas reciente gana", () => {
    const r = ejecutarAccionPrioritaria({
      hallazgos: [
        { id: "h1", dimension: "A", resultado: "DIFERENCIA", createdAt: new Date("2026-09-01") },
        { id: "h2", dimension: "B", resultado: "DIFERENCIA", createdAt: new Date("2026-10-01") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.hecho).toContain("id=h2");
  });

  it("es determinista byte a byte (I5-26)", () => {
    const hallazgos = [
      { id: "h1", dimension: "A", resultado: "DIFERENCIA" as const, createdAt: new Date("2026-09-01") },
    ];
    expect(JSON.stringify(ejecutarAccionPrioritaria({ hallazgos }))).toBe(JSON.stringify(ejecutarAccionPrioritaria({ hallazgos })));
  });
});
