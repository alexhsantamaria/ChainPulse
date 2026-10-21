import { describe, expect, it } from "vitest";
import { ejecutarCambiosUltimoPulso } from "../cambiosUltimoPulso";

const CORTE = new Date("2026-10-01");

describe("ejecutarCambiosUltimoPulso", () => {
  it("I5-25: sin hallazgos en ningun lado del corte, responde sin datos", () => {
    const r = ejecutarCambiosUltimoPulso({ antesDelCorte: [], desdeElCorte: [], corte: CORTE });
    expect(r.ok).toBe(false);
  });

  it("identifica hallazgos nuevos y resueltos correctamente", () => {
    const r = ejecutarCambiosUltimoPulso({
      antesDelCorte: [{ id: "h1", dimension: "A", resultado: "DIFERENCIA", createdAt: new Date("2026-09-01") }],
      desdeElCorte: [{ id: "h2", dimension: "B", resultado: "DIFERENCIA", createdAt: new Date("2026-10-05") }],
      corte: CORTE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.numerador).toBe(1); // 1 nuevo
    expect(r.hecho).toContain("1 hallazgo(s) nuevo(s)");
    expect(r.hecho).toContain("1 resuelto(s)");
  });

  it("sin cambios (mismo id en ambos lados), 0 nuevos y 0 resueltos", () => {
    const r = ejecutarCambiosUltimoPulso({
      antesDelCorte: [{ id: "h1", dimension: "A", resultado: "DIFERENCIA", createdAt: new Date("2026-09-01") }],
      desdeElCorte: [{ id: "h1", dimension: "A", resultado: "DIFERENCIA", createdAt: new Date("2026-09-01") }],
      corte: CORTE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deberia ser ok");
    expect(r.numerador).toBe(0);
  });
});
