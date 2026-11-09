// Pruebas (sin DB, sin jsdom) -- DetalleImportacionCoberturaPage (Server
// Component, Incremento 4 PR1). Mismo patron que
// _compartido/__tests__/DetalleObservacionKpi.test.ts (ver su
// comentario de cabecera para el porque de renderToStaticMarkup): se
// llama al componente directamente, mockeando requireAdminOrRedirect(),
// tenantClient() y notFound(), y se verifica tanto el comportamiento
// (que se llama, con que argumentos) como el texto que termina en
// pantalla.
//
// Correccion (Alex, validacion manual Windows 2026-11-06): se agrega
// aca la cobertura que faltaba para el incidente real -- la pagina
// disparaba las consultas de resultado para CUALQUIER estado de
// importacion, no solo para PROCESADA, y un fallo de lectura (timeout
// del driver) tiraba abajo toda la pagina en vez de mostrar un estado
// recuperable. Las pruebas de "cero consultas" de abajo son las que
// hubieran detectado esto ANTES de la validacion manual.
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
  // Permite forzar un fallo de lectura en cualquiera de las 4 consultas
  // de resultado -- simula exactamente el incidente real (un
  // DriverAdapterError de timeout), para probar que la pagina muestra un
  // estado recuperable en vez de propagar la excepcion.
  fallarGroupBy?: unknown;
}

function construirClienteFalso(opciones: OpcionesClienteFalso) {
  const importacionCsvFindFirstMock = vi.fn().mockResolvedValue(opciones.importacion);
  const groupByMock = opciones.fallarGroupBy
    ? vi.fn().mockRejectedValue(opciones.fallarGroupBy)
    : vi.fn().mockResolvedValue(opciones.porEstado ?? []);
  // Correccion de Alex (2026-11-06): count() ya solo se llama UNA vez
  // dentro del Promise.all (filtrando coberturaDias:0, para separar
  // CERO_REAL de VALOR) -- el total real de filas persistidas ahora se
  // deriva sumando los grupos del groupBy de arriba, no de un segundo
  // count() sin filtro (esa quinta consulta era redundante: nunca podia
  // dar un numero distinto del mismo groupBy sobre la misma tabla).
  const countMock = vi.fn().mockResolvedValue(opciones.calculadaConCeroDias ?? 0);
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

// Las 4 consultas de resultado (groupBy/count/aggregate/findMany) --
// NINGUNA debe haberse llamado para un estado que no sea PROCESADA (ver
// comentario de cabecera del archivo).
function expectCeroConsultasDeResultado(cliente: ReturnType<typeof construirClienteFalso>) {
  expect(cliente.__mocks.groupByMock).not.toHaveBeenCalled();
  expect(cliente.__mocks.countMock).not.toHaveBeenCalled();
  expect(cliente.__mocks.aggregateMock).not.toHaveBeenCalled();
  expect(cliente.__mocks.findManyMock).not.toHaveBeenCalled();
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
    // Las 4 consultas de resultado (groupBy/count/aggregate/findMany) se
    // acotan todas por el MISMO importId recibido, nunca por uno fijo ni
    // por el de otra importacion. Esta importacion esta PROCESADA (por
    // importacionBase()), asi que si corresponde que se llamen.
    expect(cliente.__mocks.groupByMock).toHaveBeenCalledWith(expect.objectContaining({ where: { importId: "import-7" } }));
    expect(cliente.__mocks.findManyMock.mock.calls[0]?.[0]?.where).toEqual({ importId: "import-7" });
  });
});

