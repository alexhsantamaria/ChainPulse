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
 * Seccion 18.1.C). De la SUMA que evalua `permitido`, el componente del
 * bucket ACTUAL queda serializado EXACTAMENTE por ese mismo UPSERT (ver
 * la CORRECCION mas abajo); el componente de los buckets ANTERIORES
 * sigue viniendo de una consulta aparte, y ahi SI persiste la
 * aproximacion ya documentada (R5-19, ./huella.ts) -- aceptable para un
 * limitador de tasa que nunca pretendio ser una garantia matematica
 * exacta, solo limitar abuso.
 *
 * `prisma` es obligatorio (sin valor por defecto) a proposito: quien la
 * llama en produccion importa el singleton de src/infra/prisma/client.ts y
 * lo pasa explicitamente — evita que este modulo dispare la construccion
 * del cliente de Prisma con solo importarlo, que es justamente lo que hace
 * intestable a src/infra/retencion.ts si no se tiene cuidado (ver el
 * comentario de ese archivo).
 *
 * CORRECCION 2026-11-17 (ronda 4 de revision de Alex, sobre el PR1 ya
 * publicado) -- ANTES, el incremento (UPSERT via $executeRaw) y la
 * lectura del contador resultante (SELECT via $queryRaw) eran DOS
 * sentencias autocommit separadas. Eso es una condicion de carrera real
 * en la frontera: con el contador inicial en limite-1 (p.ej. 29 con
 * limite=30), dos solicitudes concurrentes podian completar AMBOS
 * incrementos (dejando la fila en 31) antes de que CUALQUIERA de las
 * dos ejecutara su propio SELECT -- las 2 terminaban leyendo el mismo
 * contador final (31) y las 2 quedaban rechazadas, cuando en realidad
 * una de ellas (la que logicamente ocurrio primero, viendo 30) deberia
 * quedar permitida. El UPSERT atomico por si solo evita perder
 * incrementos (eso siempre fue correcto), pero NO evita que una lectura
 * posterior, separada, observe el estado ya modificado por la OTRA
 * solicitud concurrente.
 *
 * CORRECCION: el incremento y la lectura del contador del bucket ACTUAL
 * (huella+bucket+ventanaInicio exactos de esta llamada) se funden en
 * una sola sentencia atomica con RETURNING -- Postgres serializa el
 * UPSERT en conflicto con un bloqueo de fila, y cada invocacion
 * concurrente recibe, desde el RETURNING de SU PROPIA sentencia, el
 * valor ya incrementado que le corresponde (nunca el de la otra). El
 * bucket ACTUAL, y SOLO el bucket actual, queda serializado de forma
 * EXACTA por esta via -- su contador nunca vuelve a leerse por
 * separado, siempre viene del RETURNING.
 *
 * Los buckets ANTERIORES de la ventana deslizante (ventanaInicio
 * estrictamente menor al de esta llamada) se siguen leyendo en una
 * consulta SEPARADA, autocommit -- y esa lectura SIGUE siendo una
 * aproximacion, la misma que ya documenta R5-19 en ./huella.ts, NUNCA
 * una garantia matematica exacta: puede coincidir en el tiempo con una
 * solicitud EN VUELO de esta misma huella que, por el reloj, ya cruzo
 * la frontera hacia uno de esos buckets "anteriores" (su propio
 * truncarVentanaBucket() cayo un instante antes del de esta llamada)
 * pero cuyo UPSERT todavia no esta confirmado cuando esta consulta
 * corre -- esa solicitud en vuelo puede quedar fuera (o, segun el orden
 * exacto de confirmacion, adentro) de la suma de "anteriores" que lee
 * esta llamada. Es exactamente el mismo riesgo, acotado a un solo
 * bucket, que R5-19 ya redujo (de "una ventana completa" a "como mucho
 * un bucket de 15 minutos") y que esta correccion NO elimina -- solo
 * elimina la condicion de carrera nueva e independiente que afectaba al
 * bucket ACTUAL (ver arriba).
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

  // Incremento + lectura del bucket ACTUAL en UNA sola sentencia atomica
  // (ver docstring arriba). RETURNING "contador" entrega, para ESTA
  // invocacion, el valor ya incrementado que Postgres serializo para
  // ella -- nunca el de una invocacion concurrente distinta.
  const [filaActual] = await prisma.$queryRaw<{ contador: number }[]>`
    INSERT INTO "limite_tasa" ("id", "huellaOrigenHash", "bucket", "ventanaInicio", "contador")
    VALUES (${id}, ${huellaOrigenHash}, ${bucket}::"BucketLimiteTasa", ${ventanaInicio}, 1)
    ON CONFLICT ("huellaOrigenHash", "bucket", "ventanaInicio")
    DO UPDATE SET "contador" = "limite_tasa"."contador" + 1
    RETURNING "contador"
  `;
  // Defensivo en RUNTIME, no solo para satisfacer a TypeScript (TS18048:
  // "filaActual" es posiblemente undefined porque $queryRaw tipa el
  // resultado como un arreglo, y destructurar su primer elemento nunca
  // es, para TypeScript, una garantia de que exista). Un INSERT ... ON
  // CONFLICT ... DO UPDATE ... RETURNING SIEMPRE afecta y devuelve
  // EXACTAMENTE una fila (inserta una si no habia conflicto, actualiza
  // la unica fila en conflicto si lo habia) -- un arreglo vacio aca
  // significaria que Postgres o el driver "pg" se comportaron de una
  // forma que contradice la semantica documentada de esa sentencia,
  // NUNCA un resultado de negocio valido (como "todavia sin intentos").
  // Se valida explicitamente y se lanza un error descriptivo, en vez de
  // una aserción no nula (`!`) que silenciaria el caso sin dejar rastro
  // si alguna vez llegara a ocurrir.
  if (filaActual === undefined) {
    throw new Error(
      `registrarIntento(): el RETURNING del UPSERT de "limite_tasa" no devolvio ninguna fila ` +
        `(huella=${huellaOrigenHash}, bucket=${bucket}, ventanaInicio=${ventanaInicio.toISOString()}) ` +
        `-- un INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING siempre deberia devolver ` +
        `exactamente 1 fila; esto indica un problema de infraestructura (Postgres o el driver "pg"), ` +
        `nunca un resultado de negocio valido.`,
    );
  }
  // Mismo resguardo defensivo que antes (ver mas abajo): el driver "pg"
  // ya entrega la columna INTEGER como number; Number() no es por un
  // string esperado, es defensivo.
  const contadorBucketActual = Number(filaActual.contador);

  const inicioVentanaDeslizante = new Date(
    ventanaInicio.getTime() - (ventanaEnBuckets - 1) * BUCKET_MINUTOS_LIMITE_TASA * 60_000,
  );
  // Solo los buckets ANTERIORES al actual ("ventanaInicio" ESTRICTAMENTE
  // menor -- nunca <=, para no volver a leer el bucket actual, que ya se
  // obtuvo arriba desde el RETURNING de su propio UPSERT atomico). Esta
  // lectura separada sigue siendo la misma aproximacion ya documentada
  // en R5-19 (./huella.ts), NUNCA una garantia matematica exacta: puede
  // coincidir con una solicitud en vuelo de esta misma huella que ya
  // cruzo la frontera hacia uno de estos buckets "anteriores" pero cuyo
  // UPSERT todavia no esta confirmado (ver el docstring de esta funcion
  // para el detalle completo) -- a diferencia del bucket ACTUAL (arriba),
  // que si queda serializado de forma exacta.
  const filasAnteriores = await prisma.$queryRaw<{ ventanaInicio: Date; contador: number }[]>`
    SELECT "ventanaInicio", "contador"
    FROM "limite_tasa"
    WHERE "huellaOrigenHash" = ${huellaOrigenHash}
      AND "bucket" = ${bucket}::"BucketLimiteTasa"
      AND "ventanaInicio" >= ${inicioVentanaDeslizante}
      AND "ventanaInicio" < ${ventanaInicio}
  `;
  // A diferencia del SUM() agregado que esta consulta devolvia antes
  // (que Postgres promueve a BIGINT, entregado como string por el
  // driver "pg" para no perder precision), "contador" aca es la columna
  // INTEGER cruda de cada fila -- el driver la entrega ya como number;
  // Number() se mantiene solo como resguardo defensivo, no porque se
  // espere un string.
  const buckets: BucketConteo[] = [
    { ventanaInicio, contador: contadorBucketActual },
    ...filasAnteriores.map((fila: { ventanaInicio: Date; contador: number }) => ({
      ventanaInicio: new Date(fila.ventanaInicio),
      contador: Number(fila.contador),
    })),
  ];
  const contador = buckets.reduce((suma, b) => suma + b.contador, 0);
  return { contador, permitido: contador <= limite, buckets };
}
