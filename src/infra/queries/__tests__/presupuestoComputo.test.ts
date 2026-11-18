// Pruebas -- ejecutarConsultaDentroDePresupuesto() (Incremento 5 PR2,
// src/infra/queries/presupuestoComputo.ts). Reloj inyectable y
// controlado en TODAS las pruebas deterministas (equivalente a "fake
// timers" para medicion de reloj sincronico -- vi.useFakeTimers() de
// vitest no sirve aca: fake timers reemplaza setTimeout/Date, no
// cuanto tiempo de CPU real consume un loop sincronico, y
// performance.now() no lo respeta -- ver el diseño entregado).
// registrarEventoPresupuestoComputo() se mockea: estas pruebas son del
// HELPER, no del modulo de logging en si (eso lo cubre
// eventoPresupuestoComputo.test.ts por separado).
import { describe, expect, it, vi, beforeEach } from "vitest";

const registrarEventoPresupuestoComputoMock = vi.fn();
vi.mock("../eventoPresupuestoComputo", () => ({
  registrarEventoPresupuestoComputo: (...args: unknown[]) => registrarEventoPresupuestoComputoMock(...args),
}));

import { ejecutarConsultaDentroDePresupuesto } from "../presupuestoComputo";

/** Reloj falso -- devuelve, en orden, exactamente los valores pasados
 * (uno por llamada: la 1ra es "inicio", la 2da es "fin"). */
function relojFijo(valores: number[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const v of valores) fn.mockReturnValueOnce(v);
  return fn;
}

beforeEach(() => {
  registrarEventoPresupuestoComputoMock.mockReset();
});

describe("ejecutarConsultaDentroDePresupuesto -- reloj inyectable, deterministico", () => {
  it("duracion MENOR al presupuesto -- devuelve el resultado real de calcular(), no loguea nada", () => {
    const reloj = relojFijo([0, 500]);
    const resultado = ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => "valor-real", reloj);
    expect(resultado).toBe("valor-real");
    expect(registrarEventoPresupuestoComputoMock).not.toHaveBeenCalled();
  });

  it("duracion EXACTAMENTE IGUAL al presupuesto -- cuenta como DENTRO (<=, nunca excedida)", () => {
    const reloj = relojFijo([0, 1500]);
    const resultado = ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => "valor-real", reloj);
    expect(resultado).toBe("valor-real");
    expect(registrarEventoPresupuestoComputoMock).not.toHaveBeenCalled();
  });

  it("duracion MAYOR al presupuesto -- calcular() SI corre (nunca se interrumpe), pero el resultado se descarta y devuelve PRESUPUESTO_COMPUTO_EXCEDIDO", () => {
    const reloj = relojFijo([0, 2000]);
    const calcular = vi.fn(() => "valor-que-se-descarta");
    const resultado = ejecutarConsultaDentroDePresupuesto("DEPENDENCIA_CRITICA", 1500, calcular, reloj);
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ ok: false, error: "PRESUPUESTO_COMPUTO_EXCEDIDO" });
  });

  it("el resultado tardio queda EFECTIVAMENTE descartado -- nunca se devuelve el valor real calculado cuando se excede", () => {
    const reloj = relojFijo([0, 2000]);
    const resultado = ejecutarConsultaDentroDePresupuesto(
      "DEPENDENCIA_CRITICA",
      1500,
      () => ({ dato: "esto-nunca-deberia-salir" }),
      reloj,
    );
    expect(resultado).not.toEqual({ dato: "esto-nunca-deberia-salir" });
    expect(resultado).toEqual({ ok: false, error: "PRESUPUESTO_COMPUTO_EXCEDIDO" });
  });

  it("al exceder, emite EXACTAMENTE un evento saneado con catalogoId/duracionMs/presupuestoMs", () => {
    const reloj = relojFijo([0, 2000]);
    ejecutarConsultaDentroDePresupuesto("ACCION_PRIORITARIA", 1500, () => "x", reloj);
    expect(registrarEventoPresupuestoComputoMock).toHaveBeenCalledTimes(1);
    const [codigo, detalle] = registrarEventoPresupuestoComputoMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(codigo).toBe("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO");
    expect(detalle.catalogoId).toBe("ACCION_PRIORITARIA");
    expect(detalle.duracionMs).toBe(2000);
    expect(detalle.presupuestoMs).toBe(1500);
  });

  it("una excepcion REAL de calcular() se propaga SIN transformar -- nunca se atrapa, nunca se loguea como excedido", () => {
    const reloj = relojFijo([0]); // nunca llega a leer "fin" si calcular() lanza
    const errorDelMotor = new Error("boom -- fallo real del motor, nunca de este guardrail");
    expect(() =>
      ejecutarConsultaDentroDePresupuesto(
        "OTIF_CAIDA",
        1500,
        () => {
          throw errorDelMotor;
        },
        reloj,
      ),
    ).toThrow(errorDelMotor);
    expect(registrarEventoPresupuestoComputoMock).not.toHaveBeenCalled();
  });

  it("el reloj se llama EXACTAMENTE 2 veces (antes y despues) -- nunca polling intermedio", () => {
    const reloj = relojFijo([0, 100]);
    ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => "x", reloj);
    expect(reloj).toHaveBeenCalledTimes(2);
  });

  it("cobertura de los 6 catalogos -- cada uno propaga su propio catalogoId al evento cuando excede", () => {
    const catalogos = [
      "OTIF_CAIDA",
      "OTIF_PROVEEDOR_RETRASOS",
      "DEPENDENCIA_CRITICA",
      "FALTANTES_FILL_RATE",
      "ACCION_PRIORITARIA",
      "CAMBIOS_ULTIMO_PULSO",
    ] as const;
    for (const catalogoId of catalogos) {
      registrarEventoPresupuestoComputoMock.mockReset();
      const reloj = relojFijo([0, 2000]);
      ejecutarConsultaDentroDePresupuesto(catalogoId, 1500, () => "x", reloj);
      const [, detalle] = registrarEventoPresupuestoComputoMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(detalle.catalogoId).toBe(catalogoId);
    }
  });
});

