// Motor v2 — version de reglas y catalogo cerrado de estados por dimension (RF21/RF22, V2 Sec. 8.1).
// Todo lo de este archivo es calibracion de la version "v2-preliminary":
// el orden de los estados, los textos de statement/nextCheck y el
// heuristico de priorizacion son hipotesis iniciales a ajustar con datos
// reales de uso (mismo espiritu que engine/constantes.ts del motor v1).
import type { DimensionDiagnosticoV2 } from "@/domain/types";

// Sube este numero cuando cambie cualquier formula de este archivo o de
// los demas engine/v2/*.ts — nunca se reescribe un DiagnosticFinding ya
// persistido con otra version (principio "versionado inmutable").
export const RULE_VERSION_V2 = "v2-preliminary";

// Catalogo cerrado — UNICA fuente de verdad de los 5 estados validos por
// dimension. HallazgoExpres.estadoCategoria es un string libre en
// Postgres (ver comentario en prisma/schema.prisma) justamente porque
// este catalogo, no una columna enum, es lo que lo cierra. El orden
// importa: coincide 1:1 con el orden de las opciones de la pregunta
// fuente de cada dimension (V2 Sec. 7.2 y 8.1).
export const ESTADOS_POR_DIMENSION: Record<DimensionDiagnosticoV2, readonly string[]> = {
  ALINEACION: ["compartida", "aplicada parcialmente", "diferente", "inexistente", "no comprobable"],
  COORDINACION: ["oportuna", "decision tardia", "informacion tardia", "fragmentada", "desconocida"],
  INTEGRACION: ["fuente compartida", "fuentes conciliadas", "conciliacion manual", "inconsistente", "desconocida"],
  EVIDENCIA: ["verificada declarada", "incompleta", "estimada", "inexistente", "desconocida"],
  RESILIENCIA: ["alternativa probada", "no probada", "dependiente de personas", "inexistente", "critico desconocido"],
};

// Acceso seguro a un catalogo cerrado por indice (noUncheckedIndexedAccess
// hace que TS vea `T | undefined` en cualquier acceso por []; esto lo
// resuelve una sola vez con un mensaje de error claro si algun indice
// llegara fuera de rango, en vez de repetir un "as string" en cada sitio).
export function enPosicion<T>(catalogo: readonly T[], indice: number, contexto: string): T {
  const valor = catalogo[indice];
  if (valor === undefined) {
    throw new Error(`Indice ${indice} fuera de rango para ${contexto} (catalogo de ${catalogo.length} elementos).`);
  }
  return valor;
}

// Indice (0-based) de la opcion 8 de Q1 ("no esta claramente definido")
// dentro de PreguntaVersion.opciones — la unica opcion de Q1 que señala un
// problema; Q1 no tiene una opcion "no lo sé" literal (V2 Sec. 7.2).
export const Q1_INDICE_PROMESA_NO_DEFINIDA = 7;

// Brecha minima (en posiciones ordinales) entre Q2 y Q3 para registrar una
// contradiccion en missingEvidence de Alineacion, en vez de ignorarla.
export const UMBRAL_BRECHA_CONTRADICCION_ALINEACION = 2;

// statement/nextCheck por dimension y por indice de estado (mismo orden
// que ESTADOS_POR_DIMENSION). Contenido inicial, no causal ("la IA
// explica, el motor calcula" — principio 10 de V2): describe el estado
// declarado, nunca inventa una causa.
export const STATEMENT_POR_DIMENSION: Record<DimensionDiagnosticoV2, readonly string[]> = {
  ALINEACION: [
    "Las areas coinciden en la prioridad y deciden de acuerdo con ella.",
    "Las areas conocen la prioridad compartida, pero no siempre la aplican en sus decisiones.",
    "Las areas darian respuestas distintas sobre cual es la prioridad.",
    "No existe una prioridad compartida entre las areas.",
    "No es posible comprobar si existe una prioridad compartida con la informacion disponible.",
  ],
  COORDINACION: [
    "La informacion llega a tiempo y la decision se toma a tiempo.",
    "La informacion llega a tiempo, pero la decision no siempre se toma a tiempo.",
    "La informacion suele llegar tarde a quien debe decidir.",
    "Cada area actua por separado, sin una decision conjunta.",
    "No se sabe si la informacion llega a tiempo ni si se decide a tiempo.",
  ],
  INTEGRACION: [
    "Todas las areas usan una fuente de datos compartida y confiable.",
    "Se usan varias herramientas, pero normalmente coinciden entre si.",
    "Los datos deben conciliarse manualmente entre sistemas.",
    "Las areas frecuentemente trabajan con informacion distinta entre si.",
    "No se sabe si las areas trabajan con la misma informacion.",
  ],
  EVIDENCIA: [
    "Existe un indicador de cumplimiento con registro de respaldo.",
    "Existe un indicador, pero los datos que lo respaldan estan incompletos.",
    "El cumplimiento solo se estima, sin datos de respaldo.",
    "No se mide el cumplimiento de la promesa al cliente.",
    "No se sabe si existe algun tipo de medicion del cumplimiento.",
  ],
  RESILIENCIA: [
    "Existe una alternativa probada y un responsable definido ante una falla.",
    "Existe una alternativa declarada, pero nunca fue probada.",
    "La respuesta ante una falla depende de la experiencia de algunas personas.",
    "No existe una alternativa definida ante una falla del punto mas critico.",
    "No se sabe cual es el punto mas critico de la cadena.",
  ],
};

