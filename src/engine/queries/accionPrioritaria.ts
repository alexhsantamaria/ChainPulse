// Motor (PURO) -- I5-05: "¿Qué acción debería evaluar primero?".
//
// CONTRADICCION DOCUMENTADA (Seccion 3 de la autorizacion: "no
// reinterpretar silenciosamente; si hay contradiccion, documentarla y
// continuar"): Programa ChainPulse 53+ v3 (Punto 2, fila I5-05) propone
// reutilizar ordenarPorPrioridad() de src/engine/v2/prioridad.ts sobre
// "los hallazgos vigentes". Esa funcion opera sobre DiagnosticFinding
// (dimension: DimensionDiagnosticoV2, con los 5 estados de
// EvaluacionExpresV2, el flujo ANONIMO sin empresaId) -- una forma
// incompatible con HallazgoCadena (dimension: DimensionComparacionCadena,
// resultado: ResultadoComparacion), que es el UNICO modelo de "hallazgo"
// con empresaId/cadenaId propio (tenant-scoped) que esta pregunta puede
// consultar. No existe ningun mapeo aprobado entre ambas taxonomias, y
// forzar una conversion inventaria una regla de negocio no pedida. Esta
// pieza por lo tanto NO reutiliza prioridad.ts -- implementa su PROPIO
// orden, explicito y documentado, sobre HallazgoCadena. La dependencia de
// I2-28 declarada en la matriz v6/Programa 53+ v3 NO aplica a esta
// implementacion. Pendiente de decision de Alex: si prefiere que esta
// pregunta NO cuente como INV hasta reconciliar esta diferencia, o si
// confirma que un orden propio sobre HallazgoCadena es aceptable.
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { construirComoComprobar, mensajeSinDatos } from "./plantillasExplicacion";

export type ResultadoComparacionConsulta = "ACUERDO" | "ACUERDO_PARCIAL" | "DIFERENCIA" | "SIN_RESPUESTA_SUFICIENTE";

// Orden propio (ver nota de cabecera): DIFERENCIA es lo mas urgente de
// evaluar (una discrepancia real ya detectada), luego ACUERDO_PARCIAL,
// luego SIN_RESPUESTA_SUFICIENTE (falta evidencia, no es automaticamente
// urgente), ACUERDO es lo menos urgente (nada que evaluar).
const ORDEN_URGENCIA: Record<ResultadoComparacionConsulta, number> = {
  DIFERENCIA: 0,
  ACUERDO_PARCIAL: 1,
  SIN_RESPUESTA_SUFICIENTE: 2,
  ACUERDO: 3,
};

export interface HallazgoCadenaParaConsulta {
  id: string;
  dimension: string;
  resultado: ResultadoComparacionConsulta;
  createdAt: Date;
}

export interface DatosAccionPrioritaria {
  hallazgos: readonly HallazgoCadenaParaConsulta[];
}

export function ejecutarAccionPrioritaria(datos: DatosAccionPrioritaria): RespuestaConsulta {
  if (datos.hallazgos.length === 0) {
    return {
      ok: false,
      catalogoId: "ACCION_PRIORITARIA",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: mensajeSinDatos("no hay hallazgos vigentes registrados para esta cadena"),
      camposFaltantes: ["al menos un hallazgo vigente (HallazgoCadena)"],
      comoIngresarlos: "Completa las comparaciones de cadena/conexión para que el sistema registre hallazgos vigentes.",
    };
  }

  // Orden total y determinista: urgencia asc, luego mas reciente primero,
  // luego id como desempate final estable (I5-26: reproducible byte a
  // byte independientemente de si el motor JS garantiza sort() estable).
  const masUrgente = [...datos.hallazgos].sort((a, b) => {
    const porUrgencia = ORDEN_URGENCIA[a.resultado] - ORDEN_URGENCIA[b.resultado];
    if (porUrgencia !== 0) return porUrgencia;
    const porFecha = b.createdAt.getTime() - a.createdAt.getTime();
    if (porFecha !== 0) return porFecha;
    return a.id.localeCompare(b.id);
  })[0];
  if (!masUrgente) {
    throw new Error("ejecutarAccionPrioritaria: hallazgos no vacio pero masUrgente es undefined (invariante rota)");
  }

  return {
    ok: true,
    catalogoId: "ACCION_PRIORITARIA",
    respuestaDirecta: `La acción más urgente de evaluar es el hallazgo de dimensión "${masUrgente.dimension}" (resultado: ${masUrgente.resultado}).`,
    periodo: { inicio: "no aplica", fin: "no aplica" },
    filtros: {},
    fuente: "HallazgoCadena (vigentes)",
    formula: "Orden de urgencia propio: DIFERENCIA > ACUERDO_PARCIAL > SIN_RESPUESTA_SUFICIENTE > ACUERDO, más reciente primero",
    numerador: null,
    denominador: null,
    calidad: { faltantes: [], cobertura: 1 },
    hecho: `Hallazgo más urgente: id=${masUrgente.id}, dimensión=${masUrgente.dimension}, resultado=${masUrgente.resultado}, registrado el ${masUrgente.createdAt.toISOString()}.`,
    interpretacion: `Este hallazgo representa la discrepancia o falta de evidencia más urgente entre las ${datos.hallazgos.length} vigente(s) hoy, según el orden de urgencia documentado (ver fórmula).`,
    accion: `Evalúa primero el hallazgo de dimensión "${masUrgente.dimension}" (id ${masUrgente.id}).`,
    comoComprobar: construirComoComprobar(`revisa el hallazgo id ${masUrgente.id} en el mapa de la cadena.`),
    ruleVersion: "consultas-v1",
  };
}
