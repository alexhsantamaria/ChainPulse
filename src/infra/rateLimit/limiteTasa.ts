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
  // Incremento 5 PR1 -- idem (ver huella.ts): se reexportan aca para que
  // route.ts importe todo del rate limiter desde un solo modulo, mismo
  // criterio que el resto de esta lista.
  LIMITE_CONSULTA_EJECUTAR,
  codificarHuellaConsultaAutenticada,
  calcularSegundosHastaProximoIntentoPermitido,
  type BucketConteo,
} from "./huella";
import { truncarVentanaBucket, BUCKET_MINUTOS_LIMITE_TASA, BUCKETS_POR_VENTANA_LIMITE_TASA } from "./huella";
import type { BucketConteo } from "./huella";

export type BucketLimiteTasa =
  | "INICIO_EVALUACION"
  | "DESBLOQUEO_DETALLE"
  | "LOGIN_PLATAFORMA"
  | "VERIFICACION_MFA_PLATAFORMA"
  | "CONSULTA_EJECUTAR";

export interface ResultadoLimiteTasa {
  contador: number;
  permitido: boolean;
  // Incremento 5 PR1 -- desglose por bucket de la ventana deslizante
  // vigente (ventanaInicio+contador de cada fila sumada), agregado para
  // que quien llama pueda calcular, con
  // calcularSegundosHastaProximoIntentoPermitido() (huella.ts) cuando !permitido,
  // el Retry-After calculado para el PROXIMO intento -- exacto bajo el
  // supuesto de que no se registren solicitudes adicionales durante la
  // espera (ver el docstring de esa funcion en huella.ts). Los 4
  // llamadores existentes (evaluations, unlock, login, mfa) solo
  // destructuran .contador/.permitido -- agregar este campo no les
  // rompe nada.
  buckets: BucketConteo[];
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
  ventanaEnBuckets: number = BUCKETS_POR_VENTANA_LIMITE_TASA,
): Promise<ResultadoLimiteTasa> {
  if (!Number.isInteger(ventanaEnBuckets) || ventanaEnBuckets < 1) {
    throw new RangeError("ventanaEnBuckets debe ser un entero mayor o igual a 1");
  }
  const ventanaInicio = truncarVentanaBucket(ahora);
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "limite_tasa" ("id", "huellaOrigenHash", "bucket", "ventanaInicio", "contador")
    VALUES (${id}, ${huellaOrigenHash}, ${bucket}::"BucketLimiteTasa", ${ventanaInicio}, 1)
    ON CONFLICT ("huellaOrigenHash", "bucket", "ventanaInicio")
    DO UPDATE SET "contador" = "limite_tasa"."contador" + 1
  `;

  const inicioVentanaDeslizante = new Date(
    ventanaInicio.getTime() - (ventanaEnBuckets - 1) * BUCKET_MINUTOS_LIMITE_TASA * 60_000,
  );
  // Incremento 5 PR1 -- antes esta consulta hacia SELECT SUM("contador")
  // (un solo numero agregado). Se cambia a traer las filas crudas
  // (ventanaInicio + contador de cada bucket, sin agregar en SQL) porque
  // calcularSegundosHastaProximoIntentoPermitido() (huella.ts) necesita el desglose
  // POR bucket para calcular el Retry-After del PROXIMO intento -- exacto
  // bajo el supuesto de que no se registren solicitudes adicionales
  // durante la espera (ver el docstring de esa funcion) -- sumar en JS en
  // vez de en SQL no cambia el total que se devuelve en `contador` (sigue
  // siendo la misma suma), asi que esto es compatible con los 4
  // llamadores existentes que ya usaban ese campo.
  const filas = await prisma.$queryRaw<{ ventanaInicio: Date; contador: number }[]>`
    SELECT "ventanaInicio", "contador"
    FROM "limite_tasa"
    WHERE "huellaOrigenHash" = ${huellaOrigenHash}
      AND "bucket" = ${bucket}::"BucketLimiteTasa"
      AND "ventanaInicio" >= ${inicioVentanaDeslizante}
      AND "ventanaInicio" <= ${ventanaInicio}
  `;
  // A diferencia del SUM() agregado que esta consulta devolvia antes
  // (que Postgres promueve a BIGINT, entregado como string por el
  // driver "pg" para no perder precision), "contador" aca es la columna
  // INTEGER cruda de cada fila -- el driver la entrega ya como number;
  // Number() se mantiene solo como resguardo defensivo, no porque se
  // espere un string.
  const buckets: BucketConteo[] = filas.map((fila: { ventanaInicio: Date; contador: number }) => ({
    ventanaInicio: new Date(fila.ventanaInicio),
    contador: Number(fila.contador),
  }));
  const contador = buckets.reduce((suma, b) => suma + b.contador, 0);
  return { contador, permitido: contador <= limite, buckets };
}
