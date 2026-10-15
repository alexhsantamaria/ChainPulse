// Pruebas — formateo del gate macro/detalle (RF12/RF13). "Macro" debe ser
// literalmente un subconjunto de "detalle", nunca datos distintos.
// I2-34: sourceQuestionIds/ruleVersion se exponen solo en Detalle
// (minimizacion previa al desbloqueo/consentimiento, RF23 -- no una
// brecha). Contrato de error explicito (decision de Alex, 2026-10-15):
// trazabilidad ausente o corrupta lanza TrazabilidadHallazgoInvalidaError
// en vez de vaciarse silenciosamente a []. I2-34 exige al menos una
// pregunta de origen -- un arreglo VACIO (o con codigos vacios/blancos)
// NO satisface el contrato, aunque sea JSON estructuralmente valido, y
// por eso tambien lanza. Macro nunca lee estos campos, asi que sigue
// funcionando aunque el contexto detallado este danado.
import { describe, expect, it } from "vitest";
import { formatearHallazgoDetalle, formatearHallazgoMacro, TrazabilidadHallazgoInvalidaError } from "../formatearHallazgo";

const HALLAZGO = {
  dimension: "INTEGRACION" as const,
  estadoCategoria: "conciliacion manual",
  enunciado: "Compras, ventas y logistica concilian datos manualmente.",
  estadoEvidencia: "DECLARADO" as const,
  coberturaConfianza: 0.5,
  evidenciaFaltante: ["falta A", "falta B"],
  siguienteVerificacion: "Confirmar con el area de TI que fuente es la de referencia.",
  ruleVersion: "v2-preliminary",
  contextoSnapshot: { preguntaCodigos: ["Q4"] },
};

describe("formatearHallazgoMacro", () => {
  it("expone solo dimension/status/statement", () => {
    expect(formatearHallazgoMacro(HALLAZGO)).toEqual({
      dimension: "INTEGRACION",
      status: "conciliacion manual",
      statement: "Compras, ventas y logistica concilian datos manualmente.",
    });
  });

  it("I2-34: nunca incluye sourceQuestionIds ni ruleVersion, aunque el hallazgo original los tenga", () => {
    const macro = formatearHallazgoMacro(HALLAZGO);
    expect(macro).not.toHaveProperty("sourceQuestionIds");
    expect(macro).not.toHaveProperty("ruleVersion");
    expect(Object.keys(macro).sort()).toEqual(["dimension", "status", "statement"].sort());
  });

  it("I2-34: Macro sigue funcionando aunque contextoSnapshot/ruleVersion esten danados -- Macro no los lee", () => {
    for (const contextoSnapshot of [null, {}, { preguntaCodigos: "no-es-array" }, { preguntaCodigos: [1, 2] }]) {
      // Fixture sin anotar: HallazgoMacroParaFormatear solo exige
      // dimension/estadoCategoria/enunciado, pero en runtime Macro
      // siempre recibe el objeto completo (la fila real de HallazgoExpres
      // trae contextoSnapshot/ruleVersion aunque Macro no los use).
      const hallazgoDanado = { ...HALLAZGO, contextoSnapshot, ruleVersion: "" as unknown as string };
      const macro = formatearHallazgoMacro(hallazgoDanado);
      expect(macro).toEqual({
        dimension: "INTEGRACION",
        status: "conciliacion manual",
        statement: "Compras, ventas y logistica concilian datos manualmente.",
      });
    }
  });
});

