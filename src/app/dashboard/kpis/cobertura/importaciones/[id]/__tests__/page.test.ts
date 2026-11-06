// Pruebas (sin DB, sin jsdom) -- DetalleImportacionCoberturaPage (Server
// Component, Incremento 4 PR1). Mismo patron que
// _compartido/__tests__/DetalleObservacionKpi.test.ts (ver su
// comentario de cabecera para el porque de renderToStaticMarkup): se
// llama al componente directamente, mockeando requireAdminOrRedirect(),
// tenantClient() y notFound(), y se verifica tanto el comportamiento
// (que se llama, con que argumentos) como el texto que termina en
// pantalla.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const requireAdminOrRedirectMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({
  requireAdminOrRedirect: (...args: unknown[]) => requireAdminOrRedirectMock(...args),
}));

const tenantClientMock = vi.fn();
vi.mock("@/infra/prisma/tenantClient", () => ({
  tenantClient: (...args: unknown[]) => tenantClientMock(...args),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

const SESION_ADMIN = { usuarioId: "usuario-1", empresaId: "empresa-aislada", rol: "ADMINISTRADOR" as const, email: "a@b.com" };

interface OpcionesClienteFalso {
  importacion: Record<string, unknown> | null;
  porEstado?: Array<{ estado: string; _count: { _all: number } }>;
  calculadaConCeroDias?: number;
  rangoMin?: Date | null;
  rangoMax?: Date | null;
  filas?: Array<Record<string, unknown>>;
  totalPersistidas?: number;
}

function construirClienteFalso(opciones: OpcionesClienteFalso) {
  const importacionCsvFindFirstMock = vi.fn().mockResolvedValue(opciones.importacion);
  const groupByMock = vi.fn().mockResolvedValue(opciones.porEstado ?? []);
  // count() se llama DOS veces dentro del mismo Promise.all con argumentos
  // distintos (una vez filtrando coberturaDias:0 para separar CERO_REAL de
  // VALOR, otra vez sin ese filtro para el total real) -- se distingue por
  // el `where` recibido en vez de por el orden de llamada, que no es
  // observable desde afuera.
  const countMock = vi.fn((args: { where?: { coberturaDias?: number } }) => {
    if (args?.where?.coberturaDias === 0) return Promise.resolve(opciones.calculadaConCeroDias ?? 0);
    return Promise.resolve(opciones.totalPersistidas ?? 0);
  });
  const aggregateMock = vi.fn().mockResolvedValue({
    _min: { fechaCorte: opciones.rangoMin ?? null },
    _max: { fechaCorte: opciones.rangoMax ?? null },
  });
  const findManyMock = vi.fn().mockResolvedValue(opciones.filas ?? []);
  return {
    importacionCsv: { findFirst: importacionCsvFindFirstMock },
    observacionCobertura: { groupBy: groupByMock, count: countMock, aggregate: aggregateMock, findMany: findManyMock },
    __mocks: { importacionCsvFindFirstMock, groupByMock, countMock, aggregateMock, findManyMock },
  };
}

function importacionBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "import-1",
    estado: "CONFIRMADA",
    confirmadaEn: new Date("2026-10-20T10:00:00.000Z"),
    procesadaEn: new Date("2026-10-20T10:05:00.000Z"),
    filasDetectadas: 3,
    filasConError: 0,
    erroresMuestra: null,
    cadena: { nombre: "Cadena Norte" },
    definicionKpi: { nombre: "Cobertura de inventario", formula: "inventario disponible / consumo diario esperado", unidad: "días" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminOrRedirectMock.mockResolvedValue(SESION_ADMIN);
});

describe("DetalleImportacionCoberturaPage -- autorizacion", () => {
  it("requireAdminOrRedirect rechaza -- nunca llega a tocar tenantClient", async () => {
    requireAdminOrRedirectMock.mockRejectedValue(new Error("REDIRECT:/dashboard"));
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    await expect(
      DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) }),
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(tenantClientMock).not.toHaveBeenCalled();
  });
});

