// Motor v2 — orden de prioridad de los 5 hallazgos (V2 §8.3, ya
// normativo en el orden de las 6 reglas; el heuristico de "que dimension
// amenaza cada tipo de promesa" en constantes.ts es lo unico calibrable
// aqui). Nunca inventa una causa: solo ordena hallazgos ya calculados.
import type { DiagnosticFinding, DimensionDiagnosticoV2 } from "@/domain/types";
import { DIMENSIONES_CRITICAS_POR_PROMESA, ESTADOS_POR_DIMENSION, Q1_INDICE_PROMESA_NO_DEFINIDA } from "./constantes";

function esUnoDeLosDosPeoresEstados(hallazgo: DiagnosticFinding): boolean {
  const estados = ESTADOS_POR_DIMENSION[hallazgo.dimension];
  const indice = estados.indexOf(hallazgo.status);
  return indice >= estados.length - 2;
}

function tiene(hallazgo: DiagnosticFinding, dimension: DimensionDiagnosticoV2, estados: readonly string[]): boolean {
  return hallazgo.dimension === dimension && estados.includes(hallazgo.status);
}

/**
 * Rango de prioridad §8.3: 1 = mas urgente. indiceOpcionQ1 es el indice de
 * la opcion elegida en Q1 (Promesa); null si no esta disponible (no deberia
 * ocurrir en el flujo real, las 7 preguntas son obligatorias).
 */
function rangoPrioridad(hallazgo: DiagnosticFinding, indiceOpcionQ1: number | null): number {
  const dimensionesCriticas =
    indiceOpcionQ1 !== null && indiceOpcionQ1 !== Q1_INDICE_PROMESA_NO_DEFINIDA
      ? DIMENSIONES_CRITICAS_POR_PROMESA[indiceOpcionQ1] ?? []
      : [];

  // Regla 1 — posible afectacion directa a la promesa declarada en Q1.
  if (dimensionesCriticas.includes(hallazgo.dimension) && esUnoDeLosDosPeoresEstados(hallazgo)) return 1;
  // Regla 2 — punto unico de falla sin alternativa.
  if (tiene(hallazgo, "RESILIENCIA", ["no probada", "dependiente de personas", "inexistente", "critico desconocido"])) return 2;
  // Regla 3 — decision inexistente o tardia.
  if (tiene(hallazgo, "COORDINACION", ["decision tardia", "informacion tardia", "fragmentada", "desconocida"])) return 3;
  // Regla 4 — informacion inconsistente.
  if (tiene(hallazgo, "INTEGRACION", ["conciliacion manual", "inconsistente", "desconocida"])) return 4;
  // Regla 5 — ausencia de evidencia.
  if (tiene(hallazgo, "EVIDENCIA", ["incompleta", "estimada", "inexistente", "desconocida"])) return 5;
  // Regla 6 — oportunidad de mejora no critica (o dimension ya en su mejor estado).
  return 6;
}

export function ordenarPorPrioridad(hallazgos: readonly DiagnosticFinding[], indiceOpcionQ1: number | null): DiagnosticFinding[] {
  return [...hallazgos].sort((a, b) => rangoPrioridad(a, indiceOpcionQ1) - rangoPrioridad(b, indiceOpcionQ1));
}
