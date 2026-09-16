// Infraestructura — registra las respuestas de un responsable a un ciclo abierto (RF6).
//
// RespuestaCruda no esta en TENANT_SCOPED_MODELS de tenantClient.ts (no
// tiene su propia columna empresaId -- llega a su tenant via conexionId/
// cicloPulsoId): tenantTransaction() igual fija app.tenant_id en la sesion
// (para RLS, capa 2), simplemente no le inyecta un filtro de WHERE/data
// automatico a este modelo en particular (R5-11).
import { tenantClient } from "../prisma/tenantClient";
import { tenantTransaction } from "../prisma/tenantTransaction";

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

  // R5-11 -- helper estandar en vez de set_config manual (ver registro.ts).
  return tenantTransaction(input.empresaId, async (tx) => {
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
  /** RNF9 — segundos desde que se cargo el formulario hasta el envio, medidos en el cliente. Opcional: si no llega, no se registra metrica (nunca bloquea el envio). */
  duracionSegundos?: number;
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

  // R5-11 -- helper estandar en vez de set_config manual (ver registro.ts).
  await tenantTransaction(input.empresaId, async (tx) => {
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

    // RNF9 -- una fila por envio (no por respuesta individual), solo si
    // el cliente mando una duracion valida. Nunca bloquea el registro de
    // las respuestas en si (RF6 es lo que importa, esto es instrumentacion).
    if (input.duracionSegundos != null && Number.isFinite(input.duracionSegundos) && input.duracionSegundos >= 0) {
      await tx.metricaCuestionario.create({
        data: {
          cicloPulsoId: input.cicloPulsoId,
          responsableId: input.responsableId,
          duracionSegundos: Math.round(input.duracionSegundos),
        },
      });
    }
  });

  return { registradas: input.respuestas.length };
}
