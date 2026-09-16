// Infraestructura — purga automatica de datos de seguridad de vida corta
// (RF15/RF17, Bloque A del Incremento 2, PLAN-DE-TRABAJO.md Seccion 18.1.E).
// Deuda ya vencida del Incremento 1 (PLAN-DE-TRABAJO.md Seccion 4): la
// huella de origen de EvaluacionExpres nunca se purgaba porque este archivo
// no existia todavia. Se ejecuta como job recurrente disparado por
// src/app/api/internal/jobs/run (ver src/infra/jobs/).
//
// `prisma` es obligatorio (sin valor por defecto, sin importar el singleton
// de src/infra/prisma/client.ts en este archivo): quien llama a esta
// funcion en produccion (src/infra/jobs/purgaHuellaOrigenJob.ts) importa
// ese singleton y lo pasa explicitamente. Si este archivo importara el
// singleton real para usarlo como valor por defecto, cualquier prueba
// unitaria que solo quisiera importar purgarHuellasOrigen() dispararia la
// construccion real de PrismaClient con solo cargar el modulo — y esa
// construccion falla en este entorno de desarrollo mientras
// "prisma generate" siga bloqueado por la politica de red (ver README.md,
// "Bloqueo de entorno resuelto"). Con el parametro obligatorio, este
// archivo es seguro de importar y sus pruebas (__tests__/retencion.test.ts)
// corren con un cliente falso, sin tocar Prisma en absoluto.
import type { PrismaClient } from "@prisma/client";

// Purga a partir de las 48h (limite inferior de la ventana documentada en
// requirements.md Seccion 12, punto 4). Con la cadencia diaria de Vercel
// Hobby (ADR-0004, PLAN-DE-TRABAJO.md Seccion 18.1.E) el peor caso real de
// este job es ~96h, no los 72h del rango original — correccion de
// redaccion ya senalada ahi, aceptable frente al limite duro de 90 dias.
const HUELLA_ORIGEN_PURGA_HORAS = 48;
const HORA_MS = 60 * 60 * 1000;

// huellaOrigen es String no-nullable en el schema (Incremento 1, no se
// modifica su tipo por disciplina aditiva — PLAN-DE-TRABAJO.md Seccion 12,
// "Riesgos de migracion"). La purga sobreescribe con "" en vez de null:
// mismo efecto (ningun dato identificable sobrevive) sin requerir una
// migracion de columna.
const HUELLA_ORIGEN_PURGADA = "";

// Las filas de LimiteTasa describen "hasta N intentos en esta hora" — una
// vez que esa hora paso hace rato, no protegen nada ni sirven de auditoria
// (a diferencia de Consentimiento, esto no es un "recibo" legal). Se
// conservan 2h de margen sobre la hora que describen (no 0), para no
// competir en limpieza con una fila que todavia pudiera estar en uso justo
// al cruzar el borde de la hora.
const LIMITE_TASA_MARGEN_HORAS = 2;

export interface ResultadoPurga {
  huellasOrigenPurgadas: number;
  filasLimiteTasaEliminadas: number;
}

/**
 * Purga la huella de origen de toda EvaluacionExpres (v1) Y EvaluacionExpresV2
 * (R5-4, Ronda 5: el Incremento 2 agrego una segunda tabla con el mismo
 * patron huellaOrigen/huellaOrigenPurgadaEn -- ver el comentario de ese
 * campo en prisma/schema.prisma -- y este job no la purgaba todavia) con
 * mas de 48h de antiguedad que todavia no fue purgada, y elimina las filas
 * de LimiteTasa ya fuera de su ventana vigente.
 */
export async function purgarHuellasOrigen(
  ahora: Date,
  prisma: PrismaClient,
): Promise<ResultadoPurga> {
  const limiteEdad = new Date(ahora.getTime() - HUELLA_ORIGEN_PURGA_HORAS * HORA_MS);

  const [evaluaciones, evaluacionesV2] = await Promise.all([
    prisma.evaluacionExpres.updateMany({
      where: {
        huellaOrigenPurgadaEn: null,
        createdAt: { lte: limiteEdad },
      },
      data: {
        huellaOrigen: HUELLA_ORIGEN_PURGADA,
        huellaOrigenPurgadaEn: ahora,
      },
    }),
    prisma.evaluacionExpresV2.updateMany({
      where: {
        huellaOrigenPurgadaEn: null,
        createdAt: { lte: limiteEdad },
      },
      data: {
        huellaOrigen: HUELLA_ORIGEN_PURGADA,
        huellaOrigenPurgadaEn: ahora,
      },
    }),
  ]);

  const limiteVentana = new Date(ahora.getTime() - LIMITE_TASA_MARGEN_HORAS * HORA_MS);
  const limiteTasa = await prisma.limiteTasa.deleteMany({
    where: { ventanaInicio: { lte: limiteVentana } },
  });

  return {
    huellasOrigenPurgadas: evaluaciones.count + evaluacionesV2.count,
    filasLimiteTasaEliminadas: limiteTasa.count,
  };
}
