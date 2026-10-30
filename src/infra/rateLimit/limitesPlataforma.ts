export const LIMITE_LOGIN_PLATAFORMA_POR_HUELLA = 10;
export const LIMITE_MFA_PLATAFORMA_POR_HUELLA = 5;
export const VENTANA_PLATAFORMA_EN_BUCKETS = 1;
export const VENTANA_PLATAFORMA_MINUTOS = 15;

export function calcularRetryAfterSegundos(ahora: Date): number {
  const milisegundosPorVentana = VENTANA_PLATAFORMA_MINUTOS * 60_000;
  const transcurridos = ahora.getTime() % milisegundosPorVentana;
  return Math.max(1, Math.ceil((milisegundosPorVentana - transcurridos) / 1000));
}
