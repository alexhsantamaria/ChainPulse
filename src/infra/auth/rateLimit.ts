// Infraestructura — rate limiting y bloqueo temporal del login (ADR-0003).
// Una vez que loginLookup() resuelve el tenant, las escrituras pasan por
// tenantClient() normal (RLS activo), no por una excepcion como la lectura.
import { tenantClient } from "../prisma/tenantClient";

const MAX_INTENTOS_FALLIDOS = 5;
const BLOQUEO_MINUTOS = 15;

export function estaBloqueado(bloqueadoHasta: Date | null): boolean {
  return bloqueadoHasta !== null && bloqueadoHasta.getTime() > Date.now();
}

export async function registrarIntentoFallido(
  empresaId: string,
  usuarioId: string,
  intentosActuales: number,
): Promise<void> {
  const intentos = intentosActuales + 1;
  const data: { intentosFallidos: number; bloqueadoHasta?: Date } = { intentosFallidos: intentos };
  if (intentos >= MAX_INTENTOS_FALLIDOS) {
    data.bloqueadoHasta = new Date(Date.now() + BLOQUEO_MINUTOS * 60_000);
  }
  await tenantClient(empresaId).usuario.update({ where: { id: usuarioId }, data });
}

export async function resetearIntentos(empresaId: string, usuarioId: string): Promise<void> {
  await tenantClient(empresaId).usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: 0, bloqueadoHasta: null },
  });
}
