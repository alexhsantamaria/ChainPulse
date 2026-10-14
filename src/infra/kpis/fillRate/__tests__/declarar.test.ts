// Pruebas (unitarias, sin DB) -- previsualizarObservacionFillRate(),
// Incremento 4 Bloque B (Alex, 2026-10-14). declarar.ts no importa Prisma
// (ver su comentario de cabecera), asi que estas pruebas corren con
// `npm run test` normal, sin DATABASE_URL. Estructura deliberadamente
// paralela a otif/__tests__/declarar.test.ts, SIN los bloques que no
// aplican a Fill Rate (no hay fecha por fila, por eso no hay
// FILAS_FUERA_DE_PERIODO ni pruebas de fecha-por-fila).
import { describe, expect, it } from "vitest";
import { previsualizarObservacionFillRate, type EntradaDeclaracionFillRate, type FilaFillRateEntrada } from "../declarar";
import { MAX_FILAS_PEGADO_FILL_RATE } from "@/domain/limitesDeclaracionFillRate";

const CADENA_ID = "cadena-1";

function entradaManual(overrides: Partial<Extract<EntradaDeclaracionFillRate, { modo: "manual" }>> = {}): EntradaDeclaracionFillRate {
  return {
    modo: "manual",
    cadenaId: CADENA_ID,
    periodoInicio: "2026-10-01",
    periodoFin: "2026-10-31",
    numerador: 90,
    denominador: 100,
    ...overrides,
  };
}

function filaPegado(overrides: Partial<FilaFillRateEntrada> = {}): FilaFillRateEntrada {
  return {
    sku: "SKU-001",
    pedido: "PED-001",
    solicitado: 10,
    servido: 10,
    ...overrides,
  };
}

function entradaPegado(filas: FilaFillRateEntrada[]): EntradaDeclaracionFillRate {
  return { modo: "pegado", cadenaId: CADENA_ID, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas };
}

