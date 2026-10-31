// Infraestructura — lecturas de RF20 para la API/UI de PR 8.
//
// A diferencia de gobernanzaVersiones.ts (que SOLO invoca funciones
// SECURITY DEFINER para no duplicar ninguna invariante de escritura), las
// consultas de este archivo son SELECT simples via Prisma: chainpulse_app
// tiene GRANT SELECT directo sobre cuestionario_versiones, pregunta_versiones
// y bitacora_version_cuestionario (adenda-diseno-rf19-rf20-v7.md §4.1) --
// no existe ninguna regla de negocio que proteger en una lectura, asi que
// usar el ORM aqui no "duplica logica SQL" en el sentido que si aplicaria
// a crear/corregir/publicar/retirar (eso vive exclusivamente en las
// funciones de public. y en gobernanzaVersiones.ts).
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../prisma/client";

type ClienteLectura = Pick<PrismaClient, "cuestionarioVersion" | "preguntaVersion">;

export interface ResumenCuestionario {
  codigo: string;
  totalVersiones: number;
  versionPublicada: { id: string; numero: number } | null;
  ultimaVersion: { id: string; numero: number; estado: string };
}

// Tipo local explicito para la fila seleccionada -- el cliente "client"
// engine (ADR-0003) a veces no logra inferir el shape exacto de un
// select() a traves de Pick<PrismaClient,...>, degradando a unknown/any
// (mismo sintoma preexistente visto en gobernanzaVersiones.ts, no
// introducido por PR 8); anotar el tipo aqui evita implicit-any sin
// tocar ese comportamiento del cliente.
interface FilaResumenCuestionario {
  id: string;
  codigo: string;
  numero: number;
  estado: string;
}

/** Un renglon por codigo distinto, para la pantalla principal de RF20. */
export async function listarCuestionarios(cliente: ClienteLectura = prisma): Promise<ResumenCuestionario[]> {
  const filas = (await cliente.cuestionarioVersion.findMany({
    select: { id: true, codigo: true, numero: true, estado: true },
    orderBy: [{ codigo: "asc" }, { numero: "desc" }],
  })) as FilaResumenCuestionario[];

  const porCodigo = new Map<string, FilaResumenCuestionario[]>();
  for (const fila of filas) {
    const lista = porCodigo.get(fila.codigo);
    if (lista) lista.push(fila);
    else porCodigo.set(fila.codigo, [fila]);
  }

  return [...porCodigo.entries()].map(([codigo, versiones]) => ({
    codigo,
    totalVersiones: versiones.length,
    versionPublicada: versiones.find((v: FilaResumenCuestionario) => v.estado === "PUBLICADA") ?? null,
    // versiones[0] existe siempre: porCodigo solo tiene entradas con >= 1 fila.
    ultimaVersion: versiones[0]!,
  }));
}

export interface VersionListada {
  id: string;
  numero: number;
  estado: string;
  publicadaEn: Date | null;
  retiradaEn: Date | null;
  notasCambio: string | null;
  curadorId: string | null;
  totalPreguntas: number;
}

/** Todas las versiones de un codigo, mas recientes primero. */
export async function listarVersionesPorCodigo(
  codigo: string,
  cliente: ClienteLectura = prisma,
): Promise<VersionListada[]> {
  const filas = (await cliente.cuestionarioVersion.findMany({
    where: { codigo },
    orderBy: { numero: "desc" },
    select: {
      id: true,
      numero: true,
      estado: true,
      publicadaEn: true,
      retiradaEn: true,
      notasCambio: true,
      curadorId: true,
      _count: { select: { preguntas: true } },
    },
  })) as Array<{
    id: string;
    numero: number;
    estado: string;
    publicadaEn: Date | null;
    retiradaEn: Date | null;
    notasCambio: string | null;
    curadorId: string | null;
    _count: { preguntas: number };
  }>;
  return filas.map((fila) => ({
    id: fila.id,
    numero: fila.numero,
    estado: fila.estado,
    publicadaEn: fila.publicadaEn,
    retiradaEn: fila.retiradaEn,
    notasCambio: fila.notasCambio,
    curadorId: fila.curadorId,
    totalPreguntas: fila._count.preguntas,
  }));
}

export interface PreguntaListada {
  id: string;
  codigo: string;
  orden: number;
  texto: string;
  dimension: string;
  opciones: unknown;
  esNoPuntuable: boolean;
}

export interface DetalleVersion {
  id: string;
  codigo: string;
  numero: number;
  estado: string;
  publicadaEn: Date | null;
  retiradaEn: Date | null;
  notasCambio: string | null;
  curadorId: string | null;
  preguntas: PreguntaListada[];
}

/** Detalle completo de una version (metadata + preguntas en orden) para el area de edicion. Devuelve null si no existe. */
export async function obtenerDetalleVersion(
  versionId: string,
  cliente: ClienteLectura = prisma,
): Promise<DetalleVersion | null> {
  const version = await cliente.cuestionarioVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      codigo: true,
      numero: true,
      estado: true,
      publicadaEn: true,
      retiradaEn: true,
      notasCambio: true,
      curadorId: true,
    },
  });
  if (!version) return null;

  const preguntas = await cliente.preguntaVersion.findMany({
    where: { cuestionarioVersionId: versionId },
    orderBy: { orden: "asc" },
    select: { id: true, codigo: true, orden: true, texto: true, dimension: true, opciones: true, esNoPuntuable: true },
  });

  return { ...version, preguntas };
}
