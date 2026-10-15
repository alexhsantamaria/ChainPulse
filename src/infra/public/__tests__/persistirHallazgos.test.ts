// Pruebas — procedencia canonica de sourceQuestionIds/ruleVersion (I2-34).
// Demuestra, con el CODIGO REAL de persistirHallazgos.ts y
// formatearHallazgo.ts (nada reimplementado aqui), la cadena exacta:
//
//   DiagnosticFinding.sourceQuestionIds
//     -> persistirHallazgos.ts (construirContextoSnapshot)
//     -> contextoSnapshot.preguntaCodigos  (UNICA representacion persistida)
//     -> extraerSourceQuestionIds
//     -> HallazgoDetalle.sourceQuestionIds (respuesta HTTP)
//
// Usa valores DISTINTOS y RECONOCIBLES en cada capa ("Q-CANON-*",
// "v-canon-historica-7") para que cualquier mezcla, aproximacion o
// reconstruccion con literales sea detectable de inmediato.
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { DiagnosticFinding } from "@/domain/types";
import { persistirHallazgos, type ContextoEvaluacion } from "../persistirHallazgos";
import { formatearHallazgoDetalle, TrazabilidadHallazgoInvalidaError } from "../formatearHallazgo";

// Deliberadamente distinta de RULE_VERSION_V2 ("v2-preliminary",
// src/engine/v2/constantes.ts) -- si el formateador reconstruyera
// ruleVersion desde la constante vigente del motor en vez de preservar el
// valor historico persistido, esta prueba lo detectaria.
const FINDING: DiagnosticFinding = {
  dimension: "ALINEACION",
  status: "aplicada parcialmente",
  statement: "enunciado de prueba de procedencia canonica",
  sourceQuestionIds: ["Q-CANON-1", "Q-CANON-2", "Q-CANON-3"],
  evidenceState: "DECLARADO",
  confidenceCoverage: 0.75,
  missingEvidence: [],
  nextCheck: "verificacion de prueba de procedencia",
  ruleVersion: "v-canon-historica-7",
};

const CONTEXTO: ContextoEvaluacion = {
  pais: "PE",
  region: null,
  sector: null,
  subsector: null,
  rangoTamano: null,
  rolParticipante: null,
};

function construirTxFake() {
  const creaciones: Array<{ data: Record<string, unknown> }> = [];
  const tx = {
    hallazgoExpres: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        creaciones.push({ data });
        return { id: "hallazgo-fake-1", createdAt: new Date(), ...data };
      }),
    },
    hallazgoExpresTraza: {
      create: vi.fn(async () => ({ id: "traza-fake-1" })),
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, creaciones };
}

