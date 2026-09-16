// Infraestructura — abre un nuevo ciclo de pulso y notifica a los responsables elegibles (RF5).
import { tenantClient } from "../prisma/tenantClient";
import { obtenerResponsablesElegibles } from "./responsablesElegibles";
import { enviarAvisoCicloAbierto } from "../email/resend";
import { logError } from "../log";
import { esViolacionUnica } from "../prisma/errores";

export class YaHayCicloAbiertoError extends Error {
  constructor() {
    super("Ya hay un ciclo de pulso abierto para esta empresa");
    this.name = "YaHayCicloAbiertoError";
  }
}

export async function abrirCiclo(
  empresaId: string,
): Promise<{ cicloId: string; responsablesNotificados: number; totalResponsables: number }> {
  const client = tenantClient(empresaId);

  // RF5: un solo ciclo abierto por vez -- evita respuestas ambiguas sobre
  // a que ciclo pertenecen mientras uno anterior sigue sin cerrarse. Este
  // findFirst es solo un chequeo optimista (rapido, buen mensaje de error
  // en el caso comun); la garantia real es el indice unico parcial de la
  // migracion 20260916160000_ciclo_abierto_unico (R5-7), que cierra la
  // ventana de carrera entre dos invocaciones concurrentes.
  const cicloAbierto = await client.cicloPulso.findFirst({ where: { estado: "ABIERTO" } });
  if (cicloAbierto) {
    throw new YaHayCicloAbiertoError();
  }

  let ciclo: { id: string };
  let responsables: Awaited<ReturnType<typeof obtenerResponsablesElegibles>>;
  try {
    [ciclo, responsables] = await Promise.all([
      client.cicloPulso.create({ data: { empresaId } }),
      obtenerResponsablesElegibles(empresaId),
    ]);
  } catch (err) {
    // R5-7 -- si dos peticiones concurrentes pasaron el findFirst antes de
    // que la primera terminara su create, el indice unico parcial rechaza
    // la segunda con P2002. La traducimos al mismo error de negocio que ya
    // manejan los llamadores (misma respuesta que el chequeo optimista).
    if (esViolacionUnica(err)) {
      throw new YaHayCicloAbiertoError();
    }
    throw err;
  }

  let responsablesNotificados = 0;
  for (const responsable of responsables) {
    try {
      await enviarAvisoCicloAbierto({ email: responsable.email, nombre: responsable.nombre });
      responsablesNotificados++;
    } catch (err) {
      // Un correo que falla no debe abortar la apertura del ciclo -- el
      // administrador puede reenviarlo por otro medio; RF5 no exige
      // reintentos automaticos en el Incremento 1.
      logError("abrirCiclo aviso", err);
    }
  }

  return { cicloId: ciclo.id, responsablesNotificados, totalResponsables: responsables.length };
}