export const NEXT_CHECK_POR_DIMENSION: Record<DimensionDiagnosticoV2, readonly string[]> = {
  ALINEACION: [
    "Reconfirmar en el siguiente ciclo con un caso concreto de decision conjunta.",
    "Pedir un ejemplo reciente donde la prioridad conocida no se aplico.",
    "Contrastar la respuesta de al menos otra area para esta misma pregunta.",
    "Preguntar a cada area, por separado, cual cree que es la prioridad.",
    "Aclarar primero cual es la promesa al cliente (Q1) antes de evaluar alineacion.",
  ],
  COORDINACION: [
    "Reconfirmar con un ejemplo reciente de un cambio de pedido resuelto a tiempo.",
    "Pedir el tiempo real transcurrido entre que llega la informacion y se decide.",
    "Identificar en que paso concreto se pierde tiempo antes de que llegue la informacion.",
    "Preguntar quien deberia centralizar la decision cuando cambia un pedido.",
    "Preguntar directamente quien decide cuando cambia un pedido, la demanda o la capacidad.",
  ],
  INTEGRACION: [
    "Confirmar el nombre de la fuente compartida y desde cuando se usa.",
    "Pedir un caso reciente donde las herramientas mostraron datos distintos.",
    "Medir cuanto tiempo toma la conciliacion manual mas reciente.",
    "Pedir un ejemplo reciente de informacion contradictoria entre areas.",
    "Preguntar que sistema usa cada area para cantidades, fechas y prioridades.",
  ],
  EVIDENCIA: [
    "Solicitar el indicador actual como evidencia de respaldo.",
    "Senalar que parte del dato falta y desde cuando.",
    "Pedir la base de la estimacion actual.",
    "Preguntar por que no se mide y que se necesitaria para empezar.",
    "Preguntar si existe algun registro, aunque sea informal, de cumplimiento.",
  ],
  RESILIENCIA: [
    "Pedir evidencia de la ultima prueba o simulacro de la alternativa.",
    "Programar una prueba de la alternativa declarada.",
    "Identificar quien concentra ese conocimiento y si hay respaldo.",
    "Definir una alternativa y un responsable para el punto mas critico.",
    "Identificar primero cual es el punto mas critico de la cadena.",
  ],
};

// Heuristico inicial de la regla de prioridad #1 (§8.3): que dimensiones
// amenazan mas directamente cada tipo de promesa declarada en Q1. Indice
// = indiceOpcion de Q1 (0-6; el 7, "no esta claramente definido", es el
// gatillo de Alineacion y no participa aqui). Lectura de negocio, no un
// hecho del spec — a recalibrar con los pilotos reales.
export const DIMENSIONES_CRITICAS_POR_PROMESA: readonly (readonly DimensionDiagnosticoV2[])[] = [
  ["INTEGRACION", "RESILIENCIA"], // 0 disponibilidad
  ["COORDINACION", "INTEGRACION"], // 1 rapidez
  ["COORDINACION", "RESILIENCIA"], // 2 cumplimiento de fecha y cantidad
  ["EVIDENCIA", "INTEGRACION"], // 3 calidad y consistencia
  ["INTEGRACION", "EVIDENCIA"], // 4 precio o eficiencia
  ["COORDINACION", "INTEGRACION"], // 5 personalizacion
  ["RESILIENCIA"], // 6 continuidad ante interrupciones
];
