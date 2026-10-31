import type { PrismaClient } from "@prisma/client";
import { generarCuid } from "../ids/cuid";
import { prisma } from "../prisma/client";
import { esViolacionIndiceParcialPublicacion } from "./erroresPublicacion";

type ClienteSql = Pick<PrismaClient, "$queryRaw">;
type Resultado = { ok: boolean; motivo: string };
type ResultadoPublicacion = { publicada: boolean; motivo: string };

function primera<T>(filas: T[], operacion: string): T {
  if (!filas[0]) throw new Error(`RF20_SIN_RESULTADO:${operacion}`);
  return filas[0];
}

export async function crearCuestionarioVersion(
  codigo: string,
  curadorId: string,
  cliente: ClienteSql = prisma,
): Promise<{ id: string; numero: number }> {
  const id = generarCuid();
  const filas = await cliente.$queryRaw<{ numero: number }[]>`
    SELECT * FROM public.crear_cuestionario_version(${id}, ${codigo}, ${curadorId})
  `;
  return { id, numero: primera(filas, "crear_cuestionario_version").numero };
}

export async function crearPreguntaVersion(
  entrada: {
    versionId: string; codigo: string; orden: number; texto: string;
    dimension: string; opciones: unknown; esNoPuntuable: boolean;
  },
  cliente: ClienteSql = prisma,
): Promise<Resultado & { id: string }> {
  const id = generarCuid();
  const opciones = JSON.stringify(entrada.opciones);
  const filas = await cliente.$queryRaw<Resultado[]>`
    SELECT ok, motivo FROM public.crear_pregunta_version(
      ${id}, ${entrada.versionId}, ${entrada.codigo}, ${entrada.orden}, ${entrada.texto},
      ${entrada.dimension}, ${opciones}::jsonb, ${entrada.esNoPuntuable}
    )
  `;
  return { id, ...primera(filas, "crear_pregunta_version") };
}

export async function editarPreguntaVersion(
  entrada: { preguntaId: string; texto: string; dimension: string; opciones: unknown; esNoPuntuable: boolean },
  cliente: ClienteSql = prisma,
): Promise<Resultado> {
  const opciones = JSON.stringify(entrada.opciones);
  const filas = await cliente.$queryRaw<Resultado[]>`
    SELECT ok, motivo FROM public.editar_pregunta_version(
      ${entrada.preguntaId}, ${entrada.texto}, ${entrada.dimension}, ${opciones}::jsonb, ${entrada.esNoPuntuable}
    )
  `;
  return primera(filas, "editar_pregunta_version");
}

export async function eliminarPreguntaVersion(preguntaId: string, cliente: ClienteSql = prisma): Promise<Resultado> {
  const filas = await cliente.$queryRaw<Resultado[]>`
    SELECT ok, motivo FROM public.eliminar_pregunta_version(${preguntaId})
  `;
  return primera(filas, "eliminar_pregunta_version");
}

export async function editarMetadataCuestionarioVersion(
  versionId: string, notasCambio: string | null, cliente: ClienteSql = prisma,
): Promise<Resultado> {
  const filas = await cliente.$queryRaw<Resultado[]>`
    SELECT ok, motivo FROM public.editar_metadata_cuestionario_version(${versionId}, ${notasCambio})
  `;
  return primera(filas, "editar_metadata_cuestionario_version");
}

export async function reordenarPreguntasVersion(
  versionId: string, ordenes: Array<{ id: string; orden: number }>, cliente: ClienteSql = prisma,
): Promise<{ reordenado: boolean; motivo: string }> {
  const payload = JSON.stringify(ordenes);
  const filas = await cliente.$queryRaw<Array<{ reordenado: boolean; motivo: string }>>`
    SELECT reordenado, motivo FROM public.reordenar_preguntas_version(${versionId}, ${payload}::jsonb)
  `;
  return primera(filas, "reordenar_preguntas_version");
}

export async function validarEstructuraOpcionesPregunta(
  opciones: unknown, cliente: ClienteSql = prisma,
): Promise<{ valido: boolean; motivo: string }> {
  const payload = JSON.stringify(opciones);
  const filas = await cliente.$queryRaw<Array<{ valido: boolean; motivo: string }>>`
    SELECT valido, motivo FROM public.validar_estructura_opciones_pregunta(${payload}::jsonb)
  `;
  return primera(filas, "validar_estructura_opciones_pregunta");
}

export async function publicarCuestionarioVersion(
  entrada: { versionId: string; actorId: string; versionVigenteEsperadaId: string | null },
  cliente: ClienteSql = prisma,
): Promise<ResultadoPublicacion> {
  const eventoPublicar = generarCuid();
  const eventoRetirar = generarCuid();
  try {
    const filas = await cliente.$queryRaw<ResultadoPublicacion[]>`
      SELECT publicada, motivo FROM public.publicar_cuestionario_version(
        ${entrada.versionId}, ${entrada.actorId}, ${entrada.versionVigenteEsperadaId},
        ${eventoPublicar}, ${eventoRetirar}
      )
    `;
    return primera(filas, "publicar_cuestionario_version");
  } catch (error) {
    if (esViolacionIndiceParcialPublicacion(error)) {
      return { publicada: false, motivo: "VERSION_PUBLICADA_CONCURRENTE" };
    }
    throw error;
  }
}

export async function retirarCuestionarioVersion(
  versionId: string, actorId: string, cliente: ClienteSql = prisma,
): Promise<{ retirada: boolean; motivo: string }> {
  const evento = generarCuid();
  const filas = await cliente.$queryRaw<Array<{ retirada: boolean; motivo: string }>>`
    SELECT retirada, motivo FROM public.retirar_cuestionario_version(${versionId}, ${actorId}, ${evento})
  `;
  return primera(filas, "retirar_cuestionario_version");
}

export async function corregirCuestionarioVersion(
  versionOrigenId: string,
  curadorId: string,
  cliente: PrismaClient = prisma,
): Promise<{ id: string; numero: number }> {
  return cliente.$transaction(async (tx) => {
    const id = generarCuid();
    const evento = generarCuid();
    const filas = await tx.$queryRaw<{ numero: number }[]>`
      SELECT numero FROM public.corregir_cuestionario_version(${id}, ${evento}, ${versionOrigenId}, ${curadorId})
    `;
    const preguntas = await tx.preguntaVersion.findMany({ where: { cuestionarioVersionId: versionOrigenId } });
    for (const pregunta of preguntas) {
      const resultado = await crearPreguntaVersion({
        versionId: id, codigo: pregunta.codigo, orden: pregunta.orden, texto: pregunta.texto,
        dimension: pregunta.dimension, opciones: pregunta.opciones, esNoPuntuable: pregunta.esNoPuntuable,
      }, tx);
      if (!resultado.ok) throw new Error(`RF20_COPIA_PREGUNTA_RECHAZADA:${resultado.motivo}`);
    }
    return { id, numero: primera(filas, "corregir_cuestionario_version").numero };
  });
}
