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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const requireAdminOrRedirectMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdminOrRedirect: (...args: unknown[]) => requireAdminOrRedirectMock(...args),
}));

const observacionKpiFindFirstMock = vi.fn();
const tenantClientMock = vi.fn((empresaId: string) => ({
  __empresaId: empresaId,
  observacionKpi: { findFirst: observacionKpiFindFirstMock },
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

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminOrRedirectMock.mockResolvedValue(SESION_ADMIN);
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
