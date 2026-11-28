// Pruebas (unitarias, sin DB) -- previsualizarObservacionLeadTime().
// Incremento 5 (Alex, 2026-11-27): Lead time, KPI #1 del pipeline de los
// seis pendientes. Mismo patron que otif/__tests__/declarar.test.ts
// (modulo puro, sin Prisma -- confirmarObservacionLeadTime() de
// persistir.ts se prueba por separado, con mocks de Prisma, mismo
// criterio que OTIF).
//
// Cubre las 8 pruebas obligatorias de la decision del 2026-11-27 sobre
// la advertencia heuristica de posible duplicado (reglas 1-8, ver el
// comentario de cabecera de declarar.ts):
//   1. carga sin duplicados -- ninguna fila marcada.
//   2. repeticion exacta de proceso+inicio+fin -- ambas filas marcadas.
//   3. mismo proceso con fechas distintas -- NO marcada.
//   4. la terna repetida permanece COMPLETA en el calculo (nunca se
//      deduplica, fusiona ni omite ninguna fila).
//   5. la advertencia es NO BLOQUEANTE (previsualizar sigue devolviendo
//      ok:true con el resultado completo).
//   6. modo manual -> numerador/denominador siempre null.
//   7. catalogo exhaustivo de los 10 KPIs -- ver
//      catalogoPipelineKpi.test.ts (no corresponde a este archivo, que es
//      puro dominio de Lead time).
//   8. los cinco KPIs todavia pendientes sin capacidades habilitadas --
//      ver catalogoPipelineKpi.test.ts y estadoVisualizacion.test.ts
//      (idem, no corresponde a este archivo).
import { describe, expect, it } from "vitest";
import {
  previsualizarObservacionLeadTime,
  MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME,
  type EntradaDeclaracionLeadTime,
} from "../declarar";

const CADENA_ID = "cadena-1";
const PERIODO_INICIO = "2026-01-01";
const PERIODO_FIN = "2026-01-31";

function entradaManual(valorPromedioDias: number): EntradaDeclaracionLeadTime {
  return {
    modo: "manual",
    cadenaId: CADENA_ID,
    periodoInicio: PERIODO_INICIO,
    periodoFin: PERIODO_FIN,
    valorPromedioDias,
  };
}

function entradaPegado(filas: unknown[]): EntradaDeclaracionLeadTime {
  return {
    modo: "pegado",
    cadenaId: CADENA_ID,
    periodoInicio: PERIODO_INICIO,
    periodoFin: PERIODO_FIN,
    filas,
  };
}

// Filas base reutilizadas entre pruebas de duplicados -- A y B son una
// repeticion EXACTA de proceso+inicio+fin (2 dias); C comparte proceso
// con A/B pero con fechas distintas (3 dias); D es un proceso distinto
// (2 dias).
const FILA_A = { proceso: "Recepcion de mercaderia", inicio: "2026-01-01", fin: "2026-01-03" };
const FILA_B = { proceso: "Recepcion de mercaderia", inicio: "2026-01-01", fin: "2026-01-03" };
const FILA_C = { proceso: "Recepcion de mercaderia", inicio: "2026-01-05", fin: "2026-01-08" };
const FILA_D = { proceso: "Picking y packing", inicio: "2026-01-02", fin: "2026-01-04" };

