import { describe, expect, it } from "vitest";
import {
  compararValorConAnterior,
  generarAnalisisObservacionKpi,
  generarAnalisisImportacionCobertura,
  type PuntoObservacionKpi,
  type PuntoResumenCobertura,
  type EstadoVersionCobertura,
} from "../analisisDecision";
import type { ResumenFilasCobertura } from "../estadoVisualizacion";

function puntoObs(
  valor: number | null,
  numerador: number | null,
  denominador: number | null,
  ruleVersion = "v1",
): PuntoObservacionKpi {
  return {
    id: "obs-" + Math.random(),
    periodoInicio: new Date("2026-01-01"),
    periodoFin: new Date("2026-01-31"),
    valor,
    numerador,
    denominador,
    ruleVersion,
  };
}

function resumen(valor: number, ceroReal: number, sinDatos: number, conErrores: number): ResumenFilasCobertura {
  return { valor, ceroReal, sinDatos, conErrores, total: valor + ceroReal + sinDatos + conErrores };
}

// RONDA 4, punto 1: estadoVersion se deriva aca mismo que en la pagina
// real (0 filas siempre es SIN_FILAS, sin importar el `ruleVersion`
// que se pida -- un punto de 0 filas nunca declara una version propia)
// -- asi ningun fixture existente de rondas 1-3 necesita tocarse.
function puntoCobertura(r: ResumenFilasCobertura, ruleVersion: string | null = "v1"): PuntoResumenCobertura {
  const estadoVersion: EstadoVersionCobertura = r.total === 0 ? "SIN_FILAS" : ruleVersion === null ? "MEZCLADA" : "UNICA";
  return {
    importId: "imp-" + Math.random(),
    periodoReferencia: { inicio: null, fin: null },
    resumen: r,
    estadoVersion,
    ruleVersion: estadoVersion === "UNICA" ? ruleVersion : null,
  };
}

describe("compararValorConAnterior", () => {
  it("MEJORA cuando el valor sube y mas alto es mejor", () => {
    const r = compararValorConAnterior(0.8, 0.7, true);
    expect(r.direccion).toBe("MEJORA");
    expect(r.deltaAbsoluto).toBeCloseTo(0.1);
    expect(r.deltaPorcentual).toBeCloseTo(0.1 / 0.7);
  });

  it("EMPEORA cuando el valor baja y mas alto es mejor", () => {
    const r = compararValorConAnterior(0.65, 0.8, true);
    expect(r.direccion).toBe("EMPEORA");
    expect(r.deltaAbsoluto).toBeCloseTo(-0.15);
  });

  it("ESTABLE cuando la variacion esta dentro del epsilon", () => {
    const r = compararValorConAnterior(0.803, 0.8, true);
    expect(r.direccion).toBe("ESTABLE");
  });

  it("invierte el criterio cuando mas alto NO es mejor (ej. tasa de filas con errores)", () => {
    const sube = compararValorConAnterior(10, 5, false);
    expect(sube.direccion).toBe("EMPEORA");
    const baja = compararValorConAnterior(2, 5, false);
    expect(baja.direccion).toBe("MEJORA");
  });

  it("deltaPorcentual es null cuando el anterior es 0 -- nunca una division por cero disfrazada", () => {
    const r = compararValorConAnterior(5, 0, true);
    expect(r.deltaPorcentual).toBeNull();
    expect(r.direccion).toBe("MEJORA");
  });
});

describe("generarAnalisisObservacionKpi -- sin historico", () => {
  it("marca tendencia, comparacion y causas como informacion insuficiente, sin recomendacion", () => {
    const actual = puntoObs(0.65, 65, 100);
    const analisis = generarAnalisisObservacionKpi(actual, []);
    expect(analisis.tendenciaInformacionInsuficiente).toBe(true);
    expect(analisis.periodoAnterior).toBeNull();
    expect(analisis.variacion).toBeNull();
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.motivoInformacionInsuficiente).toBe("SIN_HISTORICO");
    expect(analisis.causasInformacionInsuficiente).toBe(true);
    expect(analisis.causasObservables).toEqual([]);
    expect(analisis.recomendacion).toBeNull();
    expect(analisis.siguienteAccionPropuesta).toBeNull();
  });
});

