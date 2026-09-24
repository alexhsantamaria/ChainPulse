// Infraestructura tenant-scoped -- persiste el resultado de
// engine/cadena/compararCadena.ts como filas de HallazgoCadena (RF38/RF39,
// Bloque C Paso 3). Corre despues de cada RespuestaCadena nueva o
// actualizada (ver POST /api/invitacion-cadena/responder), recalculando
// solo las dimensiones del alcance que acaba de cambiar (cadena completa
// o la conexion puntual tocada) -- nunca las 6 juntas, para no reescribir
// hallazgos de otras conexiones que no cambiaron.
//
// RF39 ("cuando... resulta en el estado diferencia, el sistema debera
// registrarla como un hallazgo") -- solo las dimensiones en DIFERENCIA se
// persisten como fila. Como las respuestas se pueden reabrir y corregir
// (RF36/RNF15), una dimension que ANTES era DIFERENCIA y ahora ya no lo
// es debe dejar de aparecer como hallazgo -- por eso esta funcion borra
// la fila existente en ese caso, no solo crea/actualiza.
import type { Prisma } from "@prisma/client";
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import type { ResultadoDimensionCadena } from "@/engine/cadena/compararCadena";

export async function persistirHallazgosCadena(
  client: TenantPrismaClient,
  empresaId: string,
  cadenaId: string,
  conexionCadenaId: string | null,
  resultados: readonly ResultadoDimensionCadena[],
) {
  for (const { dimension, resultado, contextoSnapshot } of resultados) {
    const where = conexionCadenaId
      ? { conexionCadenaId, dimension }
      : { cadenaId, dimension, conexionCadenaId: null };

    const existente = await client.hallazgoCadena.findFirst({ where });

    if (resultado !== "DIFERENCIA") {
      // La diferencia se resolvio (o nunca hubo suficiente respuesta) --
      // no se guarda como hallazgo, y si ya existia una fila de una
      // corrida anterior, se elimina (RF36: reabrir el link actualiza).
      if (existente) {
        await client.hallazgoCadena.delete({ where: { id: existente.id } });
      }
      continue;
    }

    if (existente) {
      await client.hallazgoCadena.update({
        where: { id: existente.id },
        data: {
          contextoSnapshot:
            contextoSnapshot as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      await client.hallazgoCadena.create({
        data: {
          // empresaId explicito -- injectTenantFilter() lo sobrescribe
          // igual en runtime, pero el tipo generado real de Prisma
          // (Windows) lo exige como campo no opcional en el create,
          // mismo patron ya usado en responder/route.ts y en
          // cadenas/[id]/nodos/route.ts.
          empresaId,
          cadenaId,
          conexionCadenaId,
          dimension,
          resultado,
          contextoSnapshot:
            contextoSnapshot as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
}