describe("DetalleImportacionCoberturaPage -- aislamiento por cadena/tenant", () => {
  it("tenantClient se llama con el empresaId de LA SESION autenticada, nunca uno fijo", async () => {
    tenantClientMock.mockReturnValue(construirClienteFalso({ importacion: importacionBase() }));
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) });

    expect(tenantClientMock).toHaveBeenCalledTimes(1);
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-aislada");
  });

  it("la consulta de la importacion filtra por id + definicionKpi.codigo COBERTURA, sin empresaId manual", async () => {
    const cliente = construirClienteFalso({ importacion: importacionBase() });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-7" }) });

    expect(cliente.__mocks.importacionCsvFindFirstMock.mock.calls[0]?.[0]?.where).toEqual({
      id: "import-7",
      definicionKpi: { codigo: "COBERTURA" },
    });
    // Las 4 consultas de filas (groupBy/count/aggregate/findMany) se
    // acotan todas por el MISMO importId recibido, nunca por uno fijo ni
    // por el de otra importacion.
    expect(cliente.__mocks.groupByMock).toHaveBeenCalledWith(expect.objectContaining({ where: { importId: "import-7" } }));
    expect(cliente.__mocks.findManyMock.mock.calls[0]?.[0]?.where).toEqual({ importId: "import-7" });
  });
});

