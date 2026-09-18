// Pruebas — reconstruccion del orden de prioridad (V2 §8.3) de
// HallazgoExpres ya persistidos, sin depender de una columna de orden.
import { describe, expect, it } from "vitest";
import type { DimensionDiagnosticoV2 } from "@/domain/types";
import { ordenarHallazgosPersistidos, type HallazgoPersistidoMinimo } from "../ordenarHallazgosPersistidos";

interface HallazgoFake extends HallazgoPersistidoMinimo {
  id: string;
}

function hallazgo(id: string, dimension: DimensionDiagnosticoV2, estadoCategoria: string): HallazgoFake {
  return {
    id,
    dimension,
    estadoCategoria,
    enunciado: `enunciado-${id}`,
    estadoEvidencia: "DECLARADO",
    coberturaConfianza: 1,
    evidenciaFaltante: null,
    siguienteVerificacion: null,
    ruleVersion: "v2-preliminary",
  };
}

describe("ordenarHallazgosPersistidos", () => {
  it("reordena por prioridad (misma regla que ordenarPorPrioridad) y conserva los objetos originales completos", () => {
    // Promesa = disponibilidad (indice 0) -> criticas: INTEGRACION, RESILIENCIA (ver prioridad.test.ts)
    const hallazgos = [
      hallazgo("h-evidencia", "EVIDENCIA", "incompleta"),
      hallazgo("h-integracion", "INTEGRACION", "inconsistente"),
      hallazgo("h-coordinacion", "COORDINACION", "oportuna"),
    ];
    const ordenado = ordenarHallazgosPersistidos(hallazgos, 0);
    expect(ordenado[0]?.id).toBe("h-integracion");
    // El objeto devuelto es el original (mismo id/enunciado), no una reconstruccion parcial.
    expect(ordenado[0]).toBe(hallazgos[1]);
  });

  it("respeta el orden de severidad generica cuando ninguna dimension dispara la regla 1", () => {
    const hallazgos = [
      hallazgo("h-alineacion", "ALINEACION", "aplicada parcialmente"),
      hallazgo("h-coordinacion", "COORDINACION", "decision tardia"),
      hallazgo("h-integracion", "INTEGRACION", "conciliacion manual"),
      hallazgo("h-evidencia", "EVIDENCIA", "incompleta"),
      hallazgo("h-resiliencia", "RESILIENCIA", "no probada"),
    ];
    const ordenado = ordenarHallazgosPersistidos(hallazgos, 2); // promesa = cumplimiento de fecha y cantidad
    expect(ordenado.map((h) => h.id)).toEqual([
      "h-resiliencia",
      "h-coordinacion",
      "h-integracion",
      "h-evidencia",
      "h-alineacion",
    ]);
  });

  it("funciona con q1IndiceOpcion null (Q1 sin respuesta todavia)", () => {
    const hallazgos = [hallazgo("h-a", "ALINEACION", "compartida"), hallazgo("h-c", "COORDINACION", "oportuna")];
    const ordenado = ordenarHallazgosPersistidos(hallazgos, null);
    expect(ordenado).toHaveLength(2);
    expect(new Set(ordenado.map((h) => h.id))).toEqual(new Set(["h-a", "h-c"]));
  });

  it("reconstruye missingEvidence dividiendo evidenciaFaltante por ' | ' solo para el calculo interno, sin mutar el hallazgo original", () => {
    const hallazgos = [
      hallazgo("h-1", "EVIDENCIA", "incompleta"),
      { ...hallazgo("h-2", "RESILIENCIA", "inexistente"), evidenciaFaltante: "falta A | falta B" },
    ];
    const ordenado = ordenarHallazgosPersistidos(hallazgos, 0);
    const h2 = ordenado.find((h) => h.id === "h-2");
    expect(h2?.evidenciaFaltante).toBe("falta A | falta B"); // se conserva el string original, sin dividir
  });
});
