// Pruebas -- registrarEventoPresupuestoComputo() (Incremento 5 PR2).
// Mismo criterio que src/infra/rateLimit/__tests__/eventoConsultaRateLimit.test.ts
// (PR1): espia console.info/warn/error (esta funcion no toca Prisma ni
// red) y verifica el shape EXACTO de la linea JSON emitida, nunca solo
// que "no revienta".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrarEventoPresupuestoComputo } from "../eventoPresupuestoComputo";

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lineaEmitida(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  const [texto] = spy.mock.calls[0] as [string];
  return JSON.parse(texto) as Record<string, unknown>;
}

describe("registrarEventoPresupuestoComputo -- JSON emitido (shape exacto)", () => {
  it("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO -- console.error, nivel 'error' (nunca 'warn': un calculo descartado por exceder el presupuesto merece la severidad mas alta)", () => {
    registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO", {
      catalogoId: "DEPENDENCIA_CRITICA",
      duracionMs: 2000,
      presupuestoMs: 1500,
    });

    const linea = lineaEmitida(errorSpy);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    expect(linea.nivel).toBe("error");
    expect(linea.codigo).toBe("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO");
    expect(linea.catalogoId).toBe("DEPENDENCIA_CRITICA");
    expect(linea.duracionMs).toBe(2000);
    expect(linea.presupuestoMs).toBe(1500);
    expect(typeof linea.timestamp).toBe("string");
    expect(Number.isNaN(new Date(linea.timestamp as string).getTime())).toBe(false);
    expect(Object.keys(linea).sort()).toEqual(["catalogoId", "codigo", "duracionMs", "nivel", "presupuestoMs", "timestamp"]);
  });

  it("detalle vacio (sin catalogoId/duracionMs/presupuestoMs) -- la linea nunca tiene esas claves (no las agrega como undefined)", () => {
    registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO", {});
    const linea = lineaEmitida(errorSpy);
    expect(Object.keys(linea).sort()).toEqual(["codigo", "nivel", "timestamp"]);
  });

  it("guardia en runtime -- un catalogoId que NO es uno de los 6 literales reales (forzado con `as`, simulando un bypass del tipo) se omite del log, nunca se persiste", () => {
    registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO", {
      duracionMs: 2000,
      presupuestoMs: 1500,
      catalogoId: "SELECT * FROM x" as unknown as never,
    });

    const linea = lineaEmitida(errorSpy);
    expect(linea.catalogoId).toBeUndefined();
    expect(Object.keys(linea).sort()).toEqual(["codigo", "duracionMs", "nivel", "presupuestoMs", "timestamp"]);
  });

  it("nunca lanza, incluso sin detalle", () => {
    expect(() => registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO")).not.toThrow();
  });

  it("nunca lanza NI SIQUIERA si console.error esta roto (sobreescrito para lanzar) -- la garantia de 'nunca lanza' se verifica de verdad, no solo se declara en un comentario", () => {
    errorSpy.mockImplementation(() => {
      throw new Error("console.error esta roto en este escenario de prueba");
    });
    expect(() =>
      registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO", { catalogoId: "OTIF_CAIDA", duracionMs: 1, presupuestoMs: 1500 }),
    ).not.toThrow();
  });

  it("nunca lanza NI SIQUIERA si JSON.stringify esta roto (lanza, ej. una referencia circular) -- confirma que TODA la operacion del logger esta protegida, no solo la llamada final a console.*", () => {
    const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("JSON.stringify esta roto en este escenario de prueba");
    });
    try {
      expect(() =>
        registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO", { catalogoId: "OTIF_CAIDA", duracionMs: 1, presupuestoMs: 1500 }),
      ).not.toThrow();
      // JSON.stringify fallo ANTES de llegar a console.error -- si el
      // try/catch solo protegiera la llamada a console.* (como antes de
      // esta correccion), este fallo se habria propagado sin que
      // console.error llegara a invocarse nunca.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      // Restaura el mock explicitamente (ademas de vi.restoreAllMocks()
      // en el afterEach de arriba) -- JSON.stringify es global y esta
      // prueba no deberia dejarlo roto para ninguna otra, ni siquiera si
      // una asercion de arriba fallara antes de llegar aca.
      stringifySpy.mockRestore();
    }
  });

  it("nunca incluye ninguna clave de tenant/usuario/cadena/huella -- la firma no tiene parametro por el que puedan colarse (verificacion estructural: el objeto de detalle que acepta TypeScript no admite esas claves)", () => {
    registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO", { catalogoId: "OTIF_CAIDA", duracionMs: 1, presupuestoMs: 1500 });
    const linea = lineaEmitida(errorSpy);
    for (const claveProhibida of ["cadenaId", "empresaId", "usuarioId", "huella", "huellaOrigenHash"]) {
      expect(linea).not.toHaveProperty(claveProhibida);
    }
  });
});