describe("ejecutarConsultaDentroDePresupuesto -- validacion defensiva de presupuestoMs/duracionMs", () => {
  it.each([-1, NaN, Infinity, -Infinity])("presupuestoMs invalido (%s) -- lanza ANTES de llamar a calcular()", (presupuestoInvalido) => {
    const calcular = vi.fn(() => "no deberia ejecutarse");
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", presupuestoInvalido, calcular)).toThrow(/presupuestoMs invalido/);
    expect(calcular).not.toHaveBeenCalled();
  });

  it("presupuestoMs = 0 es VALIDO (numero finito no negativo) -- no lanza por si solo", () => {
    const reloj = relojFijo([0, 0]);
    const resultado = ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 0, () => "x", reloj);
    expect(resultado).toBe("x");
  });

  // La lectura "antes" y la lectura "despues" se validan POR SEPARADO
  // (nunca solo la resta final) -- cada una de las 2 pruebas siguientes
  // rompe una sola de las dos, dejando la otra valida, para confirmar
  // que la validacion individual es la que realmente detecta el
  // problema (y dice CUAL de las dos lecturas fallo).
  it('lectura "antes" del reloj invalida (NaN) -- lanza identificando esa lectura, nunca llega a calcular() ni a leer "despues"', () => {
    const relojRoto = vi.fn().mockReturnValueOnce(NaN);
    const calcular = vi.fn(() => "no deberia ejecutarse");
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, calcular, relojRoto)).toThrow(/lectura del reloj "antes" es invalida/);
    expect(calcular).not.toHaveBeenCalled();
    expect(relojRoto).toHaveBeenCalledTimes(1); // nunca llega a leer "despues"
    expect(registrarEventoPresupuestoComputoMock).not.toHaveBeenCalled();
  });

  it('lectura "despues" del reloj invalida (NaN, "antes" SI es valida) -- lanza identificando esa lectura, nunca la trata como excedida ni como dentro del presupuesto', () => {
    const relojRoto = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(NaN);
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => "x", relojRoto)).toThrow(/lectura del reloj "despues" es invalida/);
    expect(registrarEventoPresupuestoComputoMock).not.toHaveBeenCalled();
  });

  it.each([-1, Infinity, -Infinity])("lectura \"antes\" del reloj invalida (%s, no solo NaN) -- lanza igual", (lecturaInvalida) => {
    const relojRoto = vi.fn().mockReturnValueOnce(lecturaInvalida);
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => "x", relojRoto)).toThrow(/lectura del reloj "antes" es invalida/);
  });

  it("reloj inyectado NO monotonico (fin < inicio, cada lectura es individualmente valida pero la duracion resultante es negativa) -- lanza igual, nunca la trata silenciosamente como 0", () => {
    const relojNoMonotonico = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(500);
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => "x", relojNoMonotonico)).toThrow(/duracionMs invalida/);
  });
});

