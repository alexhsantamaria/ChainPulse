// Pruebas -- registrarEventoLatenciaConsulta() (Incremento 5 PR4).
// Mismo criterio que eventoPresupuestoComputo.test.ts /
// eventoConsultaRateLimit.test.ts: espia console.info (esta funcion no
// toca Prisma ni red) y verifica el shape EXACTO de la linea JSON
// emitida, nunca solo que "no revienta".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrarEventoLatenciaConsulta } from "../eventoLatenciaConsulta";

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

describe("registrarEventoLatenciaConsulta -- JSON emitido (shape exacto)", () => {
  it("CONSULTA_LATENCIA_TOTAL -- console.info, nivel 'info' (nunca 'warn'/'error': medir cuanto tardo una peticion es rutina, no una anomalia por si misma)", () => {
    registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", {
      catalogoId: "OTIF_CAIDA",
      duracionMs: 842,
      statusHttp: 200,
    });

    const linea = lineaEmitida(infoSpy);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    expect(linea.nivel).toBe("info");
    expect(linea.codigo).toBe("CONSULTA_LATENCIA_TOTAL");
    expect(linea.catalogoId).toBe("OTIF_CAIDA");
    expect(linea.duracionMs).toBe(842);
    expect(linea.statusHttp).toBe(200);
    expect(typeof linea.timestamp).toBe("string");
    expect(Number.isNaN(new Date(linea.timestamp as string).getTime())).toBe(false);
    expect(Object.keys(linea).sort()).toEqual(["catalogoId", "codigo", "duracionMs", "nivel", "statusHttp", "timestamp"]);
  });

  it("detalle vacio (sin catalogoId/duracionMs/statusHttp) -- la linea nunca tiene esas claves (no las agrega como undefined)", () => {
    registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", {});
    const linea = lineaEmitida(infoSpy);
    expect(Object.keys(linea).sort()).toEqual(["codigo", "nivel", "timestamp"]);
  });

  it("sin segundo argumento (detalle por defecto) -- tampoco lanza ni agrega claves de detalle", () => {
    expect(() => registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL")).not.toThrow();
    const linea = lineaEmitida(infoSpy);
    expect(Object.keys(linea).sort()).toEqual(["codigo", "nivel", "timestamp"]);
  });

  it("statusHttp=0 y duracionMs=0 se registran (son valores validos, nunca tratados como 'ausentes')", () => {
    registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", { duracionMs: 0, statusHttp: 0 });
    const linea = lineaEmitida(infoSpy);
    expect(linea.duracionMs).toBe(0);
    expect(linea.statusHttp).toBe(0);
  });

  it("guardia en runtime -- un catalogoId que NO es uno de los 6 literales reales (forzado con `as`, simulando un bypass del tipo) se omite del log, nunca se persiste", () => {
    registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", {
      duracionMs: 100,
      statusHttp: 200,
      catalogoId: "SELECT * FROM x" as unknown as never,
    });

    const linea = lineaEmitida(infoSpy);
    expect(linea.catalogoId).toBeUndefined();
    expect(Object.keys(linea).sort()).toEqual(["codigo", "duracionMs", "nivel", "statusHttp", "timestamp"]);
  });

  it("nunca lanza, incluso sin detalle", () => {
    expect(() => registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL")).not.toThrow();
  });

  it("nunca lanza NI SIQUIERA si console.info esta roto (sobreescrito para lanzar) -- la garantia de 'nunca lanza' se verifica de verdad, no solo se declara en un comentario", () => {
    infoSpy.mockImplementation(() => {
      throw new Error("console.info esta roto en este escenario de prueba");
    });
    expect(() =>
      registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", { catalogoId: "OTIF_CAIDA", duracionMs: 1, statusHttp: 200 }),
    ).not.toThrow();
  });

  it("nunca lanza NI SIQUIERA si JSON.stringify esta roto (lanza, ej. una referencia circular) -- confirma que TODA la operacion del logger esta protegida, no solo la llamada final a console.*", () => {
    const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("JSON.stringify esta roto en este escenario de prueba");
    });
    try {
      expect(() =>
        registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", { catalogoId: "OTIF_CAIDA", duracionMs: 1, statusHttp: 200 }),
      ).not.toThrow();
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
    }
  });

  it("nunca incluye ninguna clave de tenant/usuario/cadena/huella -- la firma no tiene parametro por el que puedan colarse (verificacion estructural: el objeto de detalle que acepta TypeScript no admite esas claves)", () => {
    registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", { catalogoId: "OTIF_CAIDA", duracionMs: 1, statusHttp: 200 });
    const linea = lineaEmitida(infoSpy);
    for (const claveProhibida of ["cadenaId", "empresaId", "usuarioId", "huella", "huellaOrigenHash"]) {
      expect(linea).not.toHaveProperty(claveProhibida);
    }
  });
});