describe("generarAnalisisObservacionKpi -- periodo anterior sin datos (SIN_DATOS, valor null)", () => {
  it("la comparacion es insuficiente aunque haya historico", () => {
    const anteriorSinDatos = puntoObs(null, null, null);
    const actual = puntoObs(0.65, 65, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anteriorSinDatos]);
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.motivoInformacionInsuficiente).toBe("SIN_DATOS_PERIODO_ANTERIOR");
    expect(analisis.variacion).toBeNull();
    expect(analisis.recomendacion).toBeNull();
    expect(analisis.causasInformacionInsuficiente).toBe(true);
  });

  it("tendencia y comparacion son independientes -- la tendencia puede ser suficiente aunque el periodo INMEDIATO anterior no tenga dato", () => {
    const masAntiguoConDato = puntoObs(0.5, 50, 100);
    const inmediatoAnteriorSinDatos = puntoObs(null, null, null);
    const actual = puntoObs(0.65, 65, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [masAntiguoConDato, inmediatoAnteriorSinDatos]);
    // 2 puntos con valor (masAntiguoConDato + actual) -- tendencia SI alcanza, aunque la
    // comparacion contra el periodo INMEDIATO anterior (sin dato) sea insuficiente.
    expect(analisis.tendenciaInformacionInsuficiente).toBe(false);
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.motivoInformacionInsuficiente).toBe("SIN_DATOS_PERIODO_ANTERIOR");
    expect(analisis.periodoAnterior).toBe(inmediatoAnteriorSinDatos);
  });
});

describe("generarAnalisisObservacionKpi -- cero real (valor=0, NO es informacion insuficiente)", () => {
  it("un valor 0 real se compara igual que cualquier otro numero, nunca como SIN_DATOS", () => {
    const anterior = puntoObs(0.5, 50, 100);
    const actual = puntoObs(0, 0, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.comparacionInformacionInsuficiente).toBe(false);
    expect(analisis.variacion?.direccion).toBe("EMPEORA");
    expect(analisis.recomendacion?.prioridad).toBe("ALTA");
  });
});

describe("generarAnalisisObservacionKpi -- EMPEORA (umbral de magnitud: RONDA 2, delta ABSOLUTO, no relativo)", () => {
  it("delta absoluto de 15 puntos -> prioridad ALTA, con causas observables", () => {
    const anterior = puntoObs(0.8, 80, 100);
    const actual = puntoObs(0.65, 65, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.variacion?.direccion).toBe("EMPEORA");
    expect(analisis.variacion?.deltaAbsoluto).toBeCloseTo(-0.15);
    expect(analisis.recomendacion?.prioridad).toBe("ALTA");
    expect(analisis.causasInformacionInsuficiente).toBe(false);
    expect(analisis.causasObservables).toEqual(["El numerador pasó de 80 a 65 (-15)."]);
    expect(analisis.siguienteAccionPropuesta).not.toBeNull();
  });

  it("delta absoluto de 5 puntos (bajo el umbral de 10) -> prioridad MEDIA", () => {
    const anterior = puntoObs(0.8, 80, 100);
    const actual = puntoObs(0.75, 75, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.variacion?.direccion).toBe("EMPEORA");
    expect(analisis.variacion?.deltaAbsoluto).toBeCloseTo(-0.05);
    expect(analisis.recomendacion?.prioridad).toBe("MEDIA");
  });

  it("limite exacto: 9 puntos de delta absoluto -> todavia MEDIA (no cruza el umbral)", () => {
    const anterior = puntoObs(0.8, 80, 100);
    const actual = puntoObs(0.71, 71, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.variacion?.deltaAbsoluto).toBeCloseTo(-0.09);
    expect(analisis.recomendacion?.prioridad).toBe("MEDIA");
  });

  it("limite exacto: 10 puntos de delta absoluto -> ALTA (umbral inclusivo)", () => {
    const anterior = puntoObs(0.8, 80, 100);
    const actual = puntoObs(0.7, 70, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.variacion?.deltaAbsoluto).toBeCloseTo(-0.1);
    expect(analisis.recomendacion?.prioridad).toBe("ALTA");
  });

  it("un delta PORCENTUAL/relativo alto con delta ABSOLUTO bajo nunca produce ALTA (demuestra que ya no se usa el relativo)", () => {
    // anterior=0.02 -> actual=0.01: delta absoluto = -0.01 (1 punto, < umbral de 10),
    // pero delta relativo = -50% (muy por encima de cualquier umbral relativo previo).
    const anterior = puntoObs(0.02, 2, 100);
    const actual = puntoObs(0.01, 1, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.variacion?.deltaPorcentual).toBeCloseTo(-0.5);
    expect(analisis.variacion?.deltaAbsoluto).toBeCloseTo(-0.01);
    expect(analisis.recomendacion?.prioridad).toBe("MEDIA");
  });
});

