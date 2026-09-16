// Infraestructura — limite de tasa Postgres-nativo (RF15/RF17, Bloque A del
// Incremento 2, PLAN-DE-TRABAJO.md Seccion 18.1.C/18.4.F). Sin Redis: un
// UPSERT atomico sobre la tabla LimiteTasa (tenant nulo, igual que
// EvaluacionExpres), con ventana fija por hora — no una ventana deslizante:
// alcanza para el proposito de RF15/RF17 (limitar abuso, no una garantia
// matematica exacta) y evita cualquier estado en memoria del proceso, que
// no sirve en invocaciones serverless independientes (motivo original por
// el que se documento RATE_LIMIT_STORE_URL, ya retirado de .env.example).
//
// Los helpers puros (hash, truncado de ventana) viven en ./huella.ts y se
// reexportan aca para que el codigo que use este modulo tenga un solo punto
// de import — separados a proposito de registrarIntento(), que si necesita
// una conexion real a Postgres y por eso no se puede probar en este entorno
// de desarrollo (ver ./huella.ts y su __tests__).
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export {
  hashHuellaOrigen,
  truncarVentanaBucket,
  LIMITE_INICIO_EVALUACION,
  LIMITE_DESBLOQUEO_DETALLE,
  BUCKET_MINUTOS_LIMITE_TASA,
  VENTANA_MINUTOS_LIMITE_TASA,
  BUCKETS_POR_VENTANA_LIMITE_TASA,
} from "./huella";
import { truncarVentanaBucket, BUCKET_MINUTOS_LIMITE_TASA, BUCKETS_POR_VENTANA_LIMITE_TASA } from "./huella";

export type BucketLimiteTasa = "INICIO_EVALUACION" | "DESBLOQUEO_DETALLE";

export interface ResultadoLimiteTasa {
  contador: number;
  permitido: boolean;
}

/**
 * Incrementa (o crea) atomicamente el contador del bucket de 15 minutos
 * vigente (huella+bucket+ventana) y evalua si la SUMA de los ultimos
 * BUCKETS_POR_VENTANA_LIMITE_TASA buckets (ventana deslizante aproximada,
 * R5-19 -- ver el comentario en ./huella.ts) ya supero el limite dado.
 *
 * El incremento sigue siendo una sola sentencia UPSERT (INSERT ... ON
 * CONFLICT ... DO UPDATE) para que dos invocaciones serverless
 * concurrentes de la misma huella nunca pierdan un incremento por una
 * condicion de carrera de lectura-luego-escritura (PLAN-DE-TRABAJO.md
 * Seccion 18.1.C) -- la lectura de la suma es una consulta aparte,
 * aceptable para un limitador de tasa que ya documenta que no es una
 * garantia matematica exacta (ver ./huella.ts).
 *
 * `prisma` es obligatorio (sin valor por defecto) a proposito: quien la
 * llama en produccion importa el singleton de src/infra/prisma/client.ts y
 * lo pasa explicitamente — evita que este modulo dispare la construccion
 * del cliente de Prisma con solo importarlo, que es justamente lo que hace
 * intestable a src/infra/retencion.ts si no se tiene cuidado (ver el
 * comentario de ese archivo).
 */
export async function registrarIntento(
  huellaOrigenHash: string,
  bucket: BucketLimiteTasa,
  limite: number,
  ahora: Date,
  prisma: PrismaClient,
): Promise<ResultadoLimiteTasa> {
  const ventanaInicio = truncarVentanaBucket(ahora);
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "limite_tasa" ("id", "huellaOrigenHash", "bucket", "ventanaInicio", "contador")
    VALUES (${id}, ${huellaOrigenHash}, ${bucket}::"BucketLimiteTasa", ${ventanaInicio}, 1)
    ON CONFLICT ("huellaOrigenHash", "bucket", "ventanaInicio")
    DO UPDATE SET "contador" = "limite_tasa"."contador" + 1
  `;

  const inicioVentanaDeslizante = new Date(
    ventanaInicio.getTime() - (BUCKETS_POR_VENTANA_LIMITE_TASA - 1) * BUCKET_MINUTOS_LIMITE_TASA * 60_000,
  );
  const filas = await prisma.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COALESCE(SUM("contador"), 0) AS total
    FROM "limite_tasa"
    WHERE "huellaOrigenHash" = ${huellaOrigenHash}
      AND "bucket" = ${bucket}::"BucketLimiteTasa"
      AND "ventanaInicio" >= ${inicioVentanaDeslizante}
      AND "ventanaInicio" <= ${ventanaInicio}
  `;
  // SUM() de una columna INTEGER vuelve BIGINT en Postgres -- el driver
  // "pg" lo entrega como string para no perder precision fuera del rango
  // seguro de Number; Number() alcanza aca porque el volumen real de
  // intentos por huella nunca se acerca a ese limite.
  const contador = Number(filas[0]?.total ?? 0);
  return { contador, permitido: contador <= limite };
}
