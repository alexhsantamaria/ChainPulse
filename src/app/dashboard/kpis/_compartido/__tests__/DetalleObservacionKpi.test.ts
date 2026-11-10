// Pruebas (sin DB, sin jsdom) -- DetalleObservacionKpi (Server Component
// compartido por OTIF/Fill Rate, Incremento 4 PR1). Mismo patron ya usado
// en este repo para probar un Server Component .tsx sin renderizarlo a
// DOM (ver src/app/plataforma/login/__tests__/page.test.ts y
// src/app/plataforma/__tests__/page.test.ts, y el comentario de
// esbuild.jsx en vitest.config.ts): se importa el componente, se lo
// llama directamente como la funcion async que es (mockeando
// requireAdminOrRedirect() y tenantClient(), igual que las pruebas de
// route.ts mockean requireAdmin()/tenantClient()), y se inspecciona lo
// que devuelve -- nunca se monta a un DOM real (jsdom/@testing-library/
// react siguen sin usarse en este repo, decision de Alex del 2026-10-10
// citada en construirMensajeError.test.ts).
//
// Para "renderizado de resultados" (punto pedido por Alex, 2026-11-06)
// se usa ADEMAS react-dom/server.renderToStaticMarkup() sobre el
// elemento ya resuelto -- un render puramente de servidor (el mismo
// mecanismo que usa Next para SSR/RSC), sin DOM, sin efectos y sin
// hidratacion, solo para poder verificar el TEXTO que termina en
// pantalla en vez de solo "no revento". No es infraestructura de testing
// de componentes nueva: es la misma libreria (react-dom, ya dependencia
// de Next) en su forma mas basica.
//
// Incremento 4 PR2 (Alex, 2026-11-09): se agrega el mock de
// `observacionKpi.findMany` (historico para la seccion "Analisis y
// decision") -- con un resultado por defecto vacio en beforeEach, para
// que las pruebas de PR1 de arriba (que no conocen esta consulta nueva)
// sigan pasando sin cambios.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const requireAdminOrRedirectMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdminOrRedirect: (...args: unknown[]) => requireAdminOrRedirectMock(...args),
}));

const observacionKpiFindFirstMock = vi.fn();
const observacionKpiFindManyMock = vi.fn();
const tenantClientMock = vi.fn((empresaId: string) => ({
  __empresaId: empresaId,
  observacionKpi: { findFirst: observacionKpiFindFirstMock, findMany: observacionKpiFindManyMock },
}));
vi.mock("@/infra/prisma/tenantClient", () => ({
  tenantClient: (empresaId: string) => tenantClientMock(empresaId),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-aislada", rol: "ADMINISTRADOR" as const, email: "a@b.com" };

function observacionBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "obs-1",
    cadenaId: "cadena-1",
    definicionKpiId: "def-otif",
    valor: 0.86,
    numerador: 86,
    denominador: 100,
    estado: "DECLARADO",
    fuente: "manual",
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    periodoInicio: new Date("2026-09-01T00:00:00.000Z"),
    periodoFin: new Date("2026-09-30T00:00:00.000Z"),
    ruleVersion: "v1",
    cadena: { nombre: "Cadena Norte" },
    definicionKpi: { nombre: "OTIF", formula: "entregas a tiempo y completas / total de entregas", unidad: "%" },
    ...overrides,
  };
}

function puntoHistorico(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "obs-anterior",
    periodoInicio: new Date("2026-08-01T00:00:00.000Z"),
    periodoFin: new Date("2026-08-31T00:00:00.000Z"),
    valor: 0.8,
    numerador: 80,
    denominador: 100,
    ruleVersion: "v1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminOrRedirectMock.mockResolvedValue(SESION_ADMIN);
  observacionKpiFindManyMock.mockResolvedValue([]);
});

describe("DetalleObservacionKpi -- autorizacion", () => {
  it("requireAdminOrRedirect rechaza (sesion no autorizada) -- nunca llega a tocar tenantClient", async () => {
    requireAdminOrRedirectMock.mockRejectedValue(new Error("REDIRECT:/dashboard"));
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    await expect(DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })).rejects.toThrow("REDIRECT:/dashboard");
    expect(tenantClientMock).not.toHaveBeenCalled();
  });

  it("codigo fuera del alcance de PR1 -- notFound() ANTES de pedir sesion o tocar la base", async () => {
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- codigo invalido a proposito, para probar la guarda defensiva de esCodigoConDetalleHabilitado()
    await expect(DetalleObservacionKpi({ codigo: "COBERTURA" as any, id: "obs-1" })).rejects.toThrow("NOT_FOUND");
    expect(requireAdminOrRedirectMock).not.toHaveBeenCalled();
    expect(tenantClientMock).not.toHaveBeenCalled();
  });
});

