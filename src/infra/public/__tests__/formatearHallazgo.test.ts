// Pruebas — formateo del gate macro/detalle (RF12/RF13). "Macro" debe ser
// literalmente un subconjunto de "detalle", nunca datos distintos.
import { describe, expect, it } from "vitest";
import { formatearHallazgoDetalle, formatearHallazgoMacro } from "../formatearHallazgo";

const HALLAZGO = {
  dimension: "INTEGRACION" as const,
  estadoCategoria: "conciliacion manual",
  enunciado: "Compras, ventas y logistica concilian datos manualmente.",
  estadoEvidencia: "DECLARADO" as const,
  coberturaConfianza: 0.5,
  evidenciaFaltante: ["falta A", "falta B"],
  siguienteVerificacion: "Confirmar con el area de TI que fuente es la de referencia.",
};

describe("formatearHallazgoMacro", () => {
  it("expone solo dimension/status/statement", () => {
    expect(formatearHallazgoMacro(HALLAZGO)).toEqual({
      dimension: "INTEGRACION",
      status: "conciliacion manual",
      statement: "Compras, ventas y logistica concilian datos manualmente.",
    });
  });
});

describe("formatearHallazgoDetalle", () => {
  it("incluye todos los campos macro mas evidenceState/confidenceCoverage/missingEvidence/nextCheck", () => {
    const detalle = formatearHallazgoDetalle(HALLAZGO);
    expect(detalle).toMatchObject(formatearHallazgoMacro(HALLAZGO));
    expect(detalle.evidenceState).toBe("DECLARADO");
    expect(detalle.confidenceCoverage).toBe(0.5);
    expect(detalle.missingEvidence).toEqual(["falta A", "falta B"]);
    expect(detalle.nextCheck).toBe(HALLAZGO.siguienteVerificacion);
  });

  it("missingEvidence es un array vacio cuando evidenciaFaltante es un array vacio", () => {
    const detalle = formatearHallazgoDetalle({ ...HALLAZGO, evidenciaFaltante: [] });
    expect(detalle.missingEvidence).toEqual([]);
  });

  it("nextCheck es null cuando siguienteVerificacion es null", () => {
    const detalle = formatearHallazgoDetalle({ ...HALLAZGO, siguienteVerificacion: null });
    expect(detalle.nextCheck).toBeNull();
  });
});
