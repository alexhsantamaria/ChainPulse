// Motor — identifica el conjunto de eslabones mas debiles (frontera de Pareto, RF7).
import type { EslabonesMasDebilesResultado, ValoresConexion } from "@/domain/types";
import { ORDEN_DEPENDENCIA } from "./constantes";

// RF7 / Seccion 12 — el conjunto de "eslabones mas debiles" es el
// conjunto NO DOMINADO (frontera de Pareto) respecto de salud (peor es
// mejor candidato) y criticidad (mayor es mejor candidato). Nunca colapsa
// un empate ambiguo en un ganador arbitrario ni en un numero oculto
// (Seccion 1) — por eso esta funcion nunca elige "una sola" conexion
// cuando hay mas de un no-dominado: siempre devuelve el conjunto entero,
// ya ordenado para lectura.
export function calcularEslabonesMasDebiles(
  conexiones: readonly ValoresConexion[],
): EslabonesMasDebilesResultado {
  const noDominadas = conexiones.filter(
    (candidata) => !conexiones.some((otra) => domina(otra, candidata)),
  );

  const ordenado = [...noDominadas].sort(compararParaLectura);

  return {
    conjuntoNoDominado: ordenado,
    esAmbiguo: ordenado.length > 1,
  };
}

// A domina a B si la salud de A es igual o peor que la de B Y la
// criticidad de A es igual o mayor que la de B, con al menos una de las
// dos estrictamente peor/mayor. Dos conexiones empatadas exactamente en
// ambos ejes NO se dominan entre si (Seccion 12, punto 6) — por diseno,
// para que ambas queden en el conjunto no dominado sin ninguna regla de
// seleccion adicional.
function domina(a: ValoresConexion, b: ValoresConexion): boolean {
  const saludIgualOPeor = a.salud <= b.salud;
  const criticidadIgualOMayor = a.criticidad >= b.criticidad;
  const algunaEstricta = a.salud < b.salud || a.criticidad > b.criticidad;

  return saludIgualOPeor && criticidadIgualOMayor && algunaEstricta;
}

// Orden de LECTURA dentro del conjunto no dominado (nunca de seleccion):
// criticidad descendente, salud ascendente, riesgo descendente,
// dependencia descendente y por ultimo el id de la conexion — para que el
// orden mostrado sea siempre el mismo dado el mismo ruleVersion,
// independiente del orden en que la base de datos devuelva las filas
// (RF7, Seccion 12; QA/ADR-0002: snapshot tests deterministas byte a
// byte).
function compararParaLectura(a: ValoresConexion, b: ValoresConexion): number {
  if (a.criticidad !== b.criticidad) return b.criticidad - a.criticidad;
  if (a.salud !== b.salud) return a.salud - b.salud;
  if (a.riesgo !== b.riesgo) return b.riesgo - a.riesgo;

  const depA = ORDEN_DEPENDENCIA[a.gradoDependencia] ?? 0;
  const depB = ORDEN_DEPENDENCIA[b.gradoDependencia] ?? 0;
  if (depA !== depB) return depB - depA;

  return a.conexionId.localeCompare(b.conexionId);
}