describe("generarAnalisisObservacionKpi -- MEJORA y ESTABLE", () => {
  it("MEJORA -> prioridad BAJA, sin siguiente accion propuesta", () => {
    const anterior = puntoObs(0.7, 70, 100);
    const actual = puntoObs(0.8, 80, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.variacion?.direccion).toBe("MEJORA");
    expect(analisis.recomendacion?.prioridad).toBe("BAJA");
    expect(analisis.siguienteAccionPropuesta).toBeNull();
  });

  it("ESTABLE -> prioridad BAJA, causas senalan que no hubo cambio", () => {
    const anterior = puntoObs(0.5, 50, 100);
    const actual = puntoObs(0.5, 50, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.variacion?.direccion).toBe("ESTABLE");
    expect(analisis.recomendacion?.prioridad).toBe("BAJA");
    expect(analisis.causasObservables).toEqual(["El numerador y el denominador no cambiaron respecto al período anterior."]);
  });
});

describe("generarAnalisisObservacionKpi -- causas con datos parciales", () => {
  it("numerador/denominador faltantes en cualquiera de los 2 periodos -> causas insuficientes, pero la variacion SI se calcula", () => {
    const anterior = puntoObs(0.8, null, null);
    const actual = puntoObs(0.65, 65, 100);
    const analisis = generarAnalisisObservacionKpi(actual, [anterior]);
    expect(analisis.comparacionInformacionInsuficiente).toBe(false);
    expect(analisis.variacion?.direccion).toBe("EMPEORA");
    expect(analisis.causasInformacionInsuficiente).toBe(true);
    expect(analisis.causasObservables).toEqual([]);
  });
});

describe("generarAnalisisObservacionKpi -- ruleVersion (RONDA 2, punto 4)", () => {
  it("un punto historico de otra ruleVersion se excluye -- equivale a no tener historico comparable", () => {
    const anteriorOtraVersion = puntoObs(0.9, 90, 100, "v0-legacy");
    const actual = puntoObs(0.65, 65, 100, "v1");
    const analisis = generarAnalisisObservacionKpi(actual, [anteriorOtraVersion]);
    expect(analisis.tendenciaInformacionInsuficiente).toBe(true);
    expect(analisis.periodoAnterior).toBeNull();
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    // RONDA 3, punto 2: SI hubo historico (1 punto) -- la causa es que es
    // incompatible, NUNCA "SIN_HISTORICO" (que es solo cuando no hay
    // ningun punto, de ninguna version, ver la prueba de arriba).
    expect(analisis.motivoInformacionInsuficiente).toBe("RULE_VERSION_INCOMPATIBLE");
    expect(analisis.recomendacion).toBeNull();
  });

  it("RONDA 4, punto 4: NUNCA salta un historico incompatible para comparar contra uno mas antiguo que si calce -- el inmediato anterior decide, aunque exista uno compatible mas atras", () => {
    const masAntiguoComparable = puntoObs(0.5, 50, 100, "v1");
    const masRecienteIncompatible = puntoObs(0.9, 90, 100, "v2-nueva-regla");
    const actual = puntoObs(0.6, 60, 100, "v1");
    // Orden cronologico ascendente: masAntiguoComparable, masRecienteIncompatible
    // (el INMEDIATO anterior a `actual`) -- hasta la Ronda 3, esto se
    // saltaba el incompatible y comparaba contra masAntiguoComparable.
    // Desde la Ronda 4, el inmediato anterior decide SIEMPRE: aqui es
    // incompatible, asi que la comparacion es informacion insuficiente,
    // sin importar que exista un periodo mas antiguo que si calce.
    const analisis = generarAnalisisObservacionKpi(actual, [masAntiguoComparable, masRecienteIncompatible]);
    expect(analisis.periodoAnterior).toBeNull();
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.motivoInformacionInsuficiente).toBe("RULE_VERSION_INCOMPATIBLE");
    expect(analisis.variacion).toBeNull();
    expect(analisis.recomendacion).toBeNull();
  });

  it("RONDA 4, punto 4: con el inmediato anterior COMPATIBLE (misma ruleVersion), la comparacion SI procede -- caso normal, sin cambios", () => {
    const inmediatoCompatible = puntoObs(0.5, 50, 100, "v1");
    const actual = puntoObs(0.6, 60, 100, "v1");
    const analisis = generarAnalisisObservacionKpi(actual, [inmediatoCompatible]);
    expect(analisis.periodoAnterior).toBe(inmediatoCompatible);
    expect(analisis.comparacionInformacionInsuficiente).toBe(false);
    expect(analisis.motivoInformacionInsuficiente).toBeNull();
  });
});