describe("procedencia canonica de sourceQuestionIds y ruleVersion (I2-34)", () => {
  it("contextoSnapshot.preguntaCodigos, tal como lo escribe persistirHallazgos.ts, es EXACTAMENTE finding.sourceQuestionIds -- contenido y orden, sin aproximacion", async () => {
    const { tx, creaciones } = construirTxFake();

    await persistirHallazgos(tx, "eval-1", [FINDING], {}, CONTEXTO);

    expect(creaciones).toHaveLength(1);
    // Extraccion explicita + guard: si no hay una creacion capturada, esto
    // falla de forma ruidosa en vez de comparar permisivamente contra
    // undefined.
    const creacion = creaciones[0];
    expect(creacion).toBeDefined();
    if (!creacion) {
      throw new Error("creaciones[0] inesperadamente ausente");
    }
    const contextoPersistido = creacion.data.contextoSnapshot as { preguntaCodigos: unknown };
    expect(contextoPersistido.preguntaCodigos).toEqual(FINDING.sourceQuestionIds);
    expect(creacion.data.ruleVersion).toBe(FINDING.ruleVersion);
  });

  it("cadena completa: DiagnosticFinding -> persistirHallazgos (real) -> contextoSnapshot persistido -> formatearHallazgoDetalle (real) -> HallazgoDetalle HTTP", async () => {
    const { tx, creaciones } = construirTxFake();

    await persistirHallazgos(tx, "eval-1", [FINDING], {}, CONTEXTO);

    // Lo que de verdad quedo persistido -- no una reconstruccion de la
    // prueba, sino la `data` real pasada a tx.hallazgoExpres.create por
    // persistirHallazgos.ts.
    const creacion = creaciones[0];
    expect(creacion).toBeDefined();
    if (!creacion) {
      throw new Error("creaciones[0] inesperadamente ausente");
    }
    const filaPersistida = creacion.data;

    const detalle = formatearHallazgoDetalle({
      dimension: filaPersistida.dimension as DiagnosticFinding["dimension"],
      estadoCategoria: filaPersistida.estadoCategoria as string,
      enunciado: filaPersistida.enunciado as string,
      estadoEvidencia: filaPersistida.estadoEvidencia as DiagnosticFinding["evidenceState"],
      coberturaConfianza: filaPersistida.coberturaConfianza as number,
      evidenciaFaltante: filaPersistida.evidenciaFaltante as string[],
      siguienteVerificacion: filaPersistida.siguienteVerificacion as string | null,
      ruleVersion: filaPersistida.ruleVersion as string,
      contextoSnapshot: filaPersistida.contextoSnapshot,
    });

    // Los IDs y la version de regla en la respuesta HTTP son exactamente
    // los del DiagnosticFinding original -- misma identidad de contenido
    // y de orden, pasando por la persistencia real, no por un atajo.
    expect(detalle.sourceQuestionIds).toEqual(FINDING.sourceQuestionIds);
    expect(detalle.ruleVersion).toBe(FINDING.ruleVersion);
    expect(detalle.ruleVersion).not.toBe("v2-preliminary"); // no se sustituye por la version vigente del motor
  });

  it("persistencia historica vs. contrato publico de Detalle: DiagnosticFinding.sourceQuestionIds=[] se persiste tal cual (compatibilidad historica), pero formatearHallazgoDetalle lo RECHAZA como incumplimiento de I2-34", async () => {
    const findingSinPreguntas: DiagnosticFinding = { ...FINDING, sourceQuestionIds: [] };
    const { tx, creaciones } = construirTxFake();

    // La capa de persistencia no valida contenido -- es un passthrough
    // deliberado (ver persistirHallazgos.ts) que conserva lo que el motor
    // produjo, sea lo que sea, por compatibilidad historica con datos ya
    // calculados.
    await persistirHallazgos(tx, "eval-1", [findingSinPreguntas], {}, CONTEXTO);
    const creacion = creaciones[0];
    expect(creacion).toBeDefined();
    if (!creacion) {
      throw new Error("creaciones[0] inesperadamente ausente");
    }
    const filaPersistida = creacion.data;
    const contextoPersistido = filaPersistida.contextoSnapshot as { preguntaCodigos: unknown };
    expect(contextoPersistido.preguntaCodigos).toEqual([]);

    // Pero el contrato PUBLICO de HallazgoDetalle (I2-34: "todo hallazgo
    // referencia las preguntas de origen") es mas estricto que lo que la
    // persistencia tolera -- la respuesta HTTP nunca presenta como valida
    // una trazabilidad vacia, aunque ese sea el dato historico guardado.
    expect(() =>
      formatearHallazgoDetalle({
        dimension: filaPersistida.dimension as DiagnosticFinding["dimension"],
        estadoCategoria: filaPersistida.estadoCategoria as string,
        enunciado: filaPersistida.enunciado as string,
        estadoEvidencia: filaPersistida.estadoEvidencia as DiagnosticFinding["evidenceState"],
        coberturaConfianza: filaPersistida.coberturaConfianza as number,
        evidenciaFaltante: filaPersistida.evidenciaFaltante as string[],
        siguienteVerificacion: filaPersistida.siguienteVerificacion as string | null,
        ruleVersion: filaPersistida.ruleVersion as string,
        contextoSnapshot: filaPersistida.contextoSnapshot,
      }),
    ).toThrow(TrazabilidadHallazgoInvalidaError);
  });

  it("contextoSnapshot.preguntaCodigos es la UNICA representacion persistida de sourceQuestionIds -- HallazgoExpresTraza.respuestaIds guarda otra cosa (ids de Respuesta, no codigos de pregunta)", async () => {
    const { tx, creaciones } = construirTxFake();
    const respuestaIdPorCodigo = { "Q-CANON-1": "resp-id-1", "Q-CANON-2": "resp-id-2", "Q-CANON-3": "resp-id-3" };

    await persistirHallazgos(tx, "eval-1", [FINDING], respuestaIdPorCodigo, CONTEXTO);

    const trazaCreateMock = (tx as unknown as { hallazgoExpresTraza: { create: ReturnType<typeof vi.fn> } })
      .hallazgoExpresTraza.create;
    expect(trazaCreateMock).toHaveBeenCalledWith({
      data: { hallazgoExpresId: "hallazgo-fake-1", respuestaIds: ["resp-id-1", "resp-id-2", "resp-id-3"] },
    });
    // Confirmado: son valores DISTINTOS (ids reales de Respuesta) de
    // contextoSnapshot.preguntaCodigos (codigos de catalogo "Q-CANON-*").
    const creacion = creaciones[0];
    expect(creacion).toBeDefined();
    if (!creacion) {
      throw new Error("creaciones[0] inesperadamente ausente");
    }
    const contextoPersistido = creacion.data.contextoSnapshot as { preguntaCodigos: unknown };
    expect(contextoPersistido.preguntaCodigos).toEqual(["Q-CANON-1", "Q-CANON-2", "Q-CANON-3"]);
  });
});
