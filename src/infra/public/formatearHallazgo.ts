// Infraestructura publica — formatea un HallazgoExpres ya persistido para
// la respuesta HTTP, aplicando el gate macro/detalle (RF12/RF13: capa de
// presentacion, nunca de computo -- ver ADR-0001). "Macro" es literalmente
// un subconjunto de campos de "detalle", nunca datos distintos.
import type { DimensionDiagnosticoV2, EstadoEvidenciaV2 } from "@/domain/types";

// I2-34: contrato minimo -- unicamente los campos que
// formatearHallazgoMacro necesita. No incluye ruleVersion ni
// contextoSnapshot: Macro nunca los lee.
interface HallazgoMacroParaFormatear {
  dimension: DimensionDiagnosticoV2;
  estadoCategoria: string;
  enunciado: string;
}

// I2-34: contrato estricto que SOLO formatearHallazgoDetalle acepta.
// ruleVersion y contextoSnapshot ya existen como columnas reales de
// HallazgoExpres, escritas 1:1 desde DiagnosticFinding por
// persistirHallazgos.ts (ver TrazabilidadHallazgoInvalidaError abajo).
interface HallazgoDetalleParaFormatear extends HallazgoMacroParaFormatear {
  estadoEvidencia: EstadoEvidenciaV2;
  coberturaConfianza: number;
  evidenciaFaltante: string[];
  siguienteVerificacion: string | null;
  ruleVersion: string;
  contextoSnapshot: unknown;
}

// I2-34: Macro omite deliberadamente sourceQuestionIds/ruleVersion -- es
// minimizacion previa al desbloqueo/consentimiento (RF23), no una brecha.
// Esos campos solo se exponen en Detalle, tras el consentimiento.
export interface HallazgoMacro {
  dimension: DimensionDiagnosticoV2;
  status: string;
  statement: string;
}

export interface HallazgoDetalle extends HallazgoMacro {
  evidenceState: EstadoEvidenciaV2;
  confidenceCoverage: number;
  missingEvidence: string[];
  nextCheck: string | null;
  sourceQuestionIds: string[];
  ruleVersion: string;
}

// I2-34 — contrato de error explicito (decision de Alex, 2026-10-15):
// si la trazabilidad persistida (contextoSnapshot.preguntaCodigos o
// ruleVersion) no tiene la forma que persistirHallazgos.ts garantiza,
// NUNCA se sustituye silenciosamente por [] ni por un valor por
// defecto -- eso haria parecer cumplida la trazabilidad de I2-34 sobre
// datos ausentes o corruptos. formatearHallazgoDetalle lanza esta
// excepcion y no construye el objeto; formatearHallazgoMacro (que no lee
// ninguno de los dos campos) sigue funcionando sin cambios.
export class TrazabilidadHallazgoInvalidaError extends Error {
  constructor(motivo: string) {
    super(
      `HallazgoDetalle: trazabilidad persistida invalida -- ${motivo}. ` +
        "No se fabrica ni se vacia silenciosamente (I2-34).",
    );
    this.name = "TrazabilidadHallazgoInvalidaError";
  }
}

/**
 * Extrae sourceQuestionIds desde contextoSnapshot.preguntaCodigos -- la
 * UNICA representacion persistida de sourceQuestionIds (HallazgoExpres no
 * tiene columna propia; persistirHallazgos.ts no guarda otra copia aparte
 * de HallazgoExpresTraza.respuestaIds, que son ids de Respuesta, no
 * codigos de pregunta -- ver domain/types.ts). No es una fuente
 * secundaria ni una aproximacion: es la representacion canonica.
 *
 * I2-34 exige que "todo hallazgo referencie las preguntas de origen" --
 * un arreglo vacio NO satisface esa exigencia, aunque sea JSON
 * estructuralmente valido. Por eso un arreglo vacio, o que contenga un
 * codigo vacio o compuesto solo de espacios, se trata igual que una
 * forma ausente o malformada (no-objeto, sin la clave, no-arreglo,
 * elementos no-string): lanza TrazabilidadHallazgoInvalidaError en vez
 * de devolver [] o IDs inventados/reconstruidos.
 *
 * El trim() se usa SOLO para detectar codigos vacios/blancos -- el
 * arreglo devuelto es siempre el original, sin recortar ni normalizar
 * ningun valor persistido.
 */
function extraerSourceQuestionIds(contextoSnapshot: unknown): string[] {
  if (typeof contextoSnapshot !== "object" || contextoSnapshot === null) {
    throw new TrazabilidadHallazgoInvalidaError("contextoSnapshot no es un objeto");
  }
  if (!("preguntaCodigos" in contextoSnapshot)) {
    throw new TrazabilidadHallazgoInvalidaError("contextoSnapshot.preguntaCodigos ausente");
  }
  const preguntaCodigos = (contextoSnapshot as { preguntaCodigos: unknown }).preguntaCodigos;
  if (!Array.isArray(preguntaCodigos)) {
    throw new TrazabilidadHallazgoInvalidaError("contextoSnapshot.preguntaCodigos no es un arreglo");
  }
  if (preguntaCodigos.length === 0) {
    throw new TrazabilidadHallazgoInvalidaError(
      "contextoSnapshot.preguntaCodigos esta vacio -- I2-34 exige al menos una pregunta de origen",
    );
  }
  if (!preguntaCodigos.every((c): c is string => typeof c === "string")) {
    throw new TrazabilidadHallazgoInvalidaError("contextoSnapshot.preguntaCodigos contiene elementos no-string");
  }
  if (preguntaCodigos.some((c) => c.trim().length === 0)) {
    throw new TrazabilidadHallazgoInvalidaError(
      "contextoSnapshot.preguntaCodigos contiene un codigo vacio o compuesto solo de espacios",
    );
  }
  // Se devuelve el arreglo ORIGINAL (sin trim ni normalizacion) --
  // contenido y orden preservados exactamente como se persistieron.
  return preguntaCodigos;
}

/**
 * ruleVersion debe ser el valor historico realmente persistido en el
 * hallazgo (columna HallazgoExpres.ruleVersion, escrita 1:1 desde
 * DiagnosticFinding.ruleVersion al momento del calculo). Nunca se
 * sustituye por RULE_VERSION_V2 (la constante vigente del motor) ni por
 * ningun otro valor por defecto -- un hallazgo calculado con una version
 * de reglas anterior debe seguir mostrando esa version anterior.
 */
function validarRuleVersion(ruleVersion: unknown): string {
  if (typeof ruleVersion !== "string" || ruleVersion.length === 0) {
    throw new TrazabilidadHallazgoInvalidaError("ruleVersion ausente o invalido");
  }
  return ruleVersion;
}

export function formatearHallazgoMacro(h: HallazgoMacroParaFormatear): HallazgoMacro {
  return { dimension: h.dimension, status: h.estadoCategoria, statement: h.enunciado };
}

export function formatearHallazgoDetalle(h: HallazgoDetalleParaFormatear): HallazgoDetalle {
  return {
    ...formatearHallazgoMacro(h),
    evidenceState: h.estadoEvidencia,
    confidenceCoverage: h.coberturaConfianza,
    missingEvidence: h.evidenciaFaltante,
    nextCheck: h.siguienteVerificacion,
    sourceQuestionIds: extraerSourceQuestionIds(h.contextoSnapshot),
    ruleVersion: validarRuleVersion(h.ruleVersion),
  };
}