describe("generarAnalisisObservacionKpi -- regla de periodo inmediato aplicada tambien a Fill Rate (RONDA 4, punto 4)", () => {
  it("Fill Rate usa la MISMA funcion que OTIF -- el inmediato anterior incompatible tambien bloquea la comparacion aqui, sin saltarlo", () => {
    // generarAnalisisObservacionKpi() es compartida por OTIF y Fill Rate
    // (ver DetalleObservacionKpi.tsx, llamado con codigo "FILL_RATE") --
    // esta prueba demuestra la MISMA correccion con datos de Fill Rate
    // (fuente/semantica distinta, misma funcion pura).
    const masAntiguoComparable = puntoObs(0.95, 95, 100, "v1");
    const masRecienteIncompatible = puntoObs(0.4, 40, 100, "v2-nueva-regla");
    const actual = puntoObs(0.86, 86, 100, "v1");
    const analisis = generarAnalisisObservacionKpi(actual, [masAntiguoComparable, masRecienteIncompatible]);
    expect(analisis.periodoAnterior).toBeNull();
    expect(analisis.motivoInformacionInsuficiente).toBe("RULE_VERSION_INCOMPATIBLE");
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
  });
});

describe("generarAnalisisImportacionCobertura -- sin historico", () => {
  it("marca todo como informacion insuficiente, conserva la nota metodologica", () => {
    const actual = puntoCobertura(resumen(10, 2, 1, 0));
    const analisis = generarAnalisisImportacionCobertura(actual, []);
    expect(analisis.tendenciaInformacionInsuficiente).toBe(true);
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.periodoAnterior).toBeNull();
    expect(analisis.tasaValidaActual).toBeCloseTo(12 / 13);
    expect(analisis.tasaConErroresActual).toBeCloseTo(0);
    expect(analisis.variacionTasaValidas).toBeNull();
    expect(analisis.variacionTasaConErrores).toBeNull();
    expect(analisis.variacionTasaSinDatos).toBeNull();
    expect(analisis.motivoInformacionInsuficiente).toBe("SIN_HISTORICO");
    expect(analisis.causasObservables).toEqual([]);
    expect(analisis.recomendacion).toBeNull();
    expect(analisis.siguienteAccionPropuesta).toBeNull();
    expect(analisis.notaMetodologica).toMatch(/no existe todavía una metodología acordada/i);
  });
});

describe("generarAnalisisImportacionCobertura -- total cero (RONDA 2, punto 2)", () => {
  it("importacion actual sin filas -> tasas e insuficiencia, nunca '0%' inventado", () => {
    const anterior = puntoCobertura(resumen(10, 0, 0, 0));
    const actual = puntoCobertura(resumen(0, 0, 0, 0));
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.tasaValidaActual).toBeNull();
    expect(analisis.tasaConErroresActual).toBeNull();
    expect(analisis.tasaSinDatosActual).toBeNull();
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.motivoInformacionInsuficiente).toBe("TOTAL_CERO");
    expect(analisis.variacionTasaValidas).toBeNull();
    expect(analisis.variacionTasaConErrores).toBeNull();
    expect(analisis.variacionTasaSinDatos).toBeNull();
    expect(analisis.recomendacion).toBeNull();
  });

  it("importacion anterior sin filas -> comparacion insuficiente aunque la actual si tenga filas", () => {
    const anterior = puntoCobertura(resumen(0, 0, 0, 0));
    const actual = puntoCobertura(resumen(10, 0, 0, 0));
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.tasaValidaActual).toBeCloseTo(1);
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.motivoInformacionInsuficiente).toBe("TOTAL_CERO");
    expect(analisis.variacionTasaConErrores).toBeNull();
    expect(analisis.variacionTasaSinDatos).toBeNull();
  });
});

