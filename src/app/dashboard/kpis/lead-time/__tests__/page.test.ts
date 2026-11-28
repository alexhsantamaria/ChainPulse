// Pruebas (sin DB, sin jsdom) -- DeclaracionLeadTimePage (historial de
// observaciones Lead time). Mismo patron y mismo motivo que
// src/app/dashboard/kpis/fill-rate/__tests__/page.test.ts /
// src/app/dashboard/kpis/otif/__tests__/page.test.ts (archivos
// hermanos, identicos salvo el codigo de KPI y la unidad mostrada) --
// ver su comentario de cabecera.
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
  // AppRouterContext montado -- el historial (lo que prueban estos
  // tests) se renderiza igual sin importar cadenas.length.
  cadenaFindManyMock.mockResolvedValue([]);
});

describe("DeclaracionLeadTimePage -- aislamiento/autorizacion (mismo patron que OTIF/Fill Rate)", () => {
  it("exige sesion de ADMINISTRADOR -- llama a requireAdminOrRedirect() antes de resolver cualquier dato", async () => {
    observacionKpiFindManyMock.mockResolvedValue([]);
    const { default: DeclaracionLeadTimePage } = await import("../page");

    await DeclaracionLeadTimePage();

    expect(requireAdminOrRedirectMock).toHaveBeenCalledTimes(1);
  });

  it("resuelve el historial con tenantClient(empresaId) de la SESION -- nunca con un empresaId distinto (aislamiento de tenant, RNF1 capa 1)", async () => {
    observacionKpiFindManyMock.mockResolvedValue([]);
    const { default: DeclaracionLeadTimePage } = await import("../page");

    await DeclaracionLeadTimePage();

    expect(tenantClientMock).toHaveBeenCalledWith(SESION_ADMIN.empresaId);
  });

  it("filtra el historial por definicionKpi.codigo === 'LEAD_TIME' -- nunca muestra observaciones de otro KPI", async () => {
    observacionKpiFindManyMock.mockResolvedValue([]);
    const { default: DeclaracionLeadTimePage } = await import("../page");

    await DeclaracionLeadTimePage();

    expect(observacionKpiFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ definicionKpi: { codigo: "LEAD_TIME" } }) }),
    );
  });
});

describe("DeclaracionLeadTimePage -- historial (periodoInicio/periodoFin date-only)", () => {
  it("en America/Lima (UTC-5), el periodo del historial se muestra con el dia calendario correcto (01 set. - 30 set., nunca 29 set.)", async () => {
    const restaurarTZ = fijarZonaHorariaDePrueba("America/Lima");
    try {
      observacionKpiFindManyMock.mockResolvedValue([
        {
          id: "obs-1",
          periodoInicio: new Date("2026-09-01T00:00:00.000Z"),
          periodoFin: new Date("2026-09-30T00:00:00.000Z"),
          valor: 4.5,
          fuente: "manual",
          cadena: { nombre: "Cadena Norte" },
        },
      ]);
      const { default: DeclaracionLeadTimePage } = await import("../page");

      const elemento = (await DeclaracionLeadTimePage()) as ReactElement;
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
    const { default: DeclaracionLeadTimePage } = await import("../page");

    const elemento = (await DeclaracionLeadTimePage()) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Todavía no hay ninguna observación Lead time declarada.");
  });

  it("valor en dias (nunca formateado como porcentaje) y numerador/denominador nulos (modo manual) no revientan el render", async () => {
    observacionKpiFindManyMock.mockResolvedValue([
      {
        id: "obs-manual",
        periodoInicio: new Date("2026-02-01T00:00:00.000Z"),
        periodoFin: new Date("2026-02-28T00:00:00.000Z"),
        valor: 4.5,
        fuente: "manual",
        cadena: { nombre: "Cadena Sur" },
      },
    ]);
    const { default: DeclaracionLeadTimePage } = await import("../page");

    const elemento = (await DeclaracionLeadTimePage()) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("4.5 días");
    expect(html).not.toContain("4.5%");
    expect(html).not.toContain("450%");
  });

  // Prueba obligatoria "enlace al detalle sin 404": no se puede levantar
  // un servidor real en este entorno de pruebas (sin jsdom, sin DB), asi
  // que esta prueba verifica lo que SI se puede verificar de forma
  // aislada y determinista -- que el href generado por cada fila del
  // historial apunta EXACTAMENTE a la misma ruta que expone el wrapper
  // de detalle ya creado en este incremento
  // (src/app/dashboard/kpis/lead-time/observaciones/[id]/page.tsx), con
  // el id real de la observacion. Si el wrapper no existiera en esa
  // ruta, Next.js devolveria 404 al navegar -- la existencia del
  // archivo wrapper en esa ruta exacta se confirma por separado (ver
  // el reporte de esta entrega).
  it("el enlace de cada fila del historial apunta a /dashboard/kpis/lead-time/observaciones/<id> -- la misma ruta que expone el wrapper de detalle ya creado", async () => {
    observacionKpiFindManyMock.mockResolvedValue([
      {
        id: "obs-enlace-1",
        periodoInicio: new Date("2026-03-01T00:00:00.000Z"),
        periodoFin: new Date("2026-03-31T00:00:00.000Z"),
        valor: 2,
        fuente: "pegado",
        cadena: { nombre: "Cadena Este" },
      },
    ]);
    const { default: DeclaracionLeadTimePage } = await import("../page");

    const elemento = (await DeclaracionLeadTimePage()) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain('href="/dashboard/kpis/lead-time/observaciones/obs-enlace-1"');
  });
});
