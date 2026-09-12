// Constantes del motor — valores de calibracion inicial: pesos, umbrales y version de reglas.
// Valores de calibracion inicial del motor v1 (requirements.md, Seccion 12).
// Todos son hipotesis de calibracion, no leyes fijas — se ajustan con los
// datos reales de los dos pilotos (Seccion 9, punto 4). Vive en un solo
// archivo para que ajustarlos no toque la logica de eslabonMasDebil.ts,
// salud.ts, criticidad.ts, riesgo.ts ni indiceIntegracion.ts.

// Version del motor persistida en cada resultado inmutable (RF7, RNF6,
// CTO/Seccion 12: un unico ruleVersion por resultado, no fragmentado por
// dimension). Subir este numero cuando cambie cualquier formula de este
// archivo o de engine/*.ts.
export const RULE_VERSION = "engine-v1.0.0";

// RF6 — escala Likert 1-5 normalizada a salud 0-100.
export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;

// RF16 — umbral de salud "aceptable" y penalizacion por punto unico de
// falla (Seccion 12).
export const SALUD_ACEPTABLE_UMBRAL = 70;
export const PENALIZACION_POR_SPOF_PUNTOS = 10;

// RF16 — una conexion cuenta como "criticidad Alta o Critica" (texto de
// RF16) cuando su criticidad calculada (0-100) alcanza este umbral. RF16
// hereda el lenguaje de 4 niveles de GradoDependencia para "criticidad",
// pero criticidad en el motor es continua (Seccion 3: "se calcula", no se
// declara) — este umbral traduce esa frase a la escala numerica real.
export const CRITICIDAD_ALTA_UMBRAL = 66;

// engine/criticidad.ts — puntos por nivel categorico (0-100).
export const PUNTOS_IMPACTO: Record<string, number> = {
  BAJO: 0,
  MEDIO: 33,
  ALTO: 66,
  CRITICO: 100,
};

// "Tiempo tolerable" corto = poca tolerancia = alta presion de
// criticidad; largo = mucha tolerancia = baja presion. Por eso el mapeo
// esta invertido respecto del de "tiempo de recuperacion".
export const PUNTOS_TIEMPO_TOLERABLE: Record<string, number> = {
  CORTO: 100,
  MEDIO: 50,
  LARGO: 0,
};

export const PUNTOS_TIEMPO_RECUPERACION: Record<string, number> = {
  CORTO: 0,
  MEDIO: 50,
  LARGO: 100,
};

// Pesos de la combinacion de criticidad (deben sumar 1).
export const PESO_IMPACTO = 0.4;
export const PESO_TIEMPO_TOLERABLE = 0.3;
export const PESO_TIEMPO_RECUPERACION = 0.3;

// Si hay alternativa declarada, se amortigua la criticidad y el riesgo —
// una conexion muy critica pero con alternativa probada es de menor
// riesgo real (Seccion 3, definicion de "Riesgo").
export const FACTOR_AMORTIGUACION_CON_ALTERNATIVA = 0.6;

// engine/riesgo.ts — pesos de criticidad vs. variabilidad de salud.
export const PESO_RIESGO_CRITICIDAD = 0.6;
export const PESO_RIESGO_VARIABILIDAD = 0.4;
// La desviacion estandar de salud (0-100) se escala por este factor antes
// de tratarla como una "variabilidad" de 0-100 — con un historial corto
// (1-2 ciclos) la variabilidad real es baja por poca muestra, no porque
// la conexion sea estable; esto es una limitacion conocida del v1,
// documentada aqui a proposito.
export const ESCALA_VARIABILIDAD = 2;

// engine/eslabonMasDebil.ts — orden numerico para el desempate por
// "dependencia descendente" (RF7, Seccion 12).
export const ORDEN_DEPENDENCIA: Record<string, number> = {
  BAJA: 1,
  MEDIA: 2,
  ALTA: 3,
  CRITICA: 4,
};