describe("DetalleImportacionCoberturaPage -- estados vacios (cero consultas de resultado)", () => {
  it("importacion inexistente (o de otra empresa -- tenantClient ya filtro por RLS) -- notFound()", async () => {
    tenantClientMock.mockReturnValue(construirClienteFalso({ importacion: null }));
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    await expect(
      DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "no-existe" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("PENDIENTE_REVISION -- explica que todavia no hay resultado, sin consultar ObservacionCobertura", async () => {
    const cliente = construirClienteFalso({
      importacion: importacionBase({ estado: "PENDIENTE_REVISION", confirmadaEn: null, procesadaEn: null }),
    });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("todavía no fue confirmada");
    expect(html).not.toContain("Filas válidas");
    expectCeroConsultasDeResultado(cliente);
  });

  it("PROCESANDO -- explica que el calculo sigue en curso, sin consultar ObservacionCobertura", async () => {
    const cliente = construirClienteFalso({
      importacion: importacionBase({ procesadaEn: null }),
    });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("todavía no terminó");
    expect(html).not.toContain("Filas válidas");
    expectCeroConsultasDeResultado(cliente);
  });

  it("DESCARTADA -- explica que no tiene resultado, sin consultar ObservacionCobertura", async () => {
    const cliente = construirClienteFalso({ importacion: importacionBase({ estado: "DESCARTADA" }) });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("fue descartada");
    expect(html).not.toContain("Filas válidas");
    expectCeroConsultasDeResultado(cliente);
  });

  it("CONFIRMADA sin confirmadaEn ni procesadaEn (viola el invariante de la transaccion de confirmar) -- estado inconsistente, sin consultar ObservacionCobertura", async () => {
    // Correccion de Alex (2026-11-06, antes del commit de PR1): antes de
    // esta correccion, clasificarImportacion() devolvia PROCESADA para
    // este caso -- esta importacion habria mostrado el resumen de filas y
    // la tabla como si todo hubiera salido bien. Ahora debe mostrar la
    // advertencia de estado inconsistente y nada mas, sin tocar
    // ObservacionCobertura para nada.
    const cliente = construirClienteFalso({ importacion: importacionBase({ confirmadaEn: null, procesadaEn: null }) });
    tenantClientMock.mockReturnValue(cliente);
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
    expectCeroConsultasDeResultado(cliente);
  });

  it("CONFIRMADA con procesadaEn pero SIN confirmadaEn -- tambien inconsistente, sin consultar ObservacionCobertura", async () => {
    const cliente = construirClienteFalso({
      importacion: importacionBase({ confirmadaEn: null, procesadaEn: new Date("2026-10-20T10:05:00.000Z") }),
    });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("estado inconsistente");
    expect(html).not.toContain("Filas válidas");
    expectCeroConsultasDeResultado(cliente);
  });

  it("importacion con error de job (estado ERROR) -- muestra el motivo, sin consultar ObservacionCobertura", async () => {
    // Este es exactamente el caso del incidente real (Alex, validacion
    // manual Windows 2026-11-06): una importacion ERROR NO debe disparar
    // ninguna consulta a ObservacionCobertura -- antes de esta
    // correccion, las disparaba igual, y un timeout transitorio del
    // driver en esas consultas (irrelevantes para este estado) tiraba
    // abajo toda la pagina.
    const cliente = construirClienteFalso({
      importacion: importacionBase({
        estado: "ERROR",
        procesadaEn: null,
        erroresMuestra: [{ numeroFila: 5, error: "Unidad de consumo invalida" }],
      }),
    });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("terminó en error");
    expect(html).toContain("Unidad de consumo invalida");
    expect(html).not.toContain("Filas válidas");
    expectCeroConsultasDeResultado(cliente);
  });
});

describe("DetalleImportacionCoberturaPage -- PROCESADA (consulta y muestra resultados)", () => {
  it("PROCESADA sin ninguna fila persistida -- estado vacio explicito, nunca una tabla vacia muda, con las 4 consultas llamadas", async () => {
    const cliente = construirClienteFalso({ importacion: importacionBase({ filasDetectadas: 0 }) });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("no generó ninguna fila de resultado");
    expect(cliente.__mocks.groupByMock).toHaveBeenCalledTimes(1);
    expect(cliente.__mocks.countMock).toHaveBeenCalledTimes(1);
    expect(cliente.__mocks.aggregateMock).toHaveBeenCalledTimes(1);
    expect(cliente.__mocks.findManyMock).toHaveBeenCalledTimes(1);
  });

  it("importacion procesada con filas mixtas -- resumen correcto y filas por SKU con su estado/motivo", async () => {
    const cliente = construirClienteFalso({
      importacion: importacionBase(),
      porEstado: [
        { estado: "CALCULADA", _count: { _all: 2 } },
        { estado: "DATOS_INCOMPLETOS", _count: { _all: 1 } },
      ],
      calculadaConCeroDias: 1,
      rangoMin: new Date("2026-10-01T00:00:00.000Z"),
      rangoMax: new Date("2026-10-01T00:00:00.000Z"),
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
    });
    tenantClientMock.mockReturnValue(cliente);
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
    // totalFilasPersistidas (3) se derivo de sumar los grupos del
    // groupBy (2 + 1), no de un count() aparte -- la diferencia con
    // filasDetectadas (3 en importacionBase()) es 0, asi que el aviso de
    // "la diferencia corresponde a..." no debe aparecer.
    expect(html).not.toContain("El archivo traía");
  });

  it("totalFilasPersistidas (derivado del groupBy) supera el tope de la tabla -- avisa que muestra solo una parte, sin mentir el resumen", async () => {
    const cliente = construirClienteFalso({
      importacion: importacionBase({ filasDetectadas: 600 }),
      porEstado: [{ estado: "CALCULADA", _count: { _all: 600 } }],
      calculadaConCeroDias: 0,
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
    });
    tenantClientMock.mockReturnValue(cliente);
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("Mostrando las primeras");
    expect(html).toContain("600");
  });
});

describe("DetalleImportacionCoberturaPage -- fallo de lectura del resultado (recuperable, nunca confundido con el estado, logging por allowlist)", () => {
  // Nombrada igual que la clase real de @prisma/adapter-pg a proposito
  // -- constructor.name es exactamente lo que diagnosticoLecturaSeguro()
  // (src/infra/prisma/errores.ts) lee como `nombreClase`, y es uno de
  // los 3 campos que SI se permite loguear.
  class DriverAdapterError extends Error {}

  it("una consulta de resultado rechaza (ej. timeout del driver) -- muestra estado recuperable, con reintento, y el logger recibe SOLO la estructura por allowlist", async () => {
    // Reproduce el incidente real (Alex, validacion manual Windows
    // 2026-11-06): DriverAdapterError: Authentication timed out.
    const errorInterno = new DriverAdapterError("Authentication timed out");
    const cliente = construirClienteFalso({
      importacion: importacionBase(),
      fallarGroupBy: errorInterno,
    });
    tenantClientMock.mockReturnValue(cliente);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    expect(html).toContain("No se pudo cargar el resultado");
    expect(html).toContain("Intenta nuevamente");
    expect(html).toContain("Reintentar");
    // Nunca se filtra nada del error interno hacia la PANTALLA -- ni el
    // nombre de la clase ni el mensaje (aunque el nombre de clase SI se
    // permite loguear en el servidor, ver abajo).
    expect(html).not.toContain("DriverAdapterError");
    expect(html).not.toContain("Authentication timed out");
    // El fallo es de LECTURA, no del estado funcional de la importacion
    // -- el badge sigue diciendo "Procesada" (la importacion SI se
    // proceso de verdad, segun sus metadatos) en vez de caer a algun
    // estado de error inventado.
    expect(html).toContain(">Procesada<");
    // No se muestra ningun resumen ni tabla con datos parciales/viejos.
    expect(html).not.toContain("Filas válidas");
    // El logger SI recibe un diagnostico -- pero EXCLUSIVAMENTE la
    // estructura por allowlist (evento fijo, importId, nombreClase,
    // codigo), nunca el objeto `error`, su .message ni su .stack. El
    // CONTENIDO de cada valor tambien esta restringido (ver
    // src/infra/prisma/__tests__/errores.test.ts para esas pruebas
    // directas del helper) -- aca solo importa que el logger nunca vea
    // el error crudo.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [evento, contexto] = consoleErrorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(evento).toBe("COBERTURA_RESULTADO_LECTURA_FALLIDA");
    expect(contexto).toEqual({ importId: "import-1", nombreClase: "DriverAdapterError", codigo: null });
    consoleErrorSpy.mockRestore();
  });

  it("un error con secretos plantados en message/detail/hint/query/params/meta -- ninguna de esas cadenas llega a los argumentos del logger (allowlist real, no un volcado disimulado)", async () => {
    // A proposito, los secretos se plantan en TODOS los campos que un
    // error de Prisma/Postgres podria traer en la practica -- si
    // cualquiera de ellos se filtrara al logger (por ejemplo por un
    // JSON.stringify(error) accidental, o por volver a leer err.message
    // en algun lugar), esta prueba lo detecta.
    class DriverAdapterErrorConSecretos extends Error {
      code = "P2010";
      query = "SELECT dato_sensible FROM observacion_cobertura";
      params = ["parametro-confidencial"];
      detail = "postgresql://usuario:password-secreta@host/base";
      hint = "revisar password-secreta antes de reintentar";
      meta = {
        driverAdapterError: {
          cause: {
            kind: "postgres",
            originalCode: "28000",
            originalMessage: "SELECT dato_sensible WHERE parametro-confidencial = 1",
          },
        },
      };
    }
    const errorConSecretos = new DriverAdapterErrorConSecretos(
      "postgresql://usuario:password-secreta@host/base -- SELECT dato_sensible WHERE parametro-confidencial",
    );

    const cliente = construirClienteFalso({ importacion: importacionBase(), fallarGroupBy: errorConSecretos });
    tenantClientMock.mockReturnValue(cliente);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: DetalleImportacionCoberturaPage } = await import("../page");

    const elemento = (await DetalleImportacionCoberturaPage({ params: Promise.resolve({ id: "import-1" }) })) as ReactElement;
    const html = renderToStaticMarkup(elemento);

    const CADENAS_SECRETAS = [
      "password-secreta",
      "postgresql://usuario:password-secreta@host/base",
      "SELECT dato_sensible",
      "parametro-confidencial",
    ];

    const argumentosLogueados = JSON.stringify(consoleErrorSpy.mock.calls);
    for (const secreto of CADENAS_SECRETAS) {
      expect(argumentosLogueados).not.toContain(secreto);
      expect(html).not.toContain(secreto);
    }

    // El diagnostico igual se registro -- solo que con la estructura
    // segura: "DriverAdapterErrorConSecretos" no es un nombre de clase
    // de la lista cerrada (ver NOMBRES_CLASE_CONOCIDOS en
    // src/infra/prisma/errores.ts), asi que cae a "ERROR_DESCONOCIDO" en
    // vez de propagarse tal cual -- y "P2010" SI tiene el formato de un
    // codigo de Prisma, asi que pasa.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [, contexto] = consoleErrorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(contexto).toEqual({ importId: "import-1", nombreClase: "ERROR_DESCONOCIDO", codigo: "P2010" });

    expect(html).toContain("No se pudo cargar el resultado");
    consoleErrorSpy.mockRestore();
  });
});
