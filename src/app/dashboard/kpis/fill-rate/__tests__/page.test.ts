// Pruebas (sin DB, sin jsdom) -- DeclaracionFillRatePage (historial de
// observaciones Fill Rate). Mismo patron y mismo motivo que
// src/app/dashboard/kpis/otif/__tests__/page.test.ts (archivo hermano,
// identico salvo el codigo de KPI) -- ver su comentario de cabecera.
//
// Correccion de validacion real en Windows (2026-11-16): esta pagina
// comparte el mismo patron de formatearFecha() que DetalleObservacionKpi
// y DeclaracionOtifPage (periodoInicio/periodoFin date-only, sin
// timeZone: "UTC") -- al principio se dejo fuera del alcance de esta
// ronda (no era parte del diff del PR), pero Alex pidio corregirla
// tambien antes de staging.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { fijarZonaHorariaDePrueba } from "../../_compartido/__tests__/entornoPruebaZonaHoraria";

const requireAdminOrRedirectMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdminOrRedirect: (...args: unknown[]) => requireAdminOrRedirectMock(...args),
}));

const cadenaFindManyMock = vi.fn();
const observacionKpiFindManyMock = vi.fn();
const tenantClientMock = vi.fn((empresaId: string) => ({
  __empresaId: empresaId,
  cadena: { findMany: cadenaFindManyMock },
  observacionKpi: { findMany: observacionKpiFindManyMock },
}));
vi.mock("@/infra/prisma/tenantClient", () => ({
  tenantClient: (empresaId: string) => tenantClientMock(empresaId),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-aislada", rol: "ADMINISTRADOR" as const, email: "a@b.com" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminOrRedirectMock.mockResolvedValue(SESION_ADMIN);
  // Vacio a proposito: con cadenas.length > 0 la pagina monta el wizard
  // cliente (useRouter()), que revienta bajo renderToStaticMarkup sin un
  // AppRouterContext montado -- el historial (lo que prueban estos tests)
  // se renderiza igual sin importar cadenas.length.
  cadenaFindManyMock.mockResolvedValue([]);
});

describe("DeclaracionFillRatePage -- historial (periodoInicio/periodoFin date-only)", () => {
  // Correccion de validacion real en Windows (2026-11-16, bloqueante
  // 1): America/Lima (UTC-5) es la misma zona de offset negativo ya
  // usada en este repo para esta clase de defecto. El defecto original
  // se reprodujo con 2026-09-30 mostrado como 29 set. en vez de 30 set.
  it("en America/Lima (UTC-5), el periodo del historial se muestra con el dia calendario correcto (01 set. - 30 set., nunca 29 set.)", async () => {
    const restaurarTZ = fijarZonaHorariaDePrueba("America/Lima");
    try {
      observacionKpiFindManyMock.mockResolvedValue([
        {
          id: "obs-1",
          periodoInicio: new Date("2026-09-01T00:00:00.000Z"),
          periodoFin: new Date("2026-09-30T00:00:00.000Z"),
          valor: 0.92,
          fuente: "manual",
          cadena: { nombre: "Cadena Norte" },
        },
      ]);
      const { default: DeclaracionFillRatePage } = await import("../page");

      const elemento = (await DeclaracionFillRatePage()) as ReactElement;
      const html = renderToStaticMarkup(elemento);

      expect(html).toContain("01 set. 2026");
      expect(html).toContain("30 set. 2026");
      expect(html).not.toContain("29 set. 2026");
    } finally {
      restaurarTZ();
    }
  });

  it("sin observaciones -- muestra el mensaje de historial vacio, sin reventar formateando fechas", async () => {
    observacionKpiFindManyMock.mockResolvedValue([]);
    const { default: DeclaracionFillRatePage } = await import("../page");

    const elemento = (await DeclaracionFillRatePage()) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Todavía no hay ninguna observación Fill Rate declarada.");
  });
});