describe("DetalleImportacionCoberturaPage -- estados vacios", () => {
  it("importacion inexistente (o de otra empresa -- tenantClient ya filtro por RLS) -- notFound()", async () => {
    tenantClientMock.mockReturnValue(construirClienteFalso({ importacion: null }));
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    await expect(
      DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "no-existe" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("PENDIENTE_REVISION -- explica que todavia no hay resultado, sin mostrar tabla ni resumen", async () => {
    tenantClientMock.mockReturnValue(
      construirClienteFalso({ importacion: importacionBase({ estado: "PENDIENTE_REVISION", confirmadaEn: null, procesadaEn: null }) }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("todavía no fue confirmada");
    expect(html).not.toContain("Filas válidas");
  });

  it("PROCESADA sin ninguna fila persistida -- estado vacio explicito, nunca una tabla vacia muda", async () => {
    tenantClientMock.mockReturnValue(
      construirClienteFalso({ importacion: importacionBase({ filasDetectadas: 0 }), totalPersistidas: 0 }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("no generó ninguna fila de resultado");
  });

  it("DESCARTADA -- explica que no tiene resultado, sin mostrar el resumen de filas", async () => {
    tenantClientMock.mockReturnValue(
      construirClienteFalso({ importacion: importacionBase({ estado: "DESCARTADA" }) }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("fue descartada");
    expect(html).not.toContain("Filas válidas");
  });

  it("CONFIRMADA sin confirmadaEn ni procesadaEn (viola el invariante de la transaccion de confirmar) -- estado inconsistente, NUNCA 'Procesada' ni el resumen de filas", async () => {
    // Correccion de Alex (2026-11-06, antes del commit de PR1): antes de
    // esta correccion, clasificarImportacion() devolvia PROCESADA para
    // este caso -- esta importacion habria mostrado el resumen de filas y
    // la tabla como si todo hubiera salido bien. Ahora debe mostrar la
    // advertencia de estado inconsistente y nada mas.
    tenantClientMock.mockReturnValue(
      construirClienteFalso({ importacion: importacionBase({ confirmadaEn: null, procesadaEn: null }) }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("estado inconsistente");
    // El badge de estado (">Procesada</span>") nunca debe decir
    // "Procesada" -- distinto de la etiqueta "Procesada:" de la fila de
    // fechas (esa SI aparece siempre, en todos los estados, como parte
    // del texto "Confirmada: -- · Procesada: Todavía no").
    expect(html).not.toContain(">Procesada<");
    expect(html).not.toContain("Filas válidas");
  });

  it("CONFIRMADA con procesadaEn pero SIN confirmadaEn -- tambien inconsistente, nunca se muestra como procesada solo porque hay una fecha de procesamiento", async () => {
    tenantClientMock.mockReturnValue(
      construirClienteFalso({ importacion: importacionBase({ confirmadaEn: null, procesadaEn: new Date("2026-10-20T10:05:00.000Z") }) }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("estado inconsistente");
    expect(html).not.toContain("Filas válidas");
  });
});

describe("DetalleImportacionCoberturaPage -- renderizado de resultados", () => {
  it("importacion con error de job -- muestra el motivo, nunca el resumen de filas", async () => {
    tenantClientMock.mockReturnValue(
      construirClienteFalso({
        importacion: importacionBase({
          estado: "ERROR",
          procesadaEn: null,
          erroresMuestra: [{ numeroFila: 5, error: "Unidad de consumo invalida" }],
        }),
      }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("terminó en error");
    expect(html).toContain("Unidad de consumo invalida");
    expect(html).not.toContain("Filas válidas");
  });

  it("importacion procesada con filas mixtas -- resumen correcto y filas por SKU con su estado/motivo", async () => {
    tenantClientMock.mockReturnValue(
      construirClienteFalso({
        importacion: importacionBase(),
        porEstado: [
          { estado: "CALCULADA", _count: { _all: 2 } },
          { estado: "DATOS_INCOMPLETOS", _count: { _all: 1 } },
        ],
        calculadaConCeroDias: 1,
        rangoMin: new Date("2026-10-01T00:00:00.000Z"),
        rangoMax: new Date("2026-10-01T00:00:00.000Z"),
        totalPersistidas: 3,
        filas: [
          {
            id: "fila-1",
            skuOriginal: "SKU-001",
            ubicacionOriginal: "Lima",
            fechaCorte: new Date("2026-10-01T00:00:00.000Z"),
            inventarioDisponible: 40,
            unidadInventario: "unidades",
            consumoDiarioEsperado: 10,
            unidadConsumoDiario: "unidades",
            coberturaDias: 4,
            estado: "CALCULADA",
            vigente: true,
            reemplazadaEn: null,
            numeroFila: 2,
          },
          {
            id: "fila-2",
            skuOriginal: "SKU-002",
            ubicacionOriginal: "Lima",
            fechaCorte: new Date("2026-10-01T00:00:00.000Z"),
            inventarioDisponible: 0,
            unidadInventario: "unidades",
            consumoDiarioEsperado: 5,
            unidadConsumoDiario: "unidades",
            coberturaDias: 0,
            estado: "CALCULADA",
            vigente: true,
            reemplazadaEn: null,
            numeroFila: 3,
          },
          {
            id: "fila-3",
            skuOriginal: "SKU-003",
            ubicacionOriginal: "Lima",
            fechaCorte: new Date("2026-10-01T00:00:00.000Z"),
            inventarioDisponible: null,
            unidadInventario: "unidades",
            consumoDiarioEsperado: null,
            unidadConsumoDiario: "unidades",
            coberturaDias: null,
            estado: "DATOS_INCOMPLETOS",
            vigente: true,
            reemplazadaEn: null,
            numeroFila: 4,
          },
        ],
      }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Filas válidas");
    expect(html).toContain("SKU-001");
    expect(html).toContain("SKU-002");
    expect(html).toContain("SKU-003");
    expect(html).toContain("4.0 días");
    expect(html).toContain("0.0 días");
    expect(html).toContain("Inventario o consumo faltante");
  });

  it("totalPersistidas supera el tope de la tabla -- avisa que muestra solo una parte, sin mentir el resumen", async () => {
    tenantClientMock.mockReturnValue(
      construirClienteFalso({
        importacion: importacionBase(),
        porEstado: [{ estado: "CALCULADA", _count: { _all: 600 } }],
        calculadaConCeroDias: 0,
        totalPersistidas: 600,
        filas: [
          {
            id: "fila-1",
            skuOriginal: "SKU-001",
            ubicacionOriginal: "Lima",
            fechaCorte: new Date("2026-10-01T00:00:00.000Z"),
            inventarioDisponible: 40,
            unidadInventario: "unidades",
            consumoDiarioEsperado: 10,
            unidadConsumoDiario: "unidades",
            coberturaDias: 4,
            estado: "CALCULADA",
            vigente: true,
            reemplazadaEn: null,
            numeroFila: 2,
          },
        ],
      }),
    );
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Mostrando las primeras");
    expect(html).toContain("600");
  });
});