describe("DetalleObservacionKpi -- aislamiento por cadena/tenant", () => {
  it("tenantClient se llama con el empresaId de LA SESION autenticada, nunca uno fijo", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase());
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" });

    expect(tenantClientMock).toHaveBeenCalledTimes(1);
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-aislada");
  });

  it("la consulta filtra por id + definicionKpi.codigo, sin empresaId manual (eso lo agrega tenantClient)", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase());
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    await DetalleObservacionKpi({ codigo: "FILL_RATE", id: "obs-2" });

    expect(observacionKpiFindFirstMock).toHaveBeenCalledTimes(1);
    expect(observacionKpiFindFirstMock.mock.calls[0]?.[0]?.where).toEqual({
      id: "obs-2",
      definicionKpi: { codigo: "FILL_RATE" },
    });
  });

  it("el historico se consulta con la MISMA cadena+definicionKpi de la observacion y periodoInicio ESTRICTAMENTE anterior", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase());
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" });

    expect(observacionKpiFindManyMock).toHaveBeenCalledTimes(1);
    expect(observacionKpiFindManyMock.mock.calls[0]?.[0]?.where).toEqual({
      cadenaId: "cadena-1",
      definicionKpiId: "def-otif",
      periodoInicio: { lt: new Date("2026-09-01T00:00:00.000Z") },
    });
  });
});

describe("DetalleObservacionKpi -- estados vacios", () => {
  it("observacion inexistente (o de otra empresa -- tenantClient ya filtro por RLS) -- notFound(), nunca un error generico", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(null);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    await expect(DetalleObservacionKpi({ codigo: "OTIF", id: "no-existe" })).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});

describe("DetalleObservacionKpi -- renderizado de resultados", () => {
  it("valor null -- muestra 'sin datos', nunca un cero disfrazado", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase({ valor: null, numerador: null, denominador: null }));
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Sin datos suficientes");
    expect(html).not.toContain("0.0%");
  });

  it("valor 0 -- muestra el 0% real, con la nota de que es un resultado real (no ausencia de datos)", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase({ valor: 0, numerador: 0, denominador: 50 }));
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("0.0%");
    expect(html).toContain("resultado real");
  });

  it("valor positivo -- muestra el valor formateado, la cadena y el link de vuelta al historial correcto", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase());
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "FILL_RATE", id: "obs-3" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("86.0%");
    expect(html).toContain("Cadena Norte");
    expect(html).toContain("/dashboard/kpis/fill-rate");
  });
});

