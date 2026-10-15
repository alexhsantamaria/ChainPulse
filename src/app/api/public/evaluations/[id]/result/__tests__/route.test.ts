// Pruebas — GET .../result (RF12/RF13, gate macro/detalle). I2-34:
// confirma que Detalle expone sourceQuestionIds/ruleVersion y que Macro
// (pre-desbloqueo) nunca los expone.
//
// Seccion "comportamiento HTTP ante TrazabilidadHallazgoInvalidaError":
// confirma el contrato de error aplicado por autorizacion de Alex
// (2026-10-15) -- un try/catch alrededor UNICAMENTE de la construccion/
// formateo de la respuesta, que convierte cualquier fallo de formateo en
// la respuesta controlada estandar del proyecto (500,
// {ok:false,error:"ERROR_INTERNO"}), igual que complete/route.ts y
// unlock/route.ts. Mismo criterio de mock que
// src/app/api/kpis/otif/observaciones/__tests__/route.test.ts.
import { describe, expect, it, vi, beforeEach } from "vitest";

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
vi.mock("@/infra/prisma/client", () => ({
  prisma: {
    evaluacionExpresV2: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    respuesta: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
  },
}));

const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...args: unknown[]) => captureExceptionMock(...args) }));

const logErrorMock = vi.fn();
vi.mock("@/infra/log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

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

beforeEach(() => {
  vi.clearAllMocks();
  findFirstMock.mockResolvedValue(null); // q1IndiceOpcion = null, no afecta el formateo
});

describe("GET /result -- gate macro/detalle (I2-34)", () => {
  it("detalleDesbloqueado=false: la respuesta usa Macro, sin sourceQuestionIds ni ruleVersion en ningun hallazgo", async () => {
    findUniqueMock.mockResolvedValue({ detalleDesbloqueado: false, hallazgos: HALLAZGOS });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "e1" }) });
    expect(respuesta.status).toBe(200);
    const body = await respuesta.json();
    expect(body.detalleDesbloqueado).toBe(false);
    expect(body.hallazgos).toHaveLength(5);
    for (const h of body.hallazgos) {
      expect(h).not.toHaveProperty("sourceQuestionIds");
      expect(h).not.toHaveProperty("ruleVersion");
      expect(Object.keys(h).sort()).toEqual(["dimension", "status", "statement"].sort());
    }
  });

  it("detalleDesbloqueado=true, trazabilidad valida: 200, y TODOS los hallazgos (no solo el primero) exponen sourceQuestionIds y ruleVersion", async () => {
    findUniqueMock.mockResolvedValue({ detalleDesbloqueado: true, hallazgos: HALLAZGOS });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "e1" }) });
    expect(respuesta.status).toBe(200);
    const body = await respuesta.json();
    expect(body.ok).toBe(true);
    expect(body.detalleDesbloqueado).toBe(true);
    expect(body.hallazgos).toHaveLength(5);
    for (const h of body.hallazgos) {
      expect(Array.isArray(h.sourceQuestionIds)).toBe(true);
      expect(h.sourceQuestionIds.length).toBeGreaterThan(0);
      expect(h.ruleVersion).toBe("v2-preliminary");
    }
    const alineacion = body.hallazgos.find((h: { dimension: string }) => h.dimension === "ALINEACION");
    expect(alineacion.sourceQuestionIds).toEqual(["Q1", "Q2", "Q3"]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

describe("GET /result -- contrato de error HTTP ante TrazabilidadHallazgoInvalidaError (autorizado 2026-10-15)", () => {
  // El elemento corrupto NUNCA es el primero del listado -- asi se
  // demuestra que ningun hallazgo valido anterior se filtra en una
  // respuesta parcial: el fallo de CUALQUIER elemento descarta la
  // respuesta completa (NextResponse.json nunca llega a construirse; el
  // catch devuelve la respuesta de error ANTES de serializar nada).
  function construirHallazgosConCorrupcionEnPosicion2(contextoSnapshotCorrupto: unknown, ruleVersionCorrupta?: unknown) {
    // Extraccion explicita + guard (en vez de encadenamiento opcional) --
    // si la fixture HALLAZGOS[1] no existiera, esto falla de forma ruidosa
    // en vez de construir silenciosamente un hallazgo corrupto distinto
    // del que la prueba dice estar corrompiendo.
    const hallazgoBase = HALLAZGOS[1];
    expect(hallazgoBase).toBeDefined();
    if (!hallazgoBase) {
      throw new Error("fixture HALLAZGOS[1] inesperadamente ausente");
    }
    return [
      HALLAZGOS[0],
      {
        ...hallazgoBase,
        contextoSnapshot: contextoSnapshotCorrupto ?? hallazgoBase.contextoSnapshot,
        ruleVersion: ruleVersionCorrupta ?? hallazgoBase.ruleVersion,
      },
      HALLAZGOS[2],
      HALLAZGOS[3],
      HALLAZGOS[4],
    ];
  }

  async function ejecutarYVerificarError(hallazgosConCorrupcion: unknown[]) {
    findUniqueMock.mockResolvedValue({ detalleDesbloqueado: true, hallazgos: hallazgosConCorrupcion });
    const { GET } = await import("../route");

    // La promesa de GET ya NO rechaza -- resuelve con una NextResponse.
    const respuesta = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "e1" }) });

    expect(respuesta.status).toBe(500);
    const body = await respuesta.json();

    // Formato estandar EXACTO -- ninguna clave adicional.
    expect(body).toEqual({ ok: false, error: "ERROR_INTERNO" });
    expect(Object.keys(body).sort()).toEqual(["error", "ok"]);

    // Nunca se filtra nada interno en el body HTTP.
    const bodyComoTexto = JSON.stringify(body);
    expect(bodyComoTexto).not.toContain("contextoSnapshot");
    expect(bodyComoTexto).not.toContain("preguntaCodigos");
    expect(bodyComoTexto).not.toContain("sourceQuestionIds");
    expect(bodyComoTexto).not.toContain("ruleVersion");
    expect(bodyComoTexto).not.toContain("Q1"); // ningun codigo de pregunta
    expect(bodyComoTexto).not.toContain("stack");
    expect(bodyComoTexto).not.toContain("TrazabilidadHallazgoInvalidaError");
    expect(bodyComoTexto).not.toContain("trazabilidad persistida invalida"); // mensaje interno del error

    // Sentry y logError se invocan cada uno EXACTAMENTE una vez.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    // Extraccion explicita + guard: si captureException no fue invocado
    // con argumentos, esto falla de forma ruidosa en vez de comparar
    // permisivamente contra undefined.
    const llamadaCaptureException = captureExceptionMock.mock.calls[0];
    expect(llamadaCaptureException).toBeDefined();
    if (!llamadaCaptureException) {
      throw new Error("captureException no fue invocado con argumentos");
    }
    expect(llamadaCaptureException[0]).toBeInstanceOf(Error);
    expect(llamadaCaptureException[0].name).toBe("TrazabilidadHallazgoInvalidaError");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith("api/public/evaluations/[id]/result GET", expect.any(Error));

    return respuesta;
  }

  it("Detalle con contextoSnapshot ausente (forma invalida) -> 500 + {ok:false,error:'ERROR_INTERNO'}, sin respuesta parcial", async () => {
    await ejecutarYVerificarError(construirHallazgosConCorrupcionEnPosicion2({}));
  });

  it("Detalle con preguntaCodigos vacio (arreglo vacio, I2-34) -> mismo 500 controlado", async () => {
    await ejecutarYVerificarError(construirHallazgosConCorrupcionEnPosicion2({ preguntaCodigos: [] }));
  });

  it("Detalle con ruleVersion invalida (vacia) -> mismo 500 controlado", async () => {
    await ejecutarYVerificarError(construirHallazgosConCorrupcionEnPosicion2(undefined, ""));
  });

  it("Macro con el mismo contexto danado (preguntaCodigos ausente) -> 200, Macro conserva EXACTAMENTE su contrato redactado (Macro no procesa trazabilidad)", async () => {
    findUniqueMock.mockResolvedValue({
      detalleDesbloqueado: false, // Macro: nunca lee contextoSnapshot/ruleVersion
      hallazgos: construirHallazgosConCorrupcionEnPosicion2({}, "" as unknown),
    });
    const { GET } = await import("../route");
    const respuesta = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "e1" }) });

    expect(respuesta.status).toBe(200);
    const body = await respuesta.json();
    expect(body.ok).toBe(true);
    expect(body.hallazgos).toHaveLength(5);
    for (const h of body.hallazgos) {
      expect(Object.keys(h).sort()).toEqual(["dimension", "status", "statement"].sort());
      expect(h).not.toHaveProperty("sourceQuestionIds");
      expect(h).not.toHaveProperty("ruleVersion");
    }
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