describe("previsualizarObservacionLeadTime -- modo manual", () => {
  it("valorPromedioDias valido -> numerador y denominador NULL (decision 2026-11-27, nunca un sintetico valor/1)", () => {
    const r = previsualizarObservacionLeadTime(entradaManual(4.5));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    expect(r.resultado.valor).toBe(4.5);
    expect(r.resultado.numerador).toBeNull();
    expect(r.resultado.denominador).toBeNull();
    expect(r.resultado.filasEvaluadas).toBe(1);
    expect(r.resultado.filasExcluidas).toBe(0);
    expect(r.resultado.cobertura).toBe(1);
    expect(r.resultado.advertencias).toEqual([]);
  });

  it("valorPromedioDias 0 -> valido (caso de borde: proceso instantaneo), numerador/denominador siguen NULL", () => {
    const r = previsualizarObservacionLeadTime(entradaManual(0));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    expect(r.resultado.valor).toBe(0);
    expect(r.resultado.numerador).toBeNull();
    expect(r.resultado.denominador).toBeNull();
  });

  it("valorPromedioDias negativo -> DATOS_INVALIDOS (un lead time no puede ser negativo)", () => {
    const r = previsualizarObservacionLeadTime(entradaManual(-1));
    expect(r).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("valorPromedioDias no finito (NaN) -> DATOS_INVALIDOS", () => {
    const r = previsualizarObservacionLeadTime(entradaManual(Number.NaN));
    expect(r).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("cadenaId vacio -> DATOS_INVALIDOS", () => {
    const r = previsualizarObservacionLeadTime({ ...entradaManual(1), cadenaId: "" });
    expect(r).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("periodo invertido (fin anterior a inicio) -> DATOS_INVALIDOS", () => {
    const r = previsualizarObservacionLeadTime({
      ...entradaManual(1),
      periodoInicio: "2026-02-01",
      periodoFin: "2026-01-01",
    });
    expect(r).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});

describe("previsualizarObservacionLeadTime -- modo pegado, SIN duplicados (prueba obligatoria 1/8)", () => {
  it("carga con ternas proceso+inicio+fin todas distintas -> ninguna fila recibe advertencia", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_A, FILA_C, FILA_D]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    expect(r.filasInterpretadas).toHaveLength(3);
    for (const fila of r.filasInterpretadas ?? []) {
      expect(fila.advertencia).toBeUndefined();
    }
    // 3 filas, todas con fin >= inicio -> las 3 evaluables.
    expect(r.resultado.filasEvaluadas).toBe(3);
    expect(r.resultado.filasExcluidas).toBe(0);
  });
});

describe("previsualizarObservacionLeadTime -- advertencia heuristica de posible duplicado (decision 2026-11-27)", () => {
  it("repeticion EXACTA de proceso+inicio+fin dentro de la misma carga -> AMBAS filas marcadas (prueba obligatoria 2/8)", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_A, FILA_B]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    expect(r.filasInterpretadas).toHaveLength(2);
    for (const fila of r.filasInterpretadas ?? []) {
      expect(fila.advertencia).toBe(MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME);
    }
  });

  it("mismo proceso pero con inicio/fin DISTINTOS -> NINGUNA fila marcada (un proceso SI puede repetirse legitimamente varias veces) (prueba obligatoria 3/8)", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_A, FILA_C]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    for (const fila of r.filasInterpretadas ?? []) {
      expect(fila.advertencia).toBeUndefined();
    }
  });

  it("tres filas comparten la misma terna -> las TRES quedan marcadas, no solo las dos primeras", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_A, FILA_B, { ...FILA_A }]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    expect(r.filasInterpretadas).toHaveLength(3);
    for (const fila of r.filasInterpretadas ?? []) {
      expect(fila.advertencia).toBe(MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME);
    }
  });

  it("la terna repetida permanece COMPLETA en el calculo: NUNCA se deduplica, fusiona ni omite ninguna fila (prueba obligatoria 4/8)", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_A, FILA_B]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    // FILA_A y FILA_B valen 2 dias cada una (2026-01-03 - 2026-01-01) --
    // si se hubiera deduplicado, filasEvaluadas seria 1. Debe ser 2.
    expect(r.resultado.filasEvaluadas).toBe(2);
    expect(r.resultado.filasExcluidas).toBe(0);
    expect(r.resultado.valor).toBe(2);
    expect(r.resultado.numerador).toBe(4); // suma 2+2, nunca colapsada a 2
    expect(r.resultado.denominador).toBe(2); // cuenta de filas, nunca 1
  });

  it("todas las filas validas permanecen presentes y en el MISMO ORDEN de entrada al aplicarse la advertencia -- cubre la guarda de seguridad de indices agregada 2026-11-28 (TS2345/TS2322, validacion Windows), que debe ser puramente de tipos y nunca alterar el orden, el conteo ni el contenido de ninguna fila", () => {
    // Orden deliberadamente intercalado: D (unica), A (duplicada con B),
    // C (unica, mismo proceso que A/B pero fechas distintas), B
    // (duplicada con A). Si la guarda de indices (el nuevo `continue`)
    // alterase el orden, saltase una fila o desalineara
    // clavesDuplicado/filasValidadas, esta prueba lo detectaria.
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_D, FILA_A, FILA_C, FILA_B]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");

    const filas = r.filasInterpretadas ?? [];
    expect(filas).toHaveLength(4);

    // Orden y contenido identicos a la entrada, indice a indice.
    expect(filas[0]).toMatchObject(FILA_D);
    expect(filas[1]).toMatchObject(FILA_A);
    expect(filas[2]).toMatchObject(FILA_C);
    expect(filas[3]).toMatchObject(FILA_B);

    // Advertencia solo en las filas realmente duplicadas (indices 1 y 3),
    // nunca en D ni en C.
    expect(filas[0]?.advertencia).toBeUndefined();
    expect(filas[1]?.advertencia).toBe(MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME);
    expect(filas[2]?.advertencia).toBeUndefined();
    expect(filas[3]?.advertencia).toBe(MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME);

    // Ninguna fila fue excluida, fusionada ni deduplicada del calculo.
    expect(r.resultado.filasEvaluadas).toBe(4);
    expect(r.resultado.filasExcluidas).toBe(0);
  });

  it("la advertencia es NO BLOQUEANTE: previsualizar sigue devolviendo ok:true con el resultado y las filas completas (prueba obligatoria 5/8)", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_A, FILA_B]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    expect(r.resultado.valor).not.toBeNull();
    expect(r.filasInterpretadas).toHaveLength(2); // ninguna fila excluida por la advertencia
  });

  it("NO detecta duplicados ENTRE cargas distintas -- cada llamada es pura e independiente (regla 7 de la decision 2026-11-27)", () => {
    // Dos llamadas separadas, cada una con UNA sola fila igual a FILA_A --
    // si hubiera estado compartido entre cargas, la segunda llamada
    // marcaria advertencia; no debe hacerlo nunca, en ninguna llamada.
    const r1 = previsualizarObservacionLeadTime(entradaPegado([FILA_A]));
    const r2 = previsualizarObservacionLeadTime(entradaPegado([{ ...FILA_A }]));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error("no deberia fallar");
    expect(r1.filasInterpretadas?.[0]?.advertencia).toBeUndefined();
    expect(r2.filasInterpretadas?.[0]?.advertencia).toBeUndefined();
  });
});