describe("DetalleObservacionKpi -- analisis y decision (Incremento 4 PR2)", () => {
  it("sin historico -- muestra informacion insuficiente en tendencia, comparacion, causas y recomendacion; nunca inventa una cifra", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase());
    observacionKpiFindManyMock.mockResolvedValue([]);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Análisis y decisión");
    expect(html).toContain("todavía no hay suficientes períodos con dato para mostrar una evolución reciente");
    expect(html).toContain("no hay un período anterior con dato para comparar");
    expect(html).not.toContain("Prioridad alta");
    expect(html).not.toContain("Prioridad media");
    expect(html).not.toContain("Siguiente acción propuesta");
  });

  it("con un periodo anterior peor -- muestra tendencia, variacion EMPEORA, causas observables y recomendacion con siguiente accion propuesta", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase({ valor: 0.65, numerador: 65, denominador: 100 }));
    observacionKpiFindManyMock.mockResolvedValue([puntoHistorico({ valor: 0.8, numerador: 80, denominador: 100 })]);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Empeora");
    expect(html).toContain("-15.0 puntos");
    expect(html).toContain("El numerador pasó de 80 a 65");
    expect(html).toContain("Prioridad alta");
    expect(html).toContain("Siguiente acción propuesta");
    expect(html).toContain("El registro y seguimiento de acciones estará disponible en una próxima versión.");
  });

  it("fallo de lectura del historico -- pantalla recuperable, nunca el detalle interno del error, y el resto de la pagina sigue mostrandose", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase());
    observacionKpiFindManyMock.mockRejectedValue(new Error("Authentication timed out"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("No se pudo cargar el análisis histórico");
    expect(html).not.toContain("Authentication timed out");
    expect(html).toContain("86.0%"); // el detalle principal sigue mostrandose
    expect(consoleErrorSpy.mock.calls[0]).toEqual([
      "KPI_HISTORICO_LECTURA_FALLIDA",
      { observacionId: "obs-1", nombreClase: "Error", codigo: null },
    ]);
    consoleErrorSpy.mockRestore();
  });

  it("etiquetas renombradas (RONDA 2): 'Evolución reciente' y 'Descomposición del cambio', nunca los nombres anteriores", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase({ valor: 0.65, numerador: 65, denominador: 100 }));
    observacionKpiFindManyMock.mockResolvedValue([puntoHistorico({ valor: 0.8, numerador: 80, denominador: 100 })]);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Evolución reciente");
    expect(html).toContain("Descomposición del cambio");
    expect(html).not.toMatch(/>Tendencia[\s(<]/);
    expect(html).not.toContain(">Causas observables<");
  });

  it("ruleVersion distinta en el historico -- se excluye, equivale a no tener historico comparable (RONDA 3: motivo RULE_VERSION_INCOMPATIBLE)", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(
      observacionBase({ valor: 0.65, numerador: 65, denominador: 100, ruleVersion: "v1" }),
    );
    observacionKpiFindManyMock.mockResolvedValue([
      puntoHistorico({ valor: 0.8, numerador: 80, denominador: 100, ruleVersion: "v0-legacy" }),
    ]);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("los períodos anteriores usan otra versión de cálculo y no son comparables");
    expect(html).not.toContain("todavía no hay suficientes períodos con dato para mostrar una evolución reciente");
    expect(html).not.toContain("no hay un período anterior con dato para comparar");
    expect(html).not.toContain("Prioridad alta");
  });

  it("periodo anterior sin dato declarado -- motivo SIN_DATOS_PERIODO_ANTERIOR, mensaje especifico solo en comparacion (RONDA 3)", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(
      observacionBase({ valor: 0.65, numerador: 65, denominador: 100, ruleVersion: "v1" }),
    );
    observacionKpiFindManyMock.mockResolvedValue([
      puntoHistorico({ valor: null, numerador: null, denominador: null, ruleVersion: "v1" }),
    ]);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("el período anterior no tiene un valor declarado para comparar");
    expect(html).not.toContain("no hay un período anterior con dato para comparar");
    expect(html).not.toContain("Prioridad alta");
  });

  it("RONDA 4, punto 4 (OTIF): el periodo INMEDIATO anterior incompatible bloquea la comparacion, NUNCA se salta para usar uno mas antiguo que si calce", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(
      observacionBase({ valor: 0.6, numerador: 60, denominador: 100, ruleVersion: "v1" }),
    );
    // El mock devuelve lo mismo que el orderBy "desc" real (mas reciente
    // primero) -- el componente lo invierte el mismo a ascendente, igual
    // que la consulta real. Aca: mas reciente (e INMEDIATO anterior al
    // actual) es incompatible; mas antiguo (2do en el array desc) SI
    // seria comparable, pero nunca debe usarse.
    observacionKpiFindManyMock.mockResolvedValue([
      puntoHistorico({ valor: 0.9, numerador: 90, denominador: 100, ruleVersion: "v2-nueva-regla" }),
      puntoHistorico({ valor: 0.5, numerador: 50, denominador: 100, ruleVersion: "v1" }),
    ]);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("los períodos anteriores usan otra versión de cálculo y no son comparables");
    expect(html).not.toContain("Prioridad alta");
    expect(html).not.toContain("Prioridad media");
  });

  it("RONDA 4, punto 4 (Fill Rate): la MISMA regla de periodo inmediato aplica -- generarAnalisisObservacionKpi() es compartida, pero se demuestra tambien con codigo FILL_RATE", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(
      observacionBase({
        valor: 0.86,
        numerador: 86,
        denominador: 100,
        ruleVersion: "v1",
        definicionKpi: { nombre: "Fill Rate", formula: "unidades entregadas / unidades pedidas", unidad: "%" },
      }),
    );
    observacionKpiFindManyMock.mockResolvedValue([
      puntoHistorico({ valor: 0.4, numerador: 40, denominador: 100, ruleVersion: "v2-nueva-regla" }),
      puntoHistorico({ valor: 0.95, numerador: 95, denominador: 100, ruleVersion: "v1" }),
    ]);
    const { default: DetalleObservacionKpi } = await import("../DetalleObservacionKpi");

    const elemento = (await DetalleObservacionKpi({ codigo: "FILL_RATE", id: "obs-3" })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("los períodos anteriores usan otra versión de cálculo y no son comparables");
    expect(html).not.toContain("Prioridad alta");
    expect(html).not.toContain("Prioridad media");
  });

  it("limite de magnitud por delta ABSOLUTO (RONDA 2, punto 3): 9 puntos -> Prioridad media, 10 puntos -> Prioridad alta", async () => {
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase({ valor: 0.71, numerador: 71, denominador: 100 }));
    observacionKpiFindManyMock.mockResolvedValue([puntoHistorico({ valor: 0.8, numerador: 80, denominador: 100 })]);
    const { default: DetalleObservacionKpiNueve } = await import("../DetalleObservacionKpi");
    const elementoNueve = (await DetalleObservacionKpiNueve({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    expect(renderToStaticMarkup(elementoNueve)).toContain("Prioridad media");

    vi.clearAllMocks();
    requireAdminOrRedirectMock.mockResolvedValue(SESION_ADMIN);
    observacionKpiFindFirstMock.mockResolvedValue(observacionBase({ valor: 0.7, numerador: 70, denominador: 100 }));
    observacionKpiFindManyMock.mockResolvedValue([puntoHistorico({ valor: 0.8, numerador: 80, denominador: 100 })]);
    const { default: DetalleObservacionKpiDiez } = await import("../DetalleObservacionKpi");
    const elementoDiez = (await DetalleObservacionKpiDiez({ codigo: "OTIF", id: "obs-1" })) as ReactElement;
    expect(renderToStaticMarkup(elementoDiez)).toContain("Prioridad alta");
  });
});
