// Infraestructura — rate limiting y bloqueo temporal del login (ADR-0003).
// Una vez que loginLookup() resuelve el tenant, las escrituras pasan por
// tenantClient()/tenantTransaction() normal (RLS activo), no por una
// excepcion como la lectura.
//
// Ronda 5 de revision (R5-13, MEDIO): la version anterior de
// registrarIntentoFallido() recibia "intentosActuales" ya leido por quien
// llama (src/auth.ts) y escribia intentosActuales+1 en un update()
// separado -- leer-incrementar-escribir, no atomico. Bajo dos intentos
// fallidos casi simultaneos del mismo usuario, el segundo update podia
// pisar el incremento del primero (se "pierde" un intento), retrasando el
// bloqueo por fuerza bruta. Corregido con un UPDATE atomico
// (intentosFallidos = intentosFallidos + 1 en la misma sentencia SQL,
// dentro de una transaccion con el tenant ya fijado) -- mismo criterio que
// ya usaba src/infra/rateLimit/limiteTasa.ts para el mismo problema.
import { tenantClient } from "../prisma/tenantClient";
import { tenantTransaction } from "../prisma/tenantTransaction";

const MAX_INTENTOS_FALLIDOS = 5;
const BLOQUEO_MINUTOS = 15;

export function estaBloqueado(bloqueadoHasta: Date | null): boolean {
  return bloqueadoHasta !== null && bloqueadoHasta.getTime() > Date.now();
}

export async function registrarIntentoFallido(empresaId: string, usuarioId: string): Promise<void> {
  const bloqueadoHastaSiCorresponde = new Date(Date.now() + BLOQUEO_MINUTOS * 60_000);
  await tenantTransaction(empresaId, async (tx) => {
    await tx.$executeRaw`
      UPDATE "usuarios"
      SET "intentosFallidos" = "intentosFallidos" + 1,
          "bloqueadoHasta" = CASE
            WHEN "intentosFallidos" + 1 >= ${MAX_INTENTOS_FALLIDOS} THEN ${bloqueadoHastaSiCorresponde}
            ELSE "bloqueadoHasta"
          END
      WHERE "id" = ${usuarioId} AND "empresaId" = ${empresaId}
    `;
  });
}

export async function resetearIntentos(empresaId: string, usuarioId: string): Promise<void> {
  await tenantClient(empresaId).usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: 0, bloqueadoHasta: null },
  });
}
