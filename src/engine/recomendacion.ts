// Motor — genera la recomendacion priorizada del eslabon mas debil (RF8).
//
// RF8 pide reglas segun "el tipo de friccion reportada y el grado de
// dependencia de esa conexion". El cuestionario de RF6 no captura un tipo
// de friccion explicito -- es una sola pregunta Likert por conexion,
// decision v1 ya tomada por RNF2 (minimalismo). Decision de Alex
// (2026-09-14, sin agregar campo nuevo al esquema): en v1 las reglas usan
// unicamente los valores ya calculados y persistidos por conexion --
// salud, grado de dependencia y si tiene alternativa declarada (RF3) --
// sin una pregunta nueva en el cuestionario ni una migracion de base de
// datos. Documentado como hipotesis de calibracion inicial, mismo
// criterio que el resto del motor (constantes.ts): ajustable con datos
// reales de los pilotos, y candidato natural a incorporar un campo real
// de "tipo de friccion" en un incremento futuro si los datos muestran
// que hace falta.
//
// Trade-off aceptado a proposito: a diferencia de salud/criticidad/
// riesgo/indice de integracion (RNF6: inmutables, nunca recalculados
// retroactivamente), el texto de esta recomendacion NO se persiste -- se
// calcula al vuelo a partir de los valores ya inmutables de
// ResultadoConexion. Si estas reglas cambian mas adelante, un ciclo ya
// cerrado mostraria la recomendacion nueva al volver a abrirlo (el
// puntaje numerico subyacente no cambia). Aceptable porque esta funcion
// es asesoria/de presentacion, no uno de los "cuatro valores" que RNF6
// protege explicitamente.
import type { GradoDependencia } from "@/domain/types";
import { SALUD_ACEPTABLE_UMBRAL } from "./constantes";

export type PrioridadRecomendacion = "ALTA" | "MEDIA" | "BAJA";

export interface EntradaRecomendacion {
  gradoDependencia: GradoDependencia;
  salud: number; // 0-100
  tieneAlternativa: boolean;
}

export interface Recomendacion {
  prioridad: PrioridadRecomendacion;
  texto: string;
}

// Umbral propio de "salud critica" para priorizar la recomendacion --
// mas estricto que SALUD_ACEPTABLE_UMBRAL (70), que solo marca el corte
// de "aceptable" para RF16. Hipotesis de calibracion inicial, igual que
// el resto de constantes.ts.
const SALUD_CRITICA_UMBRAL = 40;

export function generarRecomendacion(entrada: EntradaRecomendacion): Recomendacion {
  const severidad = clasificarSeveridad(entrada.salud);
  const dependenciaAlta = entrada.gradoDependencia === "ALTA" || entrada.gradoDependencia === "CRITICA";

  return {
    prioridad: calcularPrioridad(severidad, dependenciaAlta, entrada.tieneAlternativa),
    texto: construirTexto(severidad, entrada.gradoDependencia, entrada.tieneAlternativa),
  };
}

type Severidad = "CRITICA" | "BAJA" | "ACEPTABLE";

function clasificarSeveridad(salud: number): Severidad {
  if (salud < SALUD_CRITICA_UMBRAL) return "CRITICA";
  if (salud < SALUD_ACEPTABLE_UMBRAL) return "BAJA";
  return "ACEPTABLE";
}

function calcularPrioridad(
  severidad: Severidad,
  dependenciaAlta: boolean,
  tieneAlternativa: boolean,
): PrioridadRecomendacion {
  if (severidad === "CRITICA") {
    return "ALTA";
  }
  if (severidad === "BAJA") {
    return dependenciaAlta ? "ALTA" : "MEDIA";
  }
  // severidad ACEPTABLE: solo justifica atencion si es de alta
  // dependencia y encima no tiene alternativa (punto unico de falla,
  // mismo criterio que el indice de integracion, RF16).
  if (dependenciaAlta && !tieneAlternativa) {
    return "MEDIA";
  }
  return "BAJA";
}

function construirTexto(
  severidad: Severidad,
  gradoDependencia: GradoDependencia,
  tieneAlternativa: boolean,
): string {
  const dependenciaAlta = gradoDependencia === "ALTA" || gradoDependencia === "CRITICA";
  const etiquetaDependencia = gradoDependencia === "CRITICA" ? "crítica" : gradoDependencia === "ALTA" ? "alta" : gradoDependencia === "MEDIA" ? "media" : "baja";

  const apertura =
    severidad === "CRITICA"
      ? "La salud de esta conexión está en un nivel crítico."
      : severidad === "BAJA"
        ? "La salud de esta conexión está por debajo de lo aceptable."
        : "La salud de esta conexión es aceptable, pero es un punto de riesgo por su alta dependencia.";

  if (dependenciaAlta && !tieneAlternativa) {
    return `${apertura} Es una dependencia ${etiquetaDependencia} sin alternativa declarada: definan primero un respaldo (otro proveedor, proceso o persona) para no depender de un solo punto de falla, y en paralelo revisen con los responsables qué está generando la fricción.`;
  }

  if (dependenciaAlta && tieneAlternativa) {
    return `${apertura} Es una dependencia ${etiquetaDependencia}, pero ya existe una alternativa declarada: evalúen activarla mientras se resuelve la causa de fondo con los responsables de ambos eslabones.`;
  }

  return `${apertura} Es una dependencia ${etiquetaDependencia}: alcanza con una conversación breve entre los responsables de ambos eslabones para acordar un ajuste puntual.`;
}
