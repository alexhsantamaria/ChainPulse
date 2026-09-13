// Infraestructura — calcula el porcentaje de cobertura de respuesta de un
// ciclo (RF10): cuantos de los responsables esperados efectivamente
// completaron el cuestionario antes del cierre.
//
// Funcion pura (sin Prisma) para poder probarla aislada, mismo criterio
// que src/infra/conexiones/completitud.ts.
export function calcularCobertura(
  responsablesEsperados: number,
  responsablesQueRespondieron: number,
): number | null {
  // Sin responsables esperados (ningun eslabon con conexiones completas
  // tiene un responsable asignado todavia) no hay cobertura que calcular
  // -- null, no 0 ni 100, para no insinuar un dato que no existe.
  if (responsablesEsperados === 0) {
    return null;
  }
  const cobertura = (responsablesQueRespondieron / responsablesEsperados) * 100;
  return Math.min(100, Math.max(0, cobertura));
}