describe("generarAnalisisImportacionCobertura -- tasas sobre volumenes distintos (RONDA 2, punto 2)", () => {
  it("1 error sobre 10 filas (10%) frente a 2 errores sobre 100 (2%) representa MEJORA, aunque el conteo absoluto haya subido", () => {
    const anterior = puntoCobertura(resumen(9, 0, 0, 1)); // total 10, tasa errores 10%
    const actual = puntoCobertura(resumen(98, 0, 0, 2)); // total 100, tasa errores 2%
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.tasaConErroresActual).toBeCloseTo(0.02);
    expect(analisis.variacionTasaConErrores?.direccion).toBe("MEJORA");
    expect(analisis.recomendacion?.prioridad).toBe("BAJA");
  });

  it("el conteo absoluto de errores subio (1 -> 2) pero eso NUNCA decide la direccion por si solo", () => {
    const anterior = puntoCobertura(resumen(9, 0, 0, 1));
    const actual = puntoCobertura(resumen(98, 0, 0, 2));
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    // El conteo (2 > 1) seguiria indicando "empeora" si se mirara solo; la tasa dice lo contrario.
    expect(actual.resumen.conErrores).toBeGreaterThan(anterior.resumen.conErrores);
    expect(analisis.variacionTasaConErrores?.direccion).toBe("MEJORA");
  });
});

describe("generarAnalisisImportacionCobertura -- tasa de sin-datos (RONDA 3, punto 1)", () => {
  it("1 sin dato sobre 10 filas (10%) frente a 10 sobre 100 (10%) -- misma tasa, NUNCA se presenta como deterioro aunque el conteo suba 10x", () => {
    const anterior = puntoCobertura(resumen(9, 0, 1, 0)); // total 10, tasa sin-datos 10%
    const actual = puntoCobertura(resumen(90, 0, 10, 0)); // total 100, tasa sin-datos 10% (conteo 1 -> 10)
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.tasaSinDatosActual).toBeCloseTo(0.1);
    expect(analisis.variacionTasaSinDatos?.direccion).toBe("ESTABLE");
    // Las 3 tasas (validas/errores/sin-datos) se mantienen iguales -- la
    // unica causa observable es el mensaje de "no hubo cambio", NUNCA una
    // frase de "las filas sin datos pasaron de 1 a 10" (eso seria tratar
    // el conteo crudo como si fuera la tasa).
    expect(analisis.causasObservables).toEqual(["Las tasas por categoría no cambiaron respecto a la importación anterior."]);
    expect(analisis.recomendacion?.prioridad).toBe("BAJA");
  });

  it("la tasa de sin-datos SI sube (no solo el conteo) -> aparece como causa observable, con tasa y conteo/denominador", () => {
    const anterior = puntoCobertura(resumen(90, 0, 10, 0)); // total 100, tasa sin-datos 10%
    const actual = puntoCobertura(resumen(70, 0, 30, 0)); // total 100, tasa sin-datos 30%
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.variacionTasaSinDatos?.direccion).toBe("EMPEORA");
    expect(analisis.causasObservables.some((c) => c.includes("sin datos") && c.includes("10/100") && c.includes("30/100"))).toBe(
      true,
    );
  });
});

