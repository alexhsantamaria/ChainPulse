// Pruebas — envoltorio de fetch sobre los 5 endpoints publicos. Mockea
// global.fetch (vi.stubGlobal), sin red real.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completarEvaluacion,
  crearEvaluacion,
  desbloquearDetalle,
  enviarRespuesta,
  obtenerResultado,
} from "../api";

function mockFetchUnaVez(respuesta: { status: number; cuerpo: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: respuesta.status >= 200 && respuesta.status < 300,
    status: respuesta.status,
    json: async () => respuesta.cuerpo,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crearEvaluacion", () => {
  it("devuelve ok:true con los datos cuando la API responde bien", async () => {
    mockFetchUnaVez({ status: 200, cuerpo: { ok: true, evaluacionExpresV2Id: "e1", preguntas: [] } });
    const resultado = await crearEvaluacion({ productoServicio: "X", tipoOperacion: "servicios" });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.datos.evaluacionExpresV2Id).toBe("e1");
    }
  });

  it("propaga el codigo de error cuando la API responde ok:false", async () => {
    mockFetchUnaVez({ status: 429, cuerpo: { ok: false, error: "LIMITE_TASA_EXCEDIDO" } });
    const resultado = await crearEvaluacion({ productoServicio: "X", tipoOperacion: "servicios" });
    expect(resultado).toEqual({ ok: false, error: "LIMITE_TASA_EXCEDIDO", status: 429, preguntasFaltantes: undefined });
  });

  it("devuelve SIN_CONEXION si fetch lanza (sin red)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const resultado = await crearEvaluacion({ productoServicio: "X", tipoOperacion: "servicios" });
    expect(resultado).toEqual({ ok: false, error: "SIN_CONEXION", status: 0 });
  });
});

describe("enviarRespuesta", () => {
  it("envia codigoPregunta y opcionValor en el body, por POST", async () => {
    const fetchMock = mockFetchUnaVez({ status: 200, cuerpo: { ok: true, codigoPregunta: "Q1" } });
    await enviarRespuesta("eval-1", { codigoPregunta: "Q1", opcionValor: "a" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/evaluations/eval-1/answers",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ codigoPregunta: "Q1", opcionValor: "a" }) }),
    );
  });
});

describe("completarEvaluacion", () => {
  it("devuelve preguntasFaltantes cuando la API lo informa", async () => {
    mockFetchUnaVez({ status: 400, cuerpo: { ok: false, error: "PREGUNTAS_INCOMPLETAS", preguntasFaltantes: ["Q7"] } });
    const resultado = await completarEvaluacion("eval-1");
    expect(resultado).toEqual({ ok: false, error: "PREGUNTAS_INCOMPLETAS", status: 400, preguntasFaltantes: ["Q7"] });
  });
});

describe("obtenerResultado", () => {
  it("hace un GET a la ruta de resultado", async () => {
    const fetchMock = mockFetchUnaVez({ status: 200, cuerpo: { ok: true, detalleDesbloqueado: false, hallazgos: [] } });
    await obtenerResultado("eval-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/public/evaluations/eval-1/result", { method: "GET" });
  });
});

describe("desbloquearDetalle", () => {
  it("envia los datos de contacto y consentimientos por POST", async () => {
    const fetchMock = mockFetchUnaVez({ status: 200, cuerpo: { ok: true, detalleDesbloqueado: true } });
    await desbloquearDetalle("eval-1", {
      correo: "a@b.com",
      nombreCompleto: "A B",
      empresaNombre: "ACME",
      consentimientoDiagnostico: true,
      consentimientoInvestigacion: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/evaluations/eval-1/unlock",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
