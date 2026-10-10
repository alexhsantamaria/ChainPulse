// Pruebas (unitarias, sin DB) -- previsualizarObservacionOtif(), piloto
// OTIF (Incremento 4 Bloque B). declarar.ts no importa Prisma (ver su
// comentario de cabecera), asi que estas pruebas corren con
// `npm run test` normal, sin DATABASE_URL.
import { describe, expect, it } from "vitest";
import { previsualizarObservacionOtif, type EntradaDeclaracionOtif, type FilaOtifEntrada } from "../declarar";
import { MAX_FILAS_PEGADO_OTIF } from "@/domain/limitesDeclaracionOtif";

const CADENA_ID = "cadena-1";

function entradaManual(overrides: Partial<Extract<EntradaDeclaracionOtif, { modo: "manual" }>> = {}): EntradaDeclaracionOtif {
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

function filaPegado(overrides: Partial<FilaOtifEntrada> = {}): FilaOtifEntrada {
  return {
    pedido: "PED-001",
    fechaPrometida: "2026-10-05",
    fechaReal: "2026-10-05",
    cantidadPedida: 10,
    cantidadEntregada: 10,
    ...overrides,
  };
}

function entradaPegado(filas: FilaOtifEntrada[]): EntradaDeclaracionOtif {
  return { modo: "pegado", cadenaId: CADENA_ID, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", filas };
}

describe("previsualizarObservacionOtif -- periodo y cadenaId (ambos modos)", () => {
  it("rechaza sin cadenaId", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ cadenaId: "" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("rechaza fecha de periodo ilegible", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ periodoInicio: "no-es-una-fecha" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("rechaza periodoInicio posterior a periodoFin", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ periodoInicio: "2026-10-31", periodoFin: "2026-10-01" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("acepta periodoInicio === periodoFin (un solo dia)", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ periodoInicio: "2026-10-05", periodoFin: "2026-10-05" }));
    expect(resultado.ok).toBe(true);
  });
});

describe("previsualizarObservacionOtif -- modo manual (nivel 1)", () => {
  it("denominador <= 0 es DATOS_INVALIDOS -- rechaza la peticion completa, no una advertencia", () => {
    expect(previsualizarObservacionOtif(entradaManual({ denominador: 0 }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaManual({ denominador: -5 }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("numerador negativo es DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: -1 }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("caso valido delega en calcularRatio(): valor = numerador/denominador, ruleVersion del motor", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: 90, denominador: 100 }));
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
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: 0, denominador: 50 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(0);
  });

  it("numerador > denominador es DATOS_INVALIDOS -- rechaza la peticion completa (Alex 2026-10-10)", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: 101, denominador: 100 }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("numerador === denominador es valido: OTIF = 100% (caso limite de igualdad)", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: 100, denominador: 100 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(1);
    expect(resultado.resultado.numerador).toBe(100);
    expect(resultado.resultado.denominador).toBe(100);
  });

  it("limite cero: numerador=0 y denominador=1 (el denominador positivo mas chico) es valido, OTIF = 0%", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: 0, denominador: 1 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(0);
  });

  it("limite cero: numerador=denominador=1 es valido, OTIF = 100% (igualdad en el borde minimo)", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: 1, denominador: 1 }));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBe(1);
  });

  it("limite cero: numerador=1 y denominador=0 es DATOS_INVALIDOS (falla por denominador, antes de llegar al chequeo numerador<=denominador)", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: 1, denominador: 0 }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});