describe("generarAnalisisImportacionCobertura -- umbrales de magnitud sobre la tasa (RONDA 2, punto 2)", () => {
  it("delta de tasa >=5 puntos porcentuales -> prioridad ALTA", () => {
    const anterior = puntoCobertura(resumen(90, 0, 0, 10)); // total 100, tasa 10%
    const actual = puntoCobertura(resumen(84, 0, 0, 16)); // total 100, tasa 16% (+6 puntos)
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.variacionTasaConErrores?.deltaAbsoluto).toBeCloseTo(0.06);
    expect(analisis.variacionTasaConErrores?.direccion).toBe("EMPEORA");
    expect(analisis.recomendacion?.prioridad).toBe("ALTA");
  });

  it("delta de tasa pequeno (ni 5 puntos absolutos ni 20% relativo) -> prioridad MEDIA", () => {
    const anterior = puntoCobertura(resumen(900, 0, 0, 100)); // total 1000, tasa 10%
    const actual = puntoCobertura(resumen(892, 0, 0, 108)); // total 1000, tasa 10.8% (+0.8 puntos, +8% relativo)
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.variacionTasaConErrores?.direccion).toBe("EMPEORA");
    expect(analisis.recomendacion?.prioridad).toBe("MEDIA");
  });
});

describe("generarAnalisisImportacionCobertura -- mejora y estabilidad", () => {
  it("tasa de errores baja -> MEJORA, prioridad BAJA", () => {
    const anterior = puntoCobertura(resumen(10, 2, 1, 5));
    const actual = puntoCobertura(resumen(10, 2, 1, 1));
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.variacionTasaConErrores?.direccion).toBe("MEJORA");
    expect(analisis.recomendacion?.prioridad).toBe("BAJA");
    expect(analisis.siguienteAccionPropuesta).toBeNull();
  });

  it("todos los conteos (y por lo tanto las tasas) iguales -> ESTABLE, causas senalan que no hubo cambio", () => {
    const anterior = puntoCobertura(resumen(10, 2, 1, 1));
    const actual = puntoCobertura(resumen(10, 2, 1, 1));
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.variacionTasaConErrores?.direccion).toBe("ESTABLE");
    expect(analisis.variacionTasaValidas?.direccion).toBe("ESTABLE");
    expect(analisis.causasObservables).toEqual(["Las tasas por categoría no cambiaron respecto a la importación anterior."]);
    expect(analisis.recomendacion?.prioridad).toBe("BAJA");
  });

  it("sin datos sube mientras la tasa de errores se mantiene estable -- igual aparece como causa observable, con conteos", () => {
    const anterior = puntoCobertura(resumen(10, 2, 1, 1)); // total 14
    const actual = puntoCobertura(resumen(9, 2, 2, 1)); // total 14, misma tasa de errores (1/14)
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.variacionTasaConErrores?.direccion).toBe("ESTABLE");
    expect(analisis.causasObservables.some((c) => c.includes("sin datos") && c.includes("1") && c.includes("2"))).toBe(true);
    expect(analisis.causasObservables.some((c) => c.includes("12/14") && c.includes("11/14"))).toBe(true);
  });
});

describe("generarAnalisisImportacionCobertura -- tendencia", () => {
  it("con al menos 2 puntos (1 previo + actual) la evolucion reciente es suficiente", () => {
    const anterior = puntoCobertura(resumen(10, 2, 1, 1));
    const actual = puntoCobertura(resumen(10, 2, 1, 1));
    const analisis = generarAnalisisImportacionCobertura(actual, [anterior]);
    expect(analisis.tendenciaInformacionInsuficiente).toBe(false);
    expect(analisis.tendencia).toHaveLength(2);
  });
});

