// Infraestructura — agrega las duraciones de cuestionario registradas
// (RNF9) frente al limite de 5 minutos de RNF2. Funcion pura, sin Prisma,
// mismo criterio que cobertura.ts/completitud.ts: se prueba aislada.
const LIMITE_SEGUNDOS_RNF2 = 5 * 60;

export interface MetricasCuestionario {
  total: number;
  promedioSegundos: number | null;
  dentroDelLimite: number;
  porcentajeDentroDelLimite: number | null;
}

export function calcularMetricasCuestionario(duracionesSegundos: number[]): MetricasCuestionario {
  const total = duracionesSegundos.length;
  if (total === 0) {
    // Sin ningun cuestionario respondido todavia no hay nada que
    // promediar -- null, no 0, para no insinuar un dato que no existe
    // (mismo criterio que calcularCobertura con cero responsables).
    return { total: 0, promedioSegundos: null, dentroDelLimite: 0, porcentajeDentroDelLimite: null };
  }

  const suma = duracionesSegundos.reduce((acumulado, valor) => acumulado + valor, 0);
  const dentroDelLimite = duracionesSegundos.filter((valor) => valor <= LIMITE_SEGUNDOS_RNF2).length;

  return {
    total,
    promedioSegundos: suma / total,
    dentroDelLimite,
    porcentajeDentroDelLimite: (dentroDelLimite / total) * 100,
  };
}
