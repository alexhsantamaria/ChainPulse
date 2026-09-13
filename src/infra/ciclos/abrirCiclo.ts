// Infraestructura — abre un nuevo ciclo de pulso y notifica a los responsables elegibles (RF5).
import { tenantClient } from "../prisma/tenantClient";
import { obtenerResponsablesElegibles } from "./responsablesElegibles";
import { enviarAvisoCicloAbierto } from "../email/resend";

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
  // a que ciclo pertenecen mientras uno anterior sigue sin cerrarse.
  const cicloAbierto = await client.cicloPulso.findFirst({ where: { estado: "ABIERTO" } });
  if (cicloAbierto) {
    throw new YaHayCicloAbiertoError();
  }

  const [ciclo, responsables] = await Promise.all([
    client.cicloPulso.create({ data: {} }),
    obtenerResponsablesElegibles(empresaId),
  ]);

  let responsablesNotificados = 0;
  for (const responsable of responsables) {
    try {
      await enviarAvisoCicloAbierto({ email: responsable.email, nombre: responsable.nombre });
      responsablesNotificados++;
    } catch (err) {
      // Un correo que falla no debe abortar la apertura del ciclo -- el
      // administrador puede reenviarlo por otro medio; RF5 no exige
      // reintentos automaticos en el Incremento 1.
      console.error(err);
    }
  }

  return { cicloId: ciclo.id, responsablesNotificados, totalResponsables: responsables.length };
}