describe("ejecutarConsultaDentroDePresupuesto -- rechazo explicito de un callback PromiseLike (calcular debe ser SINCRONICA)", () => {
  it("calcular() que devuelve una Promise real -- lanza explicitamente, nunca la trata como el resultado real ni espera a que resuelva", () => {
    const reloj = relojFijo([0, 100]);
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => Promise.resolve("valor-async") as unknown as string, reloj)).toThrow(
      /PromiseLike/,
    );
    expect(registrarEventoPresupuestoComputoMock).not.toHaveBeenCalled();
  });

  it("calcular() que devuelve un thenable custom (objeto con .then, no una Promise real) -- tambien se rechaza (deteccion por duck-typing, no instanceof Promise)", () => {
    const reloj = relojFijo([0, 100]);
    const thenableCustom = { then: () => {} } as unknown as string;
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => thenableCustom, reloj)).toThrow(/PromiseLike/);
  });

  it("un async arrow function pasado por error como `calcular` (siempre devuelve una Promise) -- se rechaza igual, nunca se mide solo el tiempo de crearla", () => {
    const reloj = relojFijo([0, 100]);
    const calcularAsyncPorError = (async () => "x") as unknown as () => string;
    expect(() => ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, calcularAsyncPorError, reloj)).toThrow(/PromiseLike/);
  });

  it("un resultado real que NO es thenable (string, numero, objeto plano, null) nunca se rechaza por error", () => {
    const reloj = relojFijo([0, 100]);
    expect(ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => ({ ok: true as const, dato: "x" }), reloj)).toEqual({
      ok: true,
      dato: "x",
    });
    const relojNull = relojFijo([0, 100]);
    expect(ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 1500, () => null, relojNull)).toBeNull();
  });
});

describe("ejecutarConsultaDentroDePresupuesto -- unica prueba con reloj REAL (sin sleep/setTimeout)", () => {
  // Ronda de revision de Alex, 2026-11-18: evitar un loop de iteraciones
  // FIJAS (ej. 50_000_000), que ralentiza la suite innecesariamente y
  // puede ser fragil entre maquinas -- en su lugar, un trabajo
  // CPU-bound PEQUEÑO que se detiene en cuanto observa que
  // performance.now() avanzo lo suficiente, con un tope de iteraciones
  // puramente DEFENSIVO (nunca alcanzado en la practica -- solo evita
  // un loop verdaderamente sin fin si el reloj del host fuera
  // extremadamente lento). Esta es la UNICA prueba de todo el archivo
  // que usa el reloj real (se omite el parametro `reloj`) -- todas las
  // demas, arriba, son deterministas via reloj inyectado.
  function trabajoCpuBoundHastaAvanceReloj(objetivoMs: number): number {
    const inicio = performance.now();
    let acumulador = 0;
    let iteraciones = 0;
    const TOPE_DEFENSIVO_ITERACIONES = 50_000_000;
    while (performance.now() - inicio < objetivoMs && iteraciones < TOPE_DEFENSIVO_ITERACIONES) {
      acumulador += Math.sqrt(iteraciones);
      iteraciones++;
    }
    return acumulador;
  }

  it("un trabajo CPU-bound real y chico (nunca sleep/setTimeout) que efectivamente tarda excede un presupuesto de prueba de 0ms, de forma confiable en cualquier maquina", () => {
    const resultado = ejecutarConsultaDentroDePresupuesto("OTIF_CAIDA", 0, () => trabajoCpuBoundHastaAvanceReloj(2));
    expect(resultado).toEqual({ ok: false, error: "PRESUPUESTO_COMPUTO_EXCEDIDO" });
  });
});