describe("previsualizarObservacionOtif -- modo pegado (nivel 2)", () => {
  it("tabla vacia es TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([]));
    expect(resultado).toEqual({ ok: false, error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" });
  });

  it("fecha prometida ilegible en una fila es DATOS_INVALIDOS -- error de formato, rechaza toda la peticion", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([filaPegado({ fechaPrometida: "no-es-fecha" })]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("delega en calcularOtif(): una fila incompleta (sin fechaReal) se EXCLUYE, nunca hace fallar la peticion", () => {
    const filas = [filaPegado({ pedido: "PED-001" }), filaPegado({ pedido: "PED-002", fechaReal: null, cantidadEntregada: null })];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.filasEvaluadas).toBe(1);
    expect(resultado.resultado.filasExcluidas).toBe(1);
    expect(resultado.resultado.advertencias.length).toBeGreaterThan(0);
    expect(resultado.resultado.ruleVersion).toBe("kpis-v1");
  });

  it("pedido completo y a tiempo cuenta OTIF=1; incompleto o tarde cuenta OTIF=0", () => {
    const filas = [
      filaPegado({ pedido: "A", cantidadPedida: 10, cantidadEntregada: 10, fechaPrometida: "2026-10-05", fechaReal: "2026-10-05" }),
      filaPegado({ pedido: "B", cantidadPedida: 10, cantidadEntregada: 8, fechaPrometida: "2026-10-05", fechaReal: "2026-10-05" }),
    ];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBeCloseTo(0.5);
    expect(resultado.resultado.filasEvaluadas).toBe(2);
  });

  it("devuelve una muestra de filas interpretadas (maximo 10)", () => {
    const filas = Array.from({ length: 15 }, (_, i) => filaPegado({ pedido: `PED-${i}` }));
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.filasInterpretadas).toHaveLength(10);
  });

  it("NUNCA persiste nada -- es una funcion pura, no toca Prisma (confirmado por no importarlo, ver cabecera del modulo)", () => {
    // Si este archivo importara Prisma/tenantClient, este mismo test ya
    // habria fallado al cargar el modulo (ver probe de la Ronda de
    // implementacion -- "PrismaClient did not initialize yet"). Que
    // llegue a correr es en si mismo la prueba de pureza.
    expect(previsualizarObservacionOtif(entradaManual()).ok).toBe(true);
  });
});


describe("previsualizarObservacionOtif -- fechas calendario estrictas (AAAA-MM-DD, Alex 2026-10-10)", () => {
  it("rechaza periodoInicio/periodoFin con formato distinto de AAAA-MM-DD (hora, barras, espacios)", () => {
    expect(previsualizarObservacionOtif(entradaManual({ periodoInicio: "2026-10-01T00:00:00Z" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaManual({ periodoInicio: "01/10/2026" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaManual({ periodoInicio: " 2026-10-01" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("rechaza una fecha de periodo que no existe en el calendario (2026-02-30) en vez de normalizarla en silencio a marzo", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ periodoInicio: "2026-02-30", periodoFin: "2026-03-05" }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("rechaza 2026-04-31 (abril tiene 30 dias) y 2026-13-01 (mes invalido)", () => {
    expect(previsualizarObservacionOtif(entradaManual({ periodoInicio: "2026-04-01", periodoFin: "2026-04-31" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaManual({ periodoInicio: "2026-13-01", periodoFin: "2026-13-02" }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("modo pegado: rechaza fechaPrometida/fechaReal con el mismo criterio estricto (fecha inexistente)", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([filaPegado({ fechaPrometida: "2026-02-30" })]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("modo pegado: rechaza fechaReal con formato distinto de AAAA-MM-DD", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([filaPegado({ fechaReal: "05/10/2026" })]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("acepta fechas calendario validas en anio bisiesto (2024-02-29) -- no rechaza de mas", () => {
    const resultado = previsualizarObservacionOtif(
      entradaManual({ periodoInicio: "2024-02-29", periodoFin: "2024-02-29" }),
    );
    expect(resultado.ok).toBe(true);
  });
});

describe("previsualizarObservacionOtif -- numeros finitos (NaN/Infinity, Alex 2026-10-10)", () => {
  it("manual: rechaza denominador=Infinity (antes pasaba porque Infinity > 0 es true)", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ denominador: Infinity }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("manual: rechaza numerador=Infinity (antes pasaba porque Infinity < 0 es false y no es NaN)", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ numerador: Infinity, denominador: 100 }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("manual: rechaza denominador=NaN y numerador=NaN", () => {
    expect(previsualizarObservacionOtif(entradaManual({ denominador: NaN }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaManual({ numerador: NaN }))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("manual: rechaza denominador=-Infinity", () => {
    const resultado = previsualizarObservacionOtif(entradaManual({ denominador: -Infinity }));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("pegado: rechaza cantidadPedida=Infinity y cantidadPedida=NaN en una fila", () => {
    expect(previsualizarObservacionOtif(entradaPegado([filaPegado({ cantidadPedida: Infinity })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaPegado([filaPegado({ cantidadPedida: NaN })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("pegado: rechaza cantidadEntregada=Infinity en una fila", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([filaPegado({ cantidadEntregada: Infinity })]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("pegado: rechaza cantidadPedida o cantidadEntregada negativas -- dominio de negocio, no solo formato", () => {
    expect(previsualizarObservacionOtif(entradaPegado([filaPegado({ cantidadPedida: -1 })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaPegado([filaPegado({ cantidadEntregada: -1 })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("pegado: cantidadEntregada > cantidadPedida (sobre-entrega) sigue siendo valida -- no es un limite de dominio nuevo", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([filaPegado({ cantidadPedida: 10, cantidadEntregada: 12 })]));
    expect(resultado.ok).toBe(true);
  });
});

describe("previsualizarObservacionOtif -- pertenencia al periodo, limites INCLUSIVOS por fechaPrometida (decision A1/B2, Alex 2026-10-10)", () => {
  it("fechaPrometida exactamente igual a periodoInicio es valida (limite inclusivo)", () => {
    const resultado = previsualizarObservacionOtif(
      entradaPegado([filaPegado({ pedido: "P1", fechaPrometida: "2026-10-01" })]),
    );
    expect(resultado.ok).toBe(true);
  });

  it("fechaPrometida exactamente igual a periodoFin es valida (limite inclusivo)", () => {
    const resultado = previsualizarObservacionOtif(
      entradaPegado([filaPegado({ pedido: "P1", fechaPrometida: "2026-10-31" })]),
    );
    expect(resultado.ok).toBe(true);
  });

  it("fechaPrometida un dia ANTES de periodoInicio rechaza TODA la carga (nunca excluye silenciosamente ni calcula parcial)", () => {
    const resultado = previsualizarObservacionOtif(
      entradaPegado([filaPegado({ pedido: "P1", fechaPrometida: "2026-09-30" })]),
    );
    expect(resultado).toEqual({ ok: false, error: "FILAS_FUERA_DE_PERIODO", pedidos: ["P1"] });
  });

  it("fechaPrometida un dia DESPUES de periodoFin rechaza TODA la carga", () => {
    const resultado = previsualizarObservacionOtif(
      entradaPegado([filaPegado({ pedido: "P1", fechaPrometida: "2026-11-01" })]),
    );
    expect(resultado).toEqual({ ok: false, error: "FILAS_FUERA_DE_PERIODO", pedidos: ["P1"] });
  });

  it("carga mixta (una fila dentro, una fuera) rechaza TODA la carga -- identifica solo el pedido afectado, no datos sensibles", () => {
    const filas = [
      filaPegado({ pedido: "DENTRO", fechaPrometida: "2026-10-15" }),
      filaPegado({ pedido: "FUERA", fechaPrometida: "2026-11-15" }),
    ];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado).toEqual({ ok: false, error: "FILAS_FUERA_DE_PERIODO", pedidos: ["FUERA"] });
  });
});

describe("previsualizarObservacionOtif -- pedidos duplicados tras saneamiento SOLO trim, sensible a mayusculas/minusculas (decision C1, Alex 2026-10-10)", () => {
  it("dos filas con el mismo pedido, identico, rechazan TODA la carga", () => {
    const filas = [filaPegado({ pedido: "PED-1" }), filaPegado({ pedido: "PED-1" })];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado).toEqual({ ok: false, error: "PEDIDOS_DUPLICADOS", pedidos: ["PED-1"] });
  });

  it("detecta el duplicado DESPUES de trim (' PED-1 ' colisiona con 'PED-1', solo difieren en espacios) -- nunca se consolidan ni se queda con la primera/ultima en silencio", () => {
    const filas = [filaPegado({ pedido: " PED-1 " }), filaPegado({ pedido: "PED-1" })];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.error).toBe("PEDIDOS_DUPLICADOS");
    if (resultado.error !== "PEDIDOS_DUPLICADOS") throw new Error("no deberia pasar");
    // Reporta los pedidos ya recortados (sin ninguna otra transformacion) que colisionaron.
    expect(resultado.pedidos).toEqual(["PED-1"]);
  });

  it("'ped-1' y 'PED-1' son pedidos DISTINTOS -- la decision C1 es sensible a mayusculas/minusculas, no se reutiliza la regla de SKU/ubicacion de Cobertura", () => {
    const filas = [filaPegado({ pedido: "ped-1", fechaPrometida: "2026-10-05" }), filaPegado({ pedido: "PED-1", fechaPrometida: "2026-10-06" })];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
  });

  it("pedidos distintos que NO colisionan tras saneamiento (ceros iniciales/guiones se preservan) no se rechazan", () => {
    const filas = [filaPegado({ pedido: "PED-001" }), filaPegado({ pedido: "PED-01" })];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
  });

  it("rechaza pedido vacio (tras trim) y pedido demasiado largo (>100 caracteres)", () => {
    expect(previsualizarObservacionOtif(entradaPegado([filaPegado({ pedido: "   " })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
    expect(previsualizarObservacionOtif(entradaPegado([filaPegado({ pedido: "X".repeat(101) })]))).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});

describe("previsualizarObservacionOtif -- limite explicito de filas (MAX_FILAS_PEGADO_OTIF, Alex 2026-10-10)", () => {
  it("acepta exactamente MAX_FILAS_PEGADO_OTIF filas (validas y unicas)", () => {
    const filas = Array.from({ length: MAX_FILAS_PEGADO_OTIF }, (_, i) => filaPegado({ pedido: `PED-${i}` }));
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado.ok).toBe(true);
  });

  it("rechaza MAX_FILAS_PEGADO_OTIF + 1 filas con DEMASIADAS_FILAS, identificando limite y cantidad recibida", () => {
    const filas = Array.from({ length: MAX_FILAS_PEGADO_OTIF + 1 }, (_, i) => filaPegado({ pedido: `PED-${i}` }));
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado).toEqual({ ok: false, error: "DEMASIADAS_FILAS", limite: MAX_FILAS_PEGADO_OTIF, recibidas: MAX_FILAS_PEGADO_OTIF + 1 });
  });
});

describe("previsualizarObservacionOtif -- filas de red hostiles/mal formadas (unknown[], Alex 2026-10-10 segunda revision)", () => {
  // entrada.filas llega de JSON.parse() sin ninguna garantia de forma --
  // antes, la ruta hacia `filas: p.filas as any` y construirFilaOtif()
  // asumia ciegamente que cada elemento era un FilaOtifEntrada. Estas
  // pruebas confirman que CUALQUIERA de estas variantes hostiles devuelve
  // DATOS_INVALIDOS de forma controlada -- nunca lanza una excepcion (lo
  // que en una ruta de Next.js se traduciria en un 500 opaco en vez de un
  // error controlado).

  it("fila null -- no revienta al leer sus propiedades, DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([null as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila numero (1) -- DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([1 as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila string (\"texto\") -- DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado(["texto" as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila array ([]) -- DATOS_INVALIDOS (un array no es el objeto simple que espera construirFilaOtif)", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([[] as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila objeto vacio ({}) -- DATOS_INVALIDOS (sin pedido ni ningun otro campo)", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([{} as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fila undefined -- DATOS_INVALIDOS", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([undefined as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("propiedades con tipos incorrectos: pedido numerico, fechaPrometida numerica, cantidadPedida string -- DATOS_INVALIDOS, nunca lanza", () => {
    expect(previsualizarObservacionOtif(entradaPegado([{ ...filaPegado(), pedido: 123 } as unknown as FilaOtifEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionOtif(entradaPegado([{ ...filaPegado(), fechaPrometida: 20261005 } as unknown as FilaOtifEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionOtif(entradaPegado([{ ...filaPegado(), cantidadPedida: "10" } as unknown as FilaOtifEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionOtif(entradaPegado([{ ...filaPegado(), fechaReal: 123 } as unknown as FilaOtifEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionOtif(entradaPegado([{ ...filaPegado(), cantidadEntregada: "10" } as unknown as FilaOtifEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
    expect(previsualizarObservacionOtif(entradaPegado([{ ...filaPegado(), pedido: null } as unknown as FilaOtifEntrada]))).toEqual({
      ok: false,
      error: "DATOS_INVALIDOS",
    });
  });

  it("fechaReal AUSENTE (propiedad faltante, no null explicito) -- DATOS_INVALIDOS, no se confunde con 'pedido sin cerrar'", () => {
    const filaSinFechaReal = { pedido: "PED-1", fechaPrometida: "2026-10-05", cantidadPedida: 10, cantidadEntregada: 10 };
    const resultado = previsualizarObservacionOtif(entradaPegado([filaSinFechaReal as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("cantidadEntregada AUSENTE (propiedad faltante, no null explicito) -- DATOS_INVALIDOS", () => {
    const filaSinCantidadEntregada = { pedido: "PED-1", fechaPrometida: "2026-10-05", fechaReal: "2026-10-05", cantidadPedida: 10 };
    const resultado = previsualizarObservacionOtif(entradaPegado([filaSinCantidadEntregada as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fechaReal y cantidadEntregada AUSENTES a la vez -- DATOS_INVALIDOS, sigue sin lanzar", () => {
    const filaIncompleta = { pedido: "PED-1", fechaPrometida: "2026-10-05", cantidadPedida: 10 };
    const resultado = previsualizarObservacionOtif(entradaPegado([filaIncompleta as unknown as FilaOtifEntrada]));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });

  it("fechaReal/cantidadEntregada null explicito SIGUE siendo valido (pedido sin cerrar, RF-K3) -- esto no cambio", () => {
    const resultado = previsualizarObservacionOtif(entradaPegado([filaPegado({ fechaReal: null, cantidadEntregada: null })]));
    expect(resultado.ok).toBe(true);
  });

  it("una mezcla de filas validas y una hostil (null) en la misma carga -- rechaza TODA la carga, DATOS_INVALIDOS", () => {
    const filas = [filaPegado({ pedido: "P1" }), null as unknown as FilaOtifEntrada, filaPegado({ pedido: "P2" })];
    const resultado = previsualizarObservacionOtif(entradaPegado(filas));
    expect(resultado).toEqual({ ok: false, error: "DATOS_INVALIDOS" });
  });
});
