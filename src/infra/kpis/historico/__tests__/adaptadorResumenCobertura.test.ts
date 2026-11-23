// Pruebas de caracterizacion -- demuestran que adaptarPuntoResumenCobertura()
// es un reshaping puro de PuntoResumenCobertura, reutilizando (nunca
// duplicando) tasaValidaDeResumen(), la misma formula canonica que ya
// usa generarAnalisisImportacionCobertura() en analisisDecision.ts.
import { describe, expect, it } from "vitest";
import { tasaValidaDeResumen, type ResumenFilasCobertura } from "../../estadoVisualizacion";
import type { EstadoVersionCobertura, PuntoResumenCobertura } from "../../analisisDecision";
import { adaptarPuntoResumenCobertura } from "../adaptadorResumenCobertura";

function resumen(valor: number, ceroReal: number, sinDatos: number, conErrores: number): ResumenFilasCobertura {
  return { valor, ceroReal, sinDatos, conErrores, total: valor + ceroReal + sinDatos + conErrores };
}

// Mismo criterio que puntoCobertura() en analisisDecision.test.ts: 0
// filas siempre es SIN_FILAS sin importar el ruleVersion pedido.
function puntoCobertura(r: ResumenFilasCobertura, ruleVersion: string | null = "v1"): PuntoResumenCobertura {
  const estadoVersion: EstadoVersionCobertura = r.total === 0 ? "SIN_FILAS" : ruleVersion === null ? "MEZCLADA" : "UNICA";
  return {
    importId: "imp-" + Math.random(),
    periodoReferencia: { inicio: new Date("2026-03-01"), fin: new Date("2026-03-31") },
    resumen: r,
    estadoVersion,
    ruleVersion: estadoVersion === "UNICA" ? ruleVersion : null,
  };
}

describe("adaptarPuntoResumenCobertura", () => {
  it("SIN_FILAS (total 0) -> estado SIN_DATOS, valor null", () => {
    const punto = puntoCobertura(resumen(0, 0, 0, 0));
    const adaptado = adaptarPuntoResumenCobertura(punto);
    expect(punto.estadoVersion).toBe("SIN_FILAS");
    expect(adaptado.estado).toBe("SIN_DATOS");
    expect(adaptado.valor).toBeNull();
  });

  it("MEZCLADA -> estado CON_ERRORES, valor null (ninguna tasa propia es confiable)", () => {
    const punto = puntoCobertura(resumen(5, 2, 1, 0), null);
    const adaptado = adaptarPuntoResumenCobertura(punto);
    expect(punto.estadoVersion).toBe("MEZCLADA");
    expect(adaptado.estado).toBe("CON_ERRORES");
    expect(adaptado.valor).toBeNull();
  });

  it("UNICA con filas -> estado VALOR, valor = tasaValidaDeResumen(resumen) exactamente (caracterizacion)", () => {
    const r = resumen(7, 3, 2, 1); // total 13, validas 10
    const punto = puntoCobertura(r, "v1");
    const adaptado = adaptarPuntoResumenCobertura(punto);
    expect(punto.estadoVersion).toBe("UNICA");
    expect(adaptado.estado).toBe("VALOR");
    expect(adaptado.valor).toBe(tasaValidaDeResumen(r));
    expect(adaptado.valor).toBeCloseTo(10 / 13);
  });

  // Corregido 2026-11-23 (segundo corte de PR-A, ronda de revision):
  // una tasa valida exactamente en 0 es un dato REAL medido (no una
  // ausencia) -- por el invariante de EstadoDatoNormalizado (CERO_REAL
  // = valor numerico real igual a 0, misma semantica que
  // ObservacionKpi.valor===0 via clasificarValorObservacionKpi()) se
  // clasifica CERO_REAL, nunca VALOR ni SIN_DATOS.
  it("UNICA con tasa valida 0% (ninguna fila valida) -> CERO_REAL, valor 0 (dato real medido, no una ausencia)", () => {
    const r = resumen(0, 0, 4, 1); // total 5, ninguna valida
    const punto = puntoCobertura(r, "v1");
    const adaptado = adaptarPuntoResumenCobertura(punto);
    expect(adaptado.estado).toBe("CERO_REAL");
    expect(adaptado.valor).toBe(0);
  });

  it("UNICA con tasa valida > 0% -> VALOR (nunca CERO_REAL cuando la tasa no es exactamente 0)", () => {
    const r = resumen(1, 0, 4, 0); // total 5, 1 valida -> tasa 0.2
    const punto = puntoCobertura(r, "v1");
    const adaptado = adaptarPuntoResumenCobertura(punto);
    expect(adaptado.estado).toBe("VALOR");
    expect(adaptado.valor).toBeCloseTo(0.2);
  });

  it("periodoInicio/periodoFin, id (importId), ruleVersion y fuente pasan correctamente", () => {
    const punto = puntoCobertura(resumen(5, 0, 0, 0), "v3");
    const adaptado = adaptarPuntoResumenCobertura(punto);
    expect(adaptado.id).toBe(punto.importId);
    expect(adaptado.periodoInicio).toBe(punto.periodoReferencia.inicio);
    expect(adaptado.periodoFin).toBe(punto.periodoReferencia.fin);
    expect(adaptado.ruleVersion).toBe("v3");
    expect(adaptado.fuente).toBe("COBERTURA");
  });

  it("periodoInicio/periodoFin nulos (dato real de ImportacionCsv) pasan como null, no se fabrica una fecha", () => {
    const punto: PuntoResumenCobertura = {
      importId: "imp-sin-periodo",
      periodoReferencia: { inicio: null, fin: null },
      resumen: resumen(3, 0, 0, 0),
      estadoVersion: "UNICA",
      ruleVersion: "v1",
    };
    const adaptado = adaptarPuntoResumenCobertura(punto);
    expect(adaptado.periodoInicio).toBeNull();
    expect(adaptado.periodoFin).toBeNull();
  });

  // Caso defensivo (ronda de revision, 2026-11-23): "UNICA" + total===0
  // es una combinacion que derivarEstadoVersionCobertura() (cobertura/
  // resumenCobertura.ts) nunca produce -- "UNICA" implica total > 0 por
  // construccion. Si de todos modos llega (un PuntoResumenCobertura
  // construido a mano, o un bug futuro en el origen), el adaptador debe
  // fallar de forma explicita y determinista, nunca devolver en
  // silencio `{ estado: "VALOR", valor: null }` (violaria el invariante
  // de EstadoDatoNormalizado sin que nadie se entere).
  it("UNICA con total 0 (combinacion que el origen declara imposible) -> lanza un error descriptivo, nunca produce VALOR con valor null", () => {
    const punto: PuntoResumenCobertura = {
      importId: "imp-unica-vacia-imposible",
      periodoReferencia: { inicio: new Date("2026-03-01"), fin: new Date("2026-03-31") },
      resumen: resumen(0, 0, 0, 0),
      estadoVersion: "UNICA",
      ruleVersion: "v1",
    };
    expect(() => adaptarPuntoResumenCobertura(punto)).toThrow(/UNICA.*total === 0/);
  });
});
