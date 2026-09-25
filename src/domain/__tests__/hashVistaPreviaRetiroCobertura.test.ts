import { describe, expect, it } from "vitest";
import { calcularHashVistaPreviaRetiro } from "../hashVistaPreviaRetiroCobertura";

const ALCANCE = { fechaCorteInicio: new Date("2026-09-01T12:00:00.000Z"), fechaCorteFin: new Date("2026-09-30T12:00:00.000Z"), ubicaciones: ["LIMA", "AREQUIPA"] };
const CANDIDATAS = [
  { id: "obs-1", sku: "A-001", ubicacion: "LIMA", fechaCorte: new Date("2026-09-10T12:00:00.000Z") },
  { id: "obs-2", sku: "A-002", ubicacion: "AREQUIPA", fechaCorte: new Date("2026-09-11T12:00:00.000Z") },
];

describe("calcularHashVistaPreviaRetiro", () => {
  it("es determinista: mismas candidatas + alcance -> mismo hash", () => {
    expect(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE)).toBe(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE));
  });

  it("no depende del orden de las candidatas ni de las ubicaciones del alcance", () => {
    const candidatasInvertidas = [...CANDIDATAS].reverse();
    const alcanceInvertido = { ...ALCANCE, ubicaciones: [...ALCANCE.ubicaciones].reverse() };
    expect(calcularHashVistaPreviaRetiro(candidatasInvertidas, alcanceInvertido)).toBe(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE));
  });

  it("cambia si una candidata desaparece (una fila menos a retirar)", () => {
    const menosUna = CANDIDATAS.slice(0, 1);
    expect(calcularHashVistaPreviaRetiro(menosUna, ALCANCE)).not.toBe(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE));
  });

  it("cambia si aparece una candidata nueva", () => {
    const masUna = [...CANDIDATAS, { id: "obs-3", sku: "A-003", ubicacion: "LIMA", fechaCorte: new Date("2026-09-12T12:00:00.000Z") }];
    expect(calcularHashVistaPreviaRetiro(masUna, ALCANCE)).not.toBe(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE));
  });

  it("cambia si el id de una candidata cambia aunque sku/ubicacion/fecha sigan iguales", () => {
    const otroId = [{ ...CANDIDATAS[0]!, id: "obs-distinto" }, CANDIDATAS[1]!];
    expect(calcularHashVistaPreviaRetiro(otroId, ALCANCE)).not.toBe(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE));
  });

  it("cambia si el alcance de fechas cambia, con las mismas candidatas", () => {
    const otroAlcance = { ...ALCANCE, fechaCorteFin: new Date("2026-10-15T12:00:00.000Z") };
    expect(calcularHashVistaPreviaRetiro(CANDIDATAS, otroAlcance)).not.toBe(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE));
  });

  it("cambia si las ubicaciones del alcance cambian, con las mismas candidatas", () => {
    const otroAlcance = { ...ALCANCE, ubicaciones: ["LIMA"] };
    expect(calcularHashVistaPreviaRetiro(CANDIDATAS, otroAlcance)).not.toBe(calcularHashVistaPreviaRetiro(CANDIDATAS, ALCANCE));
  });

  it("candidatas vacias produce un hash valido y estable (alcance sin nada que retirar)", () => {
    const hash = calcularHashVistaPreviaRetiro([], ALCANCE);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(calcularHashVistaPreviaRetiro([], ALCANCE));
  });
});