describe("generarAnalisisImportacionCobertura -- ruleVersion (RONDA 2, punto 4)", () => {
  it("historico de otra ruleVersion se excluye -- equivale a no tener historico comparable", () => {
    const anteriorOtraVersion = puntoCobertura(resumen(10, 2, 1, 1), "v0-legacy");
    const actual = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const analisis = generarAnalisisImportacionCobertura(actual, [anteriorOtraVersion]);
    expect(analisis.tendenciaInformacionInsuficiente).toBe(true);
    expect(analisis.periodoAnterior).toBeNull();
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    // RONDA 3, punto 2: SI hubo historico (1 importacion) -- incompatible,
    // NUNCA "SIN_HISTORICO".
    expect(analisis.motivoInformacionInsuficiente).toBe("RULE_VERSION_INCOMPATIBLE");
    expect(analisis.recomendacion).toBeNull();
  });

  it("si la actual mezcla versiones (ruleVersion null) no hay ningun historico comparable, aunque el historico si tenga version unica", () => {
    const anteriorConVersion = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const actualMezclada = puntoCobertura(resumen(10, 2, 1, 1), null);
    const analisis = generarAnalisisImportacionCobertura(actualMezclada, [anteriorConVersion]);
    expect(analisis.tendencia).toEqual([actualMezclada]);
    expect(analisis.tendenciaInformacionInsuficiente).toBe(true);
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    // RONDA 3, punto 2: motivo distinto de "RULE_VERSION_INCOMPATIBLE" --
    // aca es la propia importacion actual la que mezcla versiones, no el
    // historico el incompatible (aunque el historico SI tenga una version
    // unica y util en otras circunstancias).
    expect(analisis.motivoInformacionInsuficiente).toBe("VERSION_MEZCLADA");
  });

  it("RONDA 4, punto 2/3: NUNCA salta una importacion incompatible para comparar contra una mas antigua que si calce -- la inmediata anterior decide", () => {
    const masAntiguoComparable = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const masRecienteIncompatible = puntoCobertura(resumen(10, 2, 1, 9), "v2-nueva-regla");
    const actual = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    // Orden cronologico ascendente: masAntiguoComparable, masRecienteIncompatible
    // (la INMEDIATA anterior a `actual`). Hasta la Ronda 3 esto se
    // saltaba la incompatible y comparaba contra masAntiguoComparable.
    const analisis = generarAnalisisImportacionCobertura(actual, [masAntiguoComparable, masRecienteIncompatible]);
    expect(analisis.periodoAnterior).toBeNull();
    expect(analisis.comparacionInformacionInsuficiente).toBe(true);
    expect(analisis.motivoInformacionInsuficiente).toBe("RULE_VERSION_INCOMPATIBLE");
    expect(analisis.variacionTasaConErrores).toBeNull();
  });

  it("RONDA 4, punto 3: la importacion ACTUAL sin filas es TOTAL_CERO, NUNCA VERSION_MEZCLADA -- antes la sobrecarga de ruleVersion=null confundia ambos casos", () => {
    const anteriorConFilas = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const actualSinFilas = puntoCobertura(resumen(0, 0, 0, 0));
    const analisis = generarAnalisisImportacionCobertura(actualSinFilas, [anteriorConFilas]);
    expect(analisis.motivoInformacionInsuficiente).toBe("TOTAL_CERO");
    expect(analisis.periodoAnterior).toBeNull();
  });

  it("RONDA 4, punto 3: el periodo INMEDIATO anterior sin filas es TOTAL_CERO, aunque uno mas antiguo si tenga filas y version compatible", () => {
    const masAntiguoConFilas = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const inmediatoSinFilas = puntoCobertura(resumen(0, 0, 0, 0));
    const actual = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const analisis = generarAnalisisImportacionCobertura(actual, [masAntiguoConFilas, inmediatoSinFilas]);
    expect(analisis.motivoInformacionInsuficiente).toBe("TOTAL_CERO");
    expect(analisis.periodoAnterior).toBeNull();
  });

  it("RONDA 4, punto 3: el periodo INMEDIATO anterior mezclado es VERSION_MEZCLADA, aunque uno mas antiguo si sea comparable", () => {
    const masAntiguoComparable = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const inmediatoMezclado = puntoCobertura(resumen(10, 2, 1, 1), null);
    const actual = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const analisis = generarAnalisisImportacionCobertura(actual, [masAntiguoComparable, inmediatoMezclado]);
    expect(analisis.motivoInformacionInsuficiente).toBe("VERSION_MEZCLADA");
    expect(analisis.periodoAnterior).toBeNull();
  });

  it("con el inmediato anterior COMPATIBLE (misma ruleVersion, con filas), la comparacion SI procede -- caso normal, sin cambios", () => {
    const inmediatoCompatible = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const actual = puntoCobertura(resumen(10, 2, 1, 1), "v1");
    const analisis = generarAnalisisImportacionCobertura(actual, [inmediatoCompatible]);
    expect(analisis.periodoAnterior).toBe(inmediatoCompatible);
    expect(analisis.comparacionInformacionInsuficiente).toBe(false);
    expect(analisis.motivoInformacionInsuficiente).toBeNull();
    expect(analisis.variacionTasaConErrores?.direccion).toBe("ESTABLE");
  });
});
