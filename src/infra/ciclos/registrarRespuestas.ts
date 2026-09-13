// Infraestructura — registra las respuestas de un responsable a un ciclo abierto (RF6).
//
// RespuestaCruda no esta en TENANT_SCOPED_MODELS de tenantClient.ts (no
// tiene su propia columna empresaId -- llega a su tenant via conexionId/
// cicloPulsoId), asi que se lee/escribe con un set_config manual dentro
// de la transaccion, mismo patron que aceptarInvitacion.ts.
import { prisma } from "../prisma/client";
import { tenantClient } from "../prisma/tenantClient";

export interface RespuestaEntrada {
  conexionId: string;
  valor?: number | null;
  noSabe?: boolean;
  noAplica?: boolean;
}

export interface AsignacionConexion {
  conexionId: string;
  origenNombre: string;
  destinoNombre: string;
  respuestaExistente: { valor: number | null; noSabe: boolean; noAplica: boolean } | null;
}

export class CicloNoAbiertoError extends Error {
  constructor() {
    super("El ciclo de pulso no esta abierto");
    this.name = "CicloNoAbiertoError";
  }
}

export class ConexionNoAsignadaError extends Error {
  constructor(conexionId: string) {
    super(`La conexion ${conexionId} no pertenece al eslabon del responsable`);
    this.name = "ConexionNoAsignadaError";
  }
}

// RF6: las conexiones que le corresponde responder a un responsable son
// las "completa" donde su eslabon participa como origen o destino -- el
// unique de RespuestaCruda (cicloPulsoId, conexionId, responsableId)
// implica una sola respuesta por conexion por ciclo por responsable (ver
// nota de diseño en README/ADR: RF6 simplificado a v1, sin cuestionario
// multi-pregunta).
export async function obtenerAsignacionesResponsable(input: {
  empresaId: string;
  cicloPulsoId: string;
  eslabonId: string;
  responsableId: string;
}): Promise<AsignacionConexion[]> {
  const client = tenantClient(input.empresaId);
  const conexiones = await client.conexion.findMany({
    where: { completa: true, OR: [{ origenId: input.eslabonId }, { destinoId: input.eslabonId }] },
    include: { origen: true, destino: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.empresaId}, true)`;

    const resultado: AsignacionConexion[] = [];
    for (const conexion of conexiones) {
      const existente = await tx.respuestaCruda.findUnique({
        where: {
          cicloPulsoId_conexionId_responsableId: {
            cicloPulsoId: input.cicloPulsoId,
            conexionId: conexion.id,
            responsableId: input.responsableId,
          },
        },
      });
      resultado.push({
        conexionId: conexion.id,
        origenNombre: conexion.origen.nombre,
        destinoNombre: conexion.destino.nombre,
        respuestaExistente: existente
          ? { valor: existente.valor, noSabe: existente.noSabe, noAplica: existente.noAplica }
          : null,
      });
    }
    return resultado;
  });
}

export async function registrarRespuestas(input: {
  empresaId: string;
  cicloPulsoId: string;
  responsableId: string;
  eslabonId: string;
  respuestas: RespuestaEntrada[];
}): Promise<{ registradas: number }> {
  const client = tenantClient(input.empresaId);

  const [ciclo, conexionesAsignadas] = await Promise.all([
    client.cicloPulso.findUnique({ where: { id: input.cicloPulsoId } }),
    client.conexion.findMany({
      where: {
        completa: true,
        OR: [{ origenId: input.eslabonId }, { destinoId: input.eslabonId }],
      },
    }),
  ]);

  if (!ciclo || ciclo.estado !== "ABIERTO") {
    throw new CicloNoAbiertoError();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  const idsAsignados = new Set(conexionesAsignadas.map((c: any) => c.id as string));
  for (const respuesta of input.respuestas) {
    if (!idsAsignados.has(respuesta.conexionId)) {
      throw new ConexionNoAsignadaError(respuesta.conexionId);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.empresaId}, true)`;
    for (const respuesta of input.respuestas) {
      const noSabe = respuesta.noSabe ?? false;
      const noAplica = respuesta.noAplica ?? false;
      const valor = noSabe || noAplica ? null : (respuesta.valor ?? null);

      await tx.respuestaCruda.upsert({
        where: {
          cicloPulsoId_conexionId_responsableId: {
            cicloPulsoId: input.cicloPulsoId,
            conexionId: respuesta.conexionId,
            responsableId: input.responsableId,
          },
        },
        update: { valor, noSabe, noAplica },
        create: {
          cicloPulsoId: input.cicloPulsoId,
          conexionId: respuesta.conexionId,
          responsableId: input.responsableId,
          valor,
          noSabe,
          noAplica,
        },
      });
    }
  });

  return { registradas: input.respuestas.length };
}
