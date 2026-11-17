// Pruebas -- registrarEventoRateLimitConsulta() (Incremento 5 PR1,
// ronda 2 de revision, Alex 2026-11-18: "agregar una prueba del JSON
// emitido" para el logger saneado). Espia console.info/warn/error (sin
// mockear nada de rate limiting en si -- esta funcion no toca Prisma
// ni red) y verifica el shape EXACTO de la linea JSON que se emite,
// nunca solo que "no revienta".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrarEventoRateLimitConsulta } from "../eventoConsultaRateLimit";

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

describe("registrarEventoRateLimitConsulta -- JSON emitido (shape exacto)", () => {
  it("CONSULTA_RATE_LIMIT_PERMITIDA -- console.info, nivel 'info', SOLO las claves esperadas", () => {
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_PERMITIDA", { contador: 3, catalogoId: "OTIF_CAIDA" });

    const linea = lineaEmitida(infoSpy);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    expect(linea.nivel).toBe("info");
    expect(linea.codigo).toBe("CONSULTA_RATE_LIMIT_PERMITIDA");
    expect(linea.contador).toBe(3);
    expect(linea.catalogoId).toBe("OTIF_CAIDA");
    expect(typeof linea.timestamp).toBe("string");
    expect(Number.isNaN(new Date(linea.timestamp as string).getTime())).toBe(false);
    expect(Object.keys(linea).sort()).toEqual(["catalogoId", "codigo", "contador", "nivel", "timestamp"]);
  });

  it("CONSULTA_RATE_LIMIT_RECHAZADA -- console.warn, nivel 'warn'", () => {
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_RECHAZADA", { contador: 31, catalogoId: "DEPENDENCIA_CRITICA" });

    const linea = lineaEmitida(warnSpy);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(linea.nivel).toBe("warn");
    expect(linea.codigo).toBe("CONSULTA_RATE_LIMIT_RECHAZADA");
  });

  it("CONSULTA_RATE_LIMIT_INFRAESTRUCTURA -- console.error, nivel 'error', SIN detalle -- solo codigo/nivel/timestamp", () => {
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_INFRAESTRUCTURA");

    const linea = lineaEmitida(errorSpy);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(linea.nivel).toBe("error");
    expect(linea.codigo).toBe("CONSULTA_RATE_LIMIT_INFRAESTRUCTURA");
    expect(Object.keys(linea).sort()).toEqual(["codigo", "nivel", "timestamp"]);
  });

  it("detalle vacio (sin contador/duracionMs/catalogoId) -- la linea nunca tiene esas claves (no las agrega como undefined)", () => {
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_PERMITIDA", {});
    const linea = lineaEmitida(infoSpy);
    expect(Object.keys(linea).sort()).toEqual(["codigo", "nivel", "timestamp"]);
  });

  it("guardia en runtime -- un catalogoId que NO es uno de los 6 literales reales (forzado con `as`, simulando un bypass del tipo) se omite del log, nunca se persiste", () => {
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_PERMITIDA", {
      contador: 1,
      // Simula el escenario que la guardia en runtime existe para
      // cubrir: un valor que el tipo CatalogoConsultaId ya no debería
      // permitir, pero que podría llegar igual via un cast `as` o un
      // futuro refactor.
      catalogoId: "SELECT * FROM x" as unknown as never,
    });

    const linea = lineaEmitida(infoSpy);
    expect(linea.catalogoId).toBeUndefined();
    expect(Object.keys(linea).sort()).toEqual(["codigo", "contador", "nivel", "timestamp"]);
  });

  it("duracionMs se incluye cuando se pasa", () => {
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_PERMITIDA", { duracionMs: 42 });
    const linea = lineaEmitida(infoSpy);
    expect(linea.duracionMs).toBe(42);
  });

  it("nunca lanza, incluso sin detalle", () => {
    expect(() => registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_INFRAESTRUCTURA")).not.toThrow();
  });
});