describe("formatearHallazgoDetalle", () => {
  it("incluye todos los campos macro mas evidenceState/confidenceCoverage/missingEvidence/nextCheck", () => {
    const detalle = formatearHallazgoDetalle(HALLAZGO);
    expect(detalle).toMatchObject(formatearHallazgoMacro(HALLAZGO));
    expect(detalle.evidenceState).toBe("DECLARADO");
    expect(detalle.confidenceCoverage).toBe(0.5);
    expect(detalle.missingEvidence).toEqual(["falta A", "falta B"]);
    expect(detalle.nextCheck).toBe(HALLAZGO.siguienteVerificacion);
  });

  it("missingEvidence es un array vacio cuando evidenciaFaltante es un array vacio", () => {
    const detalle = formatearHallazgoDetalle({ ...HALLAZGO, evidenciaFaltante: [] });
    expect(detalle.missingEvidence).toEqual([]);
  });

  it("nextCheck es null cuando siguienteVerificacion es null", () => {
    const detalle = formatearHallazgoDetalle({ ...HALLAZGO, siguienteVerificacion: null });
    expect(detalle.nextCheck).toBeNull();
  });

  describe("I2-34 — sourceQuestionIds y ruleVersion", () => {
    it("expone ruleVersion y sourceQuestionIds leidos del hallazgo original", () => {
      const detalle = formatearHallazgoDetalle(HALLAZGO);
      expect(detalle.ruleVersion).toBe("v2-preliminary");
      expect(detalle.sourceQuestionIds).toEqual(["Q4"]);
    });

    it("preserva multiples sourceQuestionIds y su orden (caso real de ALINEACION: Q1,Q2,Q3)", () => {
      const detalle = formatearHallazgoDetalle({
        ...HALLAZGO,
        contextoSnapshot: { preguntaCodigos: ["Q1", "Q2", "Q3"] },
      });
      expect(detalle.sourceQuestionIds).toEqual(["Q1", "Q2", "Q3"]);
    });

    it("un arreglo preguntaCodigos VACIO NO satisface I2-34 -- lanza, no devuelve []", () => {
      expect(() => formatearHallazgoDetalle({ ...HALLAZGO, contextoSnapshot: { preguntaCodigos: [] } })).toThrow(
        TrazabilidadHallazgoInvalidaError,
      );
    });

    it("un codigo de pregunta vacio ('') lanza -- no se inventa ni se descarta silenciosamente", () => {
      expect(() =>
        formatearHallazgoDetalle({ ...HALLAZGO, contextoSnapshot: { preguntaCodigos: ["Q1", ""] } }),
      ).toThrow(TrazabilidadHallazgoInvalidaError);
    });

    it("un codigo de pregunta compuesto solo por espacios ('   ') lanza -- el trim es solo para detectar, nunca para normalizar", () => {
      expect(() =>
        formatearHallazgoDetalle({ ...HALLAZGO, contextoSnapshot: { preguntaCodigos: ["Q1", "   "] } }),
      ).toThrow(TrazabilidadHallazgoInvalidaError);
    });

    it("multiples IDs validos se preservan EXACTAMENTE y en el mismo orden, sin trim ni normalizacion", () => {
      const detalle = formatearHallazgoDetalle({
        ...HALLAZGO,
        contextoSnapshot: { preguntaCodigos: ["Q7", "Q3", "Q1", "Q5"] },
      });
      expect(detalle.sourceQuestionIds).toEqual(["Q7", "Q3", "Q1", "Q5"]);
    });

    it("los valores proceden del hallazgo original, nunca de literales reconstruidos -- dos fixtures distintos producen salidas distintas", () => {
      const d1 = formatearHallazgoDetalle({
        ...HALLAZGO,
        ruleVersion: "v2-preliminary",
        contextoSnapshot: { preguntaCodigos: ["Q4"] },
      });
      const d2 = formatearHallazgoDetalle({
        ...HALLAZGO,
        ruleVersion: "v3-futura",
        contextoSnapshot: { preguntaCodigos: ["Q5", "Q6"] },
      });
      expect(d1.ruleVersion).not.toBe(d2.ruleVersion);
      expect(d1.sourceQuestionIds).not.toEqual(d2.sourceQuestionIds);
      expect(d2.ruleVersion).toBe("v3-futura");
      expect(d2.sourceQuestionIds).toEqual(["Q5", "Q6"]);
    });

    it.each([
      ["contextoSnapshot es null", null],
      ["contextoSnapshot no es un objeto (string)", "no-es-un-objeto"],
      ["falta preguntaCodigos", {}],
      ["preguntaCodigos no es un arreglo", { preguntaCodigos: "no-es-array" }],
      ["preguntaCodigos esta vacio", { preguntaCodigos: [] }],
      ["preguntaCodigos contiene elementos no-string", { preguntaCodigos: ["Q1", 2, "Q3"] }],
      ["preguntaCodigos contiene un codigo vacio", { preguntaCodigos: ["Q1", ""] }],
      ["preguntaCodigos contiene un codigo solo de espacios", { preguntaCodigos: ["Q1", "   "] }],
    ])(
      "contexto invalido (%s) lanza TrazabilidadHallazgoInvalidaError -- NUNCA devuelve [] silenciosamente",
      (_descripcion, contextoSnapshot) => {
        expect(() => formatearHallazgoDetalle({ ...HALLAZGO, contextoSnapshot })).toThrow(
          TrazabilidadHallazgoInvalidaError,
        );
      },
    );

    it.each([
      ["ruleVersion ausente (undefined)", undefined],
      ["ruleVersion null", null],
      ["ruleVersion vacio", ""],
      ["ruleVersion de tipo incorrecto (numero)", 2],
    ])("ruleVersion invalido (%s) lanza TrazabilidadHallazgoInvalidaError", (_descripcion, ruleVersion) => {
      expect(() => formatearHallazgoDetalle({ ...HALLAZGO, ruleVersion: ruleVersion as unknown as string })).toThrow(
        TrazabilidadHallazgoInvalidaError,
      );
    });

    it("ruleVersion preserva el valor HISTORICO persistido, nunca la version vigente del motor ni un valor por defecto", () => {
      // "v1-ya-retirada" es deliberadamente distinta de RULE_VERSION_V2
      // ("v2-preliminary", src/engine/v2/constantes.ts) para demostrar que
      // no hay sustitucion por la version vigente del motor.
      const detalle = formatearHallazgoDetalle({ ...HALLAZGO, ruleVersion: "v1-ya-retirada" });
      expect(detalle.ruleVersion).toBe("v1-ya-retirada");
      expect(detalle.ruleVersion).not.toBe("v2-preliminary");
    });

    it("Detalle nunca devuelve trazabilidad fabricada ni silenciosamente vacia ante datos danados", () => {
      // Si el contrato fuera "silenciar a []", esta llamada devolveria
      // sourceQuestionIds: [] en vez de lanzar -- lo que haria parecer
      // cumplida la trazabilidad de I2-34 sobre un dato corrupto.
      expect(() => formatearHallazgoDetalle({ ...HALLAZGO, contextoSnapshot: { preguntaCodigos: [null, undefined] } })).toThrow(
        TrazabilidadHallazgoInvalidaError,
      );
    });

    it("el mensaje de TrazabilidadHallazgoInvalidaError es fijo/categorico -- NUNCA interpola el contenido recibido (ni contextoSnapshot ni ruleVersion)", () => {
      const MARCADOR_SECRETO = "SECRETO-NO-DEBE-APARECER-EN-EL-MENSAJE-abc123";

      let errorDeContexto: unknown;
      try {
        formatearHallazgoDetalle({ ...HALLAZGO, contextoSnapshot: MARCADOR_SECRETO });
      } catch (err) {
        errorDeContexto = err;
      }
      expect(errorDeContexto).toBeInstanceOf(TrazabilidadHallazgoInvalidaError);
      expect((errorDeContexto as Error).message).not.toContain(MARCADOR_SECRETO);
      expect((errorDeContexto as Error).message).toBe(
        "HallazgoDetalle: trazabilidad persistida invalida -- contextoSnapshot no es un objeto. No se fabrica ni se vacia silenciosamente (I2-34).",
      );

      let errorDeRuleVersion: unknown;
      try {
        formatearHallazgoDetalle({
          ...HALLAZGO,
          ruleVersion: { estoEsUnObjeto: MARCADOR_SECRETO } as unknown as string,
        });
      } catch (err) {
        errorDeRuleVersion = err;
      }
      expect(errorDeRuleVersion).toBeInstanceOf(TrazabilidadHallazgoInvalidaError);
      expect((errorDeRuleVersion as Error).message).not.toContain(MARCADOR_SECRETO);
      expect((errorDeRuleVersion as Error).message).toBe(
        "HallazgoDetalle: trazabilidad persistida invalida -- ruleVersion ausente o invalido. No se fabrica ni se vacia silenciosamente (I2-34).",
      );

      // Los 11 mensajes posibles de la categoria son fijos y conocidos de
      // antemano -- ninguno depende del valor recibido, solo de CUAL
      // validacion fallo.
      const mensajesPosibles = [
        "contextoSnapshot no es un objeto",
        "contextoSnapshot.preguntaCodigos ausente",
        "contextoSnapshot.preguntaCodigos no es un arreglo",
        "contextoSnapshot.preguntaCodigos esta vacio -- I2-34 exige al menos una pregunta de origen",
        "contextoSnapshot.preguntaCodigos contiene elementos no-string",
        "contextoSnapshot.preguntaCodigos contiene un codigo vacio o compuesto solo de espacios",
        "ruleVersion ausente o invalido",
      ];
      expect((errorDeContexto as Error).message).toContain(mensajesPosibles[0]);
      expect((errorDeRuleVersion as Error).message).toContain(mensajesPosibles[6]);
    });
  });
});
