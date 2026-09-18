// Infraestructura publica — textos legales EXACTOS de los 2 consentimientos
// de RF23, aprobados en la revision legal de Ley 29733
// (PLAN-DE-TRABAJO.md Seccion 18.2.G, punto 3; requirements.md Seccion
// 13.4). Nunca se reescriben ni se generan dinamicamente -- cualquier
// cambio de texto real es una version nueva (TEXTO_CONSENTIMIENTO_VERSION),
// nunca una edicion de estas constantes con la misma version (RF24,
// append-only: ConsentimientoExpres.textoSnapshot guarda el texto tal
// cual se mostro, ligado a esta version).
export const TEXTO_CONSENTIMIENTO_VERSION = "ley29733-v1";

export const TEXTO_CONSENTIMIENTO_DIAGNOSTICO =
  "He leído y acepto la Política de Privacidad y autorizo a ChainPulse a tratar mis datos de contacto " +
  "(y transferirlos a servidores de alojamiento en EE. UU.) con la finalidad de enviarme el informe de " +
  "diagnóstico detallado de mi cadena de suministro.";

export const TEXTO_CONSENTIMIENTO_INVESTIGACION =
  "Autorizo a ChainPulse a utilizar las respuestas de mi evaluación y mis datos de contacto para entrenar, " +
  "calibrar y mejorar los algoritmos de diagnóstico del producto mediante análisis de datos reales.";