describe("previsualizarObservacionLeadTime -- validacion de forma y limites (cobertura adicional, no una de las 8 obligatorias)", () => {
  it("tabla vacia -> TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([]));
    expect(r).toEqual({ ok: false, error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" });
  });

  it("una fila con `proceso` que no es string -> rechaza la carga COMPLETA como DATOS_INVALIDOS", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([FILA_A, { ...FILA_C, proceso: 123 }]));
    expect(r).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("`fin: null` explicito es un dato de negocio valido (proceso aun no cerrado) -- no rechaza la carga, el motor excluye esa fila del promedio", () => {
    const r = previsualizarObservacionLeadTime(entradaPegado([{ ...FILA_A, fin: null }]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no deberia fallar");
    expect(r.resultado.filasExcluidas).toBe(1);
    expect(r.resultado.valor).toBeNull();
  });

  it("mas de MAX_FILAS_PEGADO_LEAD_TIME filas -> DEMASIADAS_FILAS", () => {
    const filas = Array.from({ length: 2_001 }, (_, i) => ({
      proceso: `Proceso ${i}`,
      inicio: "2026-01-01",
      fin: "2026-01-02",
    }));
    const r = previsualizarObservacionLeadTime(entradaPegado(filas));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deberia fallar");
    expect(r.error).toBe("DEMASIADAS_FILAS");
  });
});