describe("previsualizarObservacionFillRate -- periodo y cadenaId (ambos modos)", () => {
  it("rechaza sin cadenaId", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ cadenaId: "" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("rechaza fecha de periodo ilegible", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ periodoInicio: "no-es-una-fecha" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("rechaza periodoInicio posterior a periodoFin", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ periodoInicio: "2026-10-31", periodoFin: "2026-10-01" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("acepta periodoInicio === periodoFin (un solo dia)", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ periodoInicio: "2026-10-05", periodoFin: "2026-10-05" }));
    expect(resultado.ok).toBe(true);
  });

  it("rechaza periodoInicio/periodoFin con formato distinto de AAAA-MM-DD (hora, barras, espacios)", () => {
    expect(previsualizarObservacionFillRate(entradaManual({ periodoInicio: "2026-10-01T00:00:00Z" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaManual({ periodoInicio: "01/10/2026" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaManual({ periodoInicio: " 2026-10-01" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("rechaza una fecha de periodo que no existe en el calendario (2026-02-30) en vez de normalizarla en silencio a marzo", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ periodoInicio: "2026-02-30", periodoFin: "2026-03-05" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("acepta fechas calendario validas en anio bisiesto (2024-02-29)", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ periodoInicio: "2024-02-29", periodoFin: "2024-02-29" }));
    expect(resultado.ok).toBe(true);
  });
});

describe("previsualizarObservacionFillRate -- modo manual (nivel 1)", () => {
  it("denominador <= 0 es DATOS_INVALIDOS -- rechaza la peticion completa, no una advertencia", () => {
    expect(previsualizarObservacionFillRate(entradaManual({ denominador: 0 }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaManual({ denominador: -5 }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("numerador negativo es DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ numerador: -1 }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("caso valido delega en calcularRatio(): valor = numerador/denominador, ruleVersion del motor", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ numerador: 90, denominador: 100 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBeCloseTo(0.9);
    expect(resultado.resultado.numerador).toBe(90);
    expect(resultado.resultado.denominador).toBe(100);
    expect(resultado.resultado.filasEvaluadas).toBe(1);
    expect(resultado.resultado.filasExcluidas).toBe(0);
    expect(resultado.resultado.ruleVersion).toBe("kpis-v1");
    expect(resultado.filasInterpretadas).toBeUndefined();
  });

  it("numerador puede ser 0 (valido, no invalido)", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ numerador: 0, denominador: 50 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(0);
  });

  it("numerador > denominador es DATOS_INVALIDOS -- rechaza la peticion completa (mismo criterio que OTIF)", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ numerador: 101, denominador: 100 }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("numerador === denominador es valido: Fill Rate = 100% (caso limite de igualdad)", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ numerador: 100, denominador: 100 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(1);
  });

  it("limite cero: numerador=0 y denominador=1 es valido, Fill Rate = 0%", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ numerador: 0, denominador: 1 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(0);
  });

  it("limite cero: numerador=1 y denominador=0 es DATOS_INVALIDOS (falla por denominador, antes de llegar al chequeo numerador<=denominador)", () => {
    const resultado = previsualizarObservacionFillRate(entradaManual({ numerador: 1, denominador: 0 }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("manual: rechaza denominador=Infinity, numerador=Infinity, denominador/numerador=NaN y denominador=-Infinity", () => {
    expect(previsualizarObservacionFillRate(entradaManual({ denominador: Infinity }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaManual({ numerador: Infinity, denominador: 100 }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaManual({ denominador: NaN }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaManual({ numerador: NaN }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaManual({ denominador: -Infinity }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});

describe("previsualizarObservacionFillRate -- modo pegado (nivel 2)", () => {
  it("tabla vacia es TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([]));
    expect(resultado).toEqual({ ok: false, error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" });
  });

  it("sku ilegible (numerico) en una fila es DATOS_INVALIDOS -- error de formato, rechaza toda la peticion", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([{ ...filaPegado(), sku: 123 } as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("delega en calcularFillRate(): una fila incompleta (servido: null, pedido sin cerrar) se EXCLUYE, nunca hace fallar la peticion", () => {
    const filas = [filaPegado({ pedido: "PED-001" }), filaPegado({ pedido: "PED-002", servido: null })];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.filasEvaluadas).toBe(1);
    expect(resultado.resultado.filasExcluidas).toBe(1);
    expect(resultado.resultado.advertencias.length).toBeGreaterThan(0);
    expect(resultado.resultado.ruleVersion).toBe("kpis-v1");
  });

  it("solicitado=0 (forma valida) tambien se EXCLUYE en el motor (calcularRatio no divide por denominador <= 0)", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([filaPegado({ solicitado: 0, servido: 0 })]));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.filasEvaluadas).toBe(0);
    expect(resultado.resultado.filasExcluidas).toBe(1);
  });

  it("pedido completo y totalmente servido cuenta Fill Rate=1; servido parcial cuenta proporcionalmente, limitado a solicitado", () => {
    const filas = [
      filaPegado({ pedido: "A", solicitado: 10, servido: 10 }),
      filaPegado({ pedido: "B", solicitado: 10, servido: 5 }),
    ];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBeCloseTo(0.75);
    expect(resultado.resultado.filasEvaluadas).toBe(2);
  });

  it("servido > solicitado (sobre-servido) se limita a solicitado -- nunca aporta mas de 100% por fila", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([filaPegado({ solicitado: 10, servido: 15 })]));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(1);
  });

  it("devuelve una muestra de filas interpretadas (maximo 10)", () => {
    const filas = Array.from({ length: 15 }, (_, i) => filaPegado({ pedido: `PED-${i}` }));
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.filasInterpretadas).toHaveLength(10);
  });

  it("NUNCA persiste nada -- es una funcion pura, no toca Prisma (confirmado por no importarlo, ver cabecera del modulo)", () => {
    expect(previsualizarObservacionFillRate(entradaManual()).ok).toBe(true);
  });
});

describe("previsualizarObservacionFillRate -- numeros finitos (NaN/Infinity, solicitado/servido)", () => {
  it("pegado: rechaza solicitado=Infinity y solicitado=NaN en una fila", () => {
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ solicitado: Infinity })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ solicitado: NaN })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("pegado: rechaza servido=Infinity y servido=NaN en una fila (servido no-null debe ser finito)", () => {
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ servido: Infinity })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ servido: NaN })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("pegado: rechaza solicitado o servido negativos -- dato corrupto, nunca se deja pasar al motor para que lo excluya en silencio", () => {
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ solicitado: -1 })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ servido: -1 })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});

describe("previsualizarObservacionFillRate -- duplicados por identidad COMPUESTA pedido+sku tras saneamiento SOLO trim, sensible a mayusculas/minusculas (correccion 2026-10-14 sobre el criterio C1 de OTIF -- ver normalizarClaveFilaFillRate())", () => {
  it("dos filas con el mismo pedido Y el mismo sku, identicos, rechazan TODA la carga", () => {
    // sku por defecto de filaPegado() es "SKU-001" para ambas filas -- la
    // colision es por la clave COMPUESTA pedido+sku, no por pedido solo.
    const filas = [filaPegado({ pedido: "PED-1" }), filaPegado({ pedido: "PED-1" })];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado).toEqual({ ok: false, error: "PEDIDOS_DUPLICADOS", pedidos: ["PED-1"] });
  });

  it("detecta el duplicado (mismo pedido, mismo sku) DESPUES de trim (' PED-1 ' colisiona con 'PED-1')", () => {
    const filas = [filaPegado({ pedido: " PED-1 " }), filaPegado({ pedido: "PED-1" })];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.error).toBe("PEDIDOS_DUPLICADOS");
    if (resultado.error !== "PEDIDOS_DUPLICADOS") throw new Error("no deberia pasar");
    expect(resultado.pedidos).toEqual(["PED-1"]);
  });

  it("'ped-1' y 'PED-1' son pedidos DISTINTOS -- sensible a mayusculas/minusculas (misma clave de sku)", () => {
    const filas = [filaPegado({ pedido: "ped-1" }), filaPegado({ pedido: "PED-1" })];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
  });

  it("mismo pedido con SKU DISTINTO -> ambas filas aceptadas (un pedido puede tener varias lineas de SKU; no hay regla de dominio que garantice un unico SKU por pedido -- ver MVP-DEFINITIVO.md y seedDefinicionesKpi.ts)", () => {
    const filas = [filaPegado({ pedido: "PED-1", sku: "SKU-1" }), filaPegado({ pedido: "PED-1", sku: "SKU-2" })];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.filasEvaluadas).toBe(2);
  });

  it("mismo pedido, mismo sku, pero con distinta capitalizacion de sku -> sensible a mayusculas/minusculas tambien en sku, por lo tanto NO son duplicados", () => {
    const filas = [filaPegado({ pedido: "PED-1", sku: "sku-1" }), filaPegado({ pedido: "PED-1", sku: "SKU-1" })];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
  });

  it("rechaza pedido vacio (tras trim), sku vacio, y pedido/sku demasiado largo (>100 caracteres)", () => {
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ pedido: "   " })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ sku: "   " })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ pedido: "X".repeat(101) })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionFillRate(entradaPegado([filaPegado({ sku: "X".repeat(101) })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});

describe("previsualizarObservacionFillRate -- limite explicito de filas (MAX_FILAS_PEGADO_FILL_RATE)", () => {
  it("acepta exactamente MAX_FILAS_PEGADO_FILL_RATE filas (validas y unicas)", () => {
    const filas = Array.from({ length: MAX_FILAS_PEGADO_FILL_RATE }, (_, i) => filaPegado({ pedido: `PED-${i}` }));
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
  });

  it("rechaza MAX_FILAS_PEGADO_FILL_RATE + 1 filas con DEMASIADAS_FILAS, identificando limite y cantidad recibida", () => {
    const filas = Array.from({ length: MAX_FILAS_PEGADO_FILL_RATE + 1 }, (_, i) => filaPegado({ pedido: `PED-${i}` }));
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado).toEqual({ ok: false, error: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_FILL_RATE, recibidas: MAX_FILAS_PEGADO_FILL_RATE + 1 });
  });
});

describe("previsualizarObservacionFillRate -- filas de red hostiles/mal formadas (unknown[])", () => {
  // entrada.filas llega de JSON.parse() sin ninguna garantia de forma --
  // construirFilaFillRate() valida cada elemento, campo por campo, antes
  // de leer ninguna propiedad. Estas pruebas confirman que CUALQUIERA de
  // estas variantes hostiles devuelve DATOS_INVALIDOS de forma
  // controlada -- nunca lanza una excepcion.

  it("fila null -- no revienta al leer sus propiedades, DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([null as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila numero (1) -- DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([1 as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila string (\"texto\") -- DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado(["texto" as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila array ([]) -- DATOS_INVALIDOS (un array no es el objeto simple que espera construirFilaFillRate)", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([[] as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila objeto vacio ({}) -- DATOS_INVALIDOS (sin sku ni pedido ni ningun otro campo)", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([{} as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila undefined -- DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([undefined as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("propiedades con tipos incorrectos: pedido numerico, solicitado string, servido string -- DATOS_INVALIDOS, nunca lanza", () => {
    expect(previsualizarObservacionFillRate(entradaPegado([{ ...filaPegado(), pedido: 123 } as unknown as FilaFillRateEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionFillRate(entradaPegado([{ ...filaPegado(), solicitado: "10" } as unknown as FilaFillRateEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionFillRate(entradaPegado([{ ...filaPegado(), servido: "10" } as unknown as FilaFillRateEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionFillRate(entradaPegado([{ ...filaPegado(), sku: null } as unknown as FilaFillRateEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
  });

  it("servido AUSENTE (propiedad faltante, no null explicito) -- DATOS_INVALIDOS, no se confunde con 'pedido sin cerrar'", () => {
    const filaSinServido = { sku: "SKU-1", pedido: "PED-1", solicitado: 10 };
    const resultado = previsualizarObservacionFillRate(entradaPegado([filaSinServido as unknown as FilaFillRateEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("servido null explicito SIGUE siendo valido (pedido sin cerrar) -- esto no cambio", () => {
    const resultado = previsualizarObservacionFillRate(entradaPegado([filaPegado({ servido: null })]));
    expect(resultado.ok).toBe(true);
  });

  it("una mezcla de filas validas y una hostil (null) en la misma carga -- rechaza TODA la carga, DATOS_INVALIDOS", () => {
    const filas = [filaPegado({ pedido: "P1" }), null as unknown as FilaFillRateEntrada, filaPegado({ pedido: "P2" })];
    const resultado = previsualizarObservacionFillRate(entradaPegado(filas));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});
