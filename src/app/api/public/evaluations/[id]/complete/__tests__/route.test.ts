// Pruebas — POST .../complete (RF21/RF22, idempotente). I2-34: confirma
// que esta ruta sigue devolviendo Macro puro (sin sourceQuestionIds ni
// ruleVersion) en ambas ramas, incluso cuando detalleDesbloqueado ya es
// true -- esta ruta nunca debe filtrar Detalle. Mismo criterio de mock
// que src/app/api/kpis/otif/observaciones/__tests__/route.test.ts.
import { describe, expect, it, vi, beforeEach } from "vitest";

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const transactionMock = vi.fn();
vi.mock("@/infra/prisma/client", () => ({
  prisma: {
    evaluacionExpresV2: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    respuesta: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const calcularDiagnosticoV2Mock = vi.fn();
vi.mock("@/engine/v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/v2")>();
  return { ...actual, calcularDiagnosticoV2: (...args: unknown[]) => calcularDiagnosticoV2Mock(...args) };
});

const construirRespuestasV2Mock = vi.fn();
vi.mock("@/infra/public/construirRespuestasV2", () => ({
  construirRespuestasV2: (...args: unknown[]) => construirRespuestasV2Mock(...args),
}));

const persistirHallazgosMock = vi.fn();
vi.mock("@/infra/public/persistirHallazgos", () => ({
  persistirHallazgos: (...args: unknown[]) => persistirHallazgosMock(...args),
}));

function construirHallazgo(dimension: string, codigos: string[]) {
  return {
    id: `h-${dimension}`,
    dimension,
    estadoCategoria: "estado-de-prueba",
    enunciado: `enunciado-${dimension}`,
    estadoEvidencia: "DECLARADO",
    coberturaConfianza: 0.5,
    evidenciaFaltante: [],
    siguienteVerificacion: null,
    ruleVersion: "v2-preliminary",
    contextoSnapshot: { preguntaCodigos: codigos },
  };
}

const HALLAZGOS = [
  construirHallazgo("ALINEACION", ["Q1", "Q2", "Q3"]),
  construirHallazgo("COORDINACION", ["Q4"]),
  construirHallazgo("INTEGRACION", ["Q5"]),
  construirHallazgo("EVIDENCIA", ["Q6"]),
  construirHallazgo("RESILIENCIA", ["Q7"]),
];

function expectMacroPuro(hallazgos: Array<Record<string, unknown>>) {
  expect(hallazgos).toHaveLength(5);
  for (const h of hallazgos) {
    expect(h).not.toHaveProperty("sourceQuestionIds");
    expect(h).not.toHaveProperty("ruleVersion");
    expect(Object.keys(h).sort()).toEqual(["dimension", "status", "statement"].sort());
  }
}

function construirRequest(): Request {
  return new Request("http://localhost/x", { method: "POST", body: "{}" });
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirstMock.mockResolvedValue(null);
});

describe("POST /complete -- I2-34: siempre Macro puro, aun con detalleDesbloqueado=true", () => {
  it("rama idempotente (ya completada, detalleDesbloqueado=true): respuesta Macro pura", async () => {
    findUniqueMock.mockResolvedValue({
      cuestionarioVersion: { preguntas: [] },
      respuestas: [],
      hallazgos: HALLAZGOS,
      detalleDesbloqueado: true,
    });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(), { params: Promise.resolve({ id: "e1" }) });
    const body = await respuesta.json();
    expect(body.yaCompletada).toBe(true);
    expectMacroPuro(body.hallazgos);
  });

  it("rama recien creada: respuesta Macro pura", async () => {
    findUniqueMock.mockResolvedValue({
      cuestionarioVersion: { preguntas: [] },
      respuestas: [],
      hallazgos: [],
      detalleDesbloqueado: false,
    });
    construirRespuestasV2Mock.mockReturnValue({ respuestasV2: [], respuestaIdPorCodigo: {}, preguntasFaltantes: [] });
    calcularDiagnosticoV2Mock.mockReturnValue([]);
    transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
    persistirHallazgosMock.mockResolvedValue(HALLAZGOS);

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(), { params: Promise.resolve({ id: "e1" }) });
    const body = await respuesta.json();
    expect(body.yaCompletada).toBe(false);
    expectMacroPuro(body.hallazgos);
  });
});
