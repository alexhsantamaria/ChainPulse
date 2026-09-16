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

export { hashHuellaOrigen, truncarVentanaHora, LIMITE_INICIO_EVALUACION, LIMITE_DESBLOQUEO_DETALLE } from "./huella";
import { truncarVentanaHora } from "./huella";

export type BucketLimiteTasa = "INICIO_EVALUACION" | "DESBLOQUEO_DETALLE";

export interface ResultadoLimiteTasa {
  contador: number;
  permitido: boolean;
}

/**
 * Incrementa (o crea) atomicamente el contador de la huella+bucket+ventana
 * vigente y evalua si ya supero el limite dado. Una sola sentencia UPSERT
 * (INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING) para que dos
 * invocaciones serverless concurrentes de la misma huella nunca pierdan un
 * incremento por una condicion de carrera de lectura-luego-escritura
 * (PLAN-DE-TRABAJO.md Seccion 18.1.C).
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
  const ventanaInicio = truncarVentanaHora(ahora);
  const id = randomUUID();
  const filas = await prisma.$queryRaw<{ contador: number }[]>`
    INSERT INTO "limite_tasa" ("id", "huellaOrigenHash", "bucket", "ventanaInicio", "contador")
    VALUES (${id}, ${huellaOrigenHash}, ${bucket}::"BucketLimiteTasa", ${ventanaInicio}, 1)
    ON CONFLICT ("huellaOrigenHash", "bucket", "ventanaInicio")
    DO UPDATE SET "contador" = "limite_tasa"."contador" + 1
    RETURNING "contador"
  `;
  const contador = filas[0]?.contador ?? 1;
  return { contador, permitido: contador <= limite };
}
