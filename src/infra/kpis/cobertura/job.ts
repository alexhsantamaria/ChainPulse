// Infraestructura -- job de pg-boss que procesa una ImportacionCsv de
// Cobertura ya confirmada (Incremento 4 Bloque B, vertical slice).
// Descarga+descifra el objeto de R2, parsea el CSV, escribe
// ObservacionCobertura por lotes y, si aplica, retira lo que quedo fuera
// del alcance -- mismo patron fetch/complete/fail que
// purgaHuellaOrigenJob.ts (nunca boss.work()).
//
// Por que este job NUNCA hace un SELECT cross-tenant para descubrir
// trabajo (a diferencia de un futuro job que si pudiera necesitarlo): el
// rol de runtime de la app (chainpulse_app) nunca tiene BYPASSRLS
// (prisma/rls.sql) -- cualquier lectura de "importaciones_csv" sin
// app.tenant_id fijado devuelve CERO filas, no todas. La UNICA cola de
// trabajo confiable entre tenants es pg-boss (schema "pgboss", fuera de
// RLS) -- boss.fetch() entrega el payload {importId, empresaId} que cada
// job ya trae desde que se encolo (ver encolarImportacionCsv()), y a
// partir de ahi TODO acceso a datos usa tenantClient/tenantTransaction
// scoped a ese empresaId (ADR-0001, RLS como segunda capa).
//
// Retry-safety de punta a punta: si este handler lanza a mitad de
// camino (batch fallido, R2 caido, Neon con cold-start), pg-boss
// reintenta el job COMPLETO mas adelante (retryLimit/retryDelay/
// retryBackoff en encolarImportacionCsv()) -- reprocesar desde el primer
// batch es seguro porque cada fila es retry-safe por importId+numeroFila
// (ver importar.ts) y el retiro por alcance solo corre si TODOS los
// batches de ESTA invocacion terminaron sin lanzar (nunca deja
// resultados parciales como definitivos, Alex 2026-09-25).
import type { PgBoss, Db as PgBossDb } from "pg-boss";
import Papa from "papaparse";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { tenantClient } from "../../prisma/tenantClient";
import { ClienteAlmacenamientoR2 } from "../../storage/r2";
import { descifrarContenido, desenvolverDek, obtenerClaveMaestraPorId } from "../../storage/cifradoObjeto";
import { RULE_VERSION_KPIS } from "../../../engine/kpis/constantes";
import {
  validarMapeoColumnas,
  detectarColumnasSospechosasDeConsumo,
  type MapeoColumnasCobertura,
} from "../../../domain/mapeoColumnasCsv";
import { interpretarFilaCobertura } from "../../../domain/interpretarFilaCoberturaCsv";
import { prepararFilasCoberturaParaImportar } from "../../../domain/prepararFilasCoberturaParaImportar";
import {
  importarObservacionesCobertura,
  finalizarConRetiroAutorizado,
  claveNegocio,
  type ContextoImportacionCobertura,
} from "./importar";

export const COLA_IMPORTACION_CSV = "procesar-importacion-csv";

export interface PayloadImportacionCsv {
  importId: string;
  empresaId: string;
}

// Forma persistida de ImportacionCsv.mapeoColumnas (Json) -- "propuesto"
// lo escribe la ruta de subir (heuristica, editable), "confirmado" lo
// escribe la ruta de confirmar (lo que el usuario realmente valido) y es
// lo UNICO que este job usa -- nunca "propuesto", que es solo una ayuda
// de UI. "encabezados" es la lista real de columnas del archivo (nunca
// la manda el cliente en el body de confirmar -- se re-valida siempre
// contra esto, persistido en la subida).
//
// "sospechosasReconocidas" (bug real encontrado por Alex 2026-09-25,
// importacion b221c930-054e...): la ruta de confirmar YA validaba
// `columnasSospechosasReconocidas` del body contra las sospechosas
// detectadas (COLUMNAS_SOSPECHOSAS_SIN_RESOLVER si faltaba alguna) pero
// nunca persistia esa lista -- solo la usaba en memoria para esa
// respuesta HTTP y la descartaba. Este job vuelve a detectar las mismas
// columnas sospechosas (misma regla, defensa en profundidad -- ver mas
// abajo) pero, sin la lista persistida, no tenia forma de distinguir
// "el usuario ya las reconocio" de "nunca se reviso" -- fallaba SIEMPRE
// que detectaba una sospechosa, aunque la confirmacion hubiera sido
// perfectamente valida. `?? []` cubre las ImportacionCsv confirmadas
// antes de este fix (quedaron con este campo ausente, no vacio) --
// para esas, el comportamiento visible no cambia (siguen fallando si
// tenian alguna sospechosa sin resolver en su momento); solo las
// confirmaciones nuevas quedan bien.
export interface MapeoColumnasPersistido {
  encabezados: string[];
  propuesto: MapeoColumnasCobertura;
  confirmado: MapeoColumnasCobertura | null;
  sospechosasReconocidas?: string[];
}

/**
 * Encola el procesamiento de una importacion ya confirmada.
 * singletonKey=importId evita que dos confirmaciones (doble click,
 * reintento de red del cliente) encolen dos jobs en paralelo para la
 * misma importacion.
 *
 * `db` (opcional): adaptador IDatabase de pg-boss (ver `pg-boss/adapters`,
 * p.ej. `fromPrisma(tx)`) para que el INSERT del job corra DENTRO de una
 * transaccion externa en vez del pool propio de PgBoss -- asi la ruta de
 * confirmar puede persistir mapeo/estrategia/fuenteConsumo/periodo +
 * estado=CONFIRMADA + encolar el job, todo en UNA sola transaccion
 * atomica (ver tenantTransaction() en la ruta de confirmar). Sin `db`,
 * usa el pool propio de PgBoss como siempre (p.ej. si algun dia se
 * encola fuera de una transaccion de tenant).
 */
export async function encolarImportacionCsv(
  boss: PgBoss,
  payload: PayloadImportacionCsv,
  opciones: { db?: PgBossDb } = {},
): Promise<string | null> {
  return boss.send(COLA_IMPORTACION_CSV, payload, {
    singletonKey: payload.importId,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    ...(opciones.db ? { db: opciones.db } : {}),
  });
}

async function marcarError(empresaId: string, importId: string, mensaje: string): Promise<void> {
  await tenantClient(empresaId).importacionCsv.update({
    where: { id: importId },
    data: { estado: "ERROR", erroresMuestra: [{ error: mensaje }] },
  });
}

/**
 * Procesa UNA importacion ya confirmada. Exportada por separado de
 * procesarImportacionesCsv() (que hace fetch/complete/fail) para poder
 * probarla con Prisma/R2/cifrado mockeados, sin un PgBoss real.
 */
export async function procesarUnaImportacionCsv({ importId, empresaId }: PayloadImportacionCsv): Promise<void> {
  const cliente = tenantClient(empresaId);
  const importacion = await cliente.importacionCsv.findUnique({ where: { id: importId } });

  if (!importacion) {
    // tenantClient ya filtro por empresaId -- si no aparece, no existe o
    // no le pertenece a esta empresa. Nada que procesar, no es un error.
    return;
  }
  if (importacion.procesadaEn) {
    // Salvaguarda extra (ver el comentario de procesadaEn en
    // prisma/schema.prisma) -- ya termino con exito, nunca se reprocesa
    // ni se repite el retiro por alcance.
    return;
  }
  if (!importacion.confirmadaEn) {
    // No deberia pasar (solo se encola despues de confirmar) -- fallar
    // cerrado en vez de asumir.
    throw new Error(`ImportacionCsv ${importId}: no tiene confirmadaEn, no deberia estar en la cola`);
  }
  if (
    !importacion.objetoStorageKey ||
    importacion.cifradoVersion == null ||
    !importacion.cifradoClaveId ||
    !importacion.cifradoDek ||
    !importacion.cifradoDekIv ||
    !importacion.cifradoDekAuthTag
  ) {
    await marcarError(empresaId, importId, "Falta metadata de cifrado/almacenamiento -- la subida no debio quedar en este estado.");
    return;
  }
  // Alex, 2026-09-25: "Si faltan [fuenteConsumo/periodo], registrar un
  // error claro sin publicar resultados ni retirar observaciones
  // anteriores." -- nunca se asume un valor por defecto.
  if (!importacion.fuenteConsumo || !importacion.periodoReferenciaConsumoInicio || !importacion.periodoReferenciaConsumoFin) {
    await marcarError(empresaId, importId, "Falta fuenteConsumo o el periodo de referencia del consumo -- no se proceso ninguna fila.");
    return;
  }
  const mapeoPersistido = importacion.mapeoColumnas as unknown as MapeoColumnasPersistido | null;
  if (!mapeoPersistido?.confirmado) {
    await marcarError(empresaId, importId, "Falta el mapeo de columnas confirmado.");
    return;
  }

  // 1. Descargar + descifrar. Solo corre con credenciales reales de R2
  //    (mismo criterio "Windows-only" que test:integration, ver r2.ts).
  const almacenamiento = new ClienteAlmacenamientoR2();
  const objetoCifrado = await almacenamiento.descargarObjeto(importacion.objetoStorageKey);
  const claveMaestra = obtenerClaveMaestraPorId(importacion.cifradoClaveId);
  const dek = desenvolverDek(
    {
      dekCifrada: importacion.cifradoDek,
      iv: importacion.cifradoDekIv,
      authTag: importacion.cifradoDekAuthTag,
    },
    claveMaestra,
    empresaId,
    importId,
  );
  const contenido = descifrarContenido(objetoCifrado, dek, empresaId, importId);

  // 2. Parsear + re-validar el mapeo contra los encabezados REALES del
  //    archivo (nunca confiar en lo que penso la ruta de confirmar en su
  //    momento -- el archivo en R2 es la fuente de verdad).
  const parseado = Papa.parse<Record<string, string>>(contenido.toString("utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  const encabezadosReales = parseado.meta.fields ?? [];
  const validacionMapeo = validarMapeoColumnas(mapeoPersistido.confirmado, encabezadosReales);
  if (!validacionMapeo.valido) {
    await marcarError(
      empresaId,
      importId,
      `El mapeo de columnas confirmado ya no coincide con el archivo (campos faltantes: ${validacionMapeo.camposFaltantes.join(", ") || "ninguno"}; columnas invalidas: ${validacionMapeo.columnasInvalidas.join(", ") || "ninguna"}; duplicadas: ${validacionMapeo.columnasDuplicadas.join(", ") || "ninguna"}).`,
    );
    return;
  }
  const sospechosas = detectarColumnasSospechosasDeConsumo(encabezadosReales, mapeoPersistido.confirmado);
  const sospechosasReconocidas = mapeoPersistido.sospechosasReconocidas ?? [];
  const sospechosasSinResolver = sospechosas.filter((s) => !sospechosasReconocidas.includes(s.encabezado));
  if (sospechosasSinResolver.length > 0) {
    // Misma regla que la ruta de confirmar (defensa en profundidad: si
    // por algun bug la ruta de confirmar dejara pasar una sospechosa sin
    // reconocer, esto la atrapa igual) -- pero a diferencia de antes,
    // compara contra lo que el usuario reconocio realmente al confirmar
    // (ver el comentario de MapeoColumnasPersistido), no contra "ninguna
    // sospechosa detectada es aceptable".
    await marcarError(
      empresaId,
      importId,
      `El archivo trae columna(s) que parecen fuente/periodo de consumo sin resolver: ${sospechosasSinResolver.map((s) => s.encabezado).join(", ")}.`,
    );
    return;
  }

  // 3. Interpretar cada fila (dominio puro).
  const filasInterpretadas: { numeroFila: number; datos: import("../../../domain/interpretarFilaCoberturaCsv").FilaCoberturaInterpretada }[] = [];
  const erroresFila: { numeroFila: number; error: string }[] = [];
  const filas = parseado.data;
  for (let i = 0; i < filas.length; i += 1) {
    const numeroFila = i + 1; // 1-based, sin contar el encabezado -- ver interpretarFilaCoberturaCsv.ts
    const resultado = interpretarFilaCobertura(filas[i] ?? {}, numeroFila, mapeoPersistido.confirmado);
    if (resultado.ok) {
      filasInterpretadas.push({ numeroFila, datos: resultado.datos });
    } else {
      erroresFila.push({ numeroFila: resultado.numeroFila, error: resultado.error });
    }
  }

  // 4. calcularCobertura() UNA VEZ sobre todo el archivo (dominio puro) --
  //    zonaHoraria de la definicion global del KPI, nunca un default
  //    inventado aca.
  const definicionKpi = await prisma.definicionKpi.findUnique({ where: { id: importacion.definicionKpiId } });
  if (!definicionKpi) {
    await marcarError(empresaId, importId, `No se encontro DefinicionKpi ${importacion.definicionKpiId}.`);
    return;
  }
  const preparacion = prepararFilasCoberturaParaImportar(filasInterpretadas, definicionKpi.zonaHoraria);
  const erroresTotales = [...erroresFila, ...preparacion.erroresDuplicado];

  // 5. Escribir por lotes (infra -- tenantTransaction). Si CUALQUIER
  //    batch lanza, esta funcion entera lanza (propaga) -- el catch de
  //    procesarImportacionesCsv() llama a boss.fail(), pg-boss reintenta
  //    mas adelante, y el retiro por alcance (paso 6) NUNCA se alcanza en
  //    esta invocacion. Los batches ya confirmados en Postgres antes del
  //    fallo quedan (son transacciones independientes, ver importar.ts) --
  //    son observaciones reales y validas, no "resultados parciales
  //    incorrectos".
  const contexto: ContextoImportacionCobertura = {
    empresaId,
    cadenaId: importacion.cadenaId,
    definicionKpiId: importacion.definicionKpiId,
    importId,
    fuenteConsumo: importacion.fuenteConsumo,
    periodoReferenciaConsumoInicio: importacion.periodoReferenciaConsumoInicio,
    periodoReferenciaConsumoFin: importacion.periodoReferenciaConsumoFin,
    ruleVersion: RULE_VERSION_KPIS,
    zonaHorariaReferencia: definicionKpi.zonaHoraria,
  };
  await importarObservacionesCobertura(contexto, preparacion.filasParaGuardar);

  // 6+7. REEMPLAZO_ALCANCE: recomprobar el retiro autorizado, retirar y
  //      finalizar (estado=CONFIRMADA + procesadaEn) TODO en UNA sola
  //      transaccion atomica -- ver finalizarConRetiroAutorizado() en
  //      importar.ts para el detalle completo (por que se recomprueba
  //      antes de escribir, como se protege contra concurrencia, y por
  //      que retiro+finalizacion nunca quedan a medias uno sin el otro).
  //      clavesEnArchivo incluye TODA fila que se guardo o que ya estaba
  //      vigente sin cambios -- nunca solo las insertadas, o se
  //      retiraria por error una fila identica a la vigente.
  //      CARGA_PARCIAL no tiene retiro que autorizar -- finaliza aparte,
  //      mas abajo, en una sola escritura (atomica en si misma).
  if (importacion.estrategia === "REEMPLAZO_ALCANCE") {
    if (!importacion.alcanceFechaCorteInicio || !importacion.alcanceFechaCorteFin || !importacion.alcanceUbicaciones) {
      await marcarError(empresaId, importId, "REEMPLAZO_ALCANCE sin alcance completo (fechas + ubicaciones) -- no se retiro nada.");
      return;
    }
    if (!importacion.retiroHashConfirmado) {
      // No deberia poder pasar -- la ruta de confirmar siempre persiste
      // retiroHashConfirmado para REEMPLAZO_ALCANCE (ver el comentario
      // del campo en prisma/schema.prisma). Fallar cerrado en vez de
      // asumir o retirar sin autorizacion registrada.
      await marcarError(
        empresaId,
        importId,
        "REEMPLAZO_ALCANCE sin retiroHashConfirmado -- no hay autorizacion registrada para retirar nada. Hace falta una vista previa y una confirmacion nuevas.",
      );
      return;
    }
    const clavesEnArchivo = new Set(
      preparacion.filasParaGuardar.map((f) => claveNegocio(f.fila.sku, f.fila.ubicacion, f.fila.fecha)),
    );
    const resultado = await finalizarConRetiroAutorizado(
      { empresaId, cadenaId: importacion.cadenaId, importId },
      {
        fechaCorteInicio: importacion.alcanceFechaCorteInicio,
        fechaCorteFin: importacion.alcanceFechaCorteFin,
        ubicaciones: importacion.alcanceUbicaciones as unknown as string[],
      },
      clavesEnArchivo,
      importacion.retiroHashConfirmado,
      {
        filasDetectadas: filas.length,
        filasConError: erroresTotales.length,
        erroresMuestra: erroresTotales.length > 0 ? erroresTotales.slice(0, 50) : null,
      },
    );
    if (!resultado.ok) {
      // Identificable: quien lea erroresMuestra/logs ve exactamente por
      // que -- el conjunto que se iba a retirar ya no es el que el
      // usuario autorizo al confirmar (cambio desde entonces: otra
      // importacion se proceso, una correccion manual, otra corrida
      // concurrente). Nunca se retira ni se publica nada en esta corrida
      // -- ver finalizarConRetiroAutorizado() en importar.ts, punto 2.
      await marcarError(
        empresaId,
        importId,
        "RETIRO_DESACTUALIZADO_EN_JOB: lo que se iba a retirar ya no coincide con lo que el usuario autorizo al confirmar (el conjunto vigente cambio desde la confirmacion). Ninguna fila se retiro ni se publico como definitiva en esta corrida -- hace falta una vista previa y una confirmacion nuevas.",
      );
      return;
    }
    return;
  }

  // Cerrar (CARGA_PARCIAL) -- CONFIRMADA + procesadaEn juntos, siempre en
  // la misma escritura (nunca uno sin el otro -- ver el comentario de
  // procesadaEn). filasConError/erroresMuestra reflejan las filas que NO
  // se guardaron (parseo invalido + duplicados en conflicto), nunca se
  // ocultan aunque el resto haya salido bien.
  await cliente.importacionCsv.update({
    where: { id: importId },
    data: {
      estado: "CONFIRMADA",
      procesadaEn: new Date(),
      filasDetectadas: filas.length,
      filasConError: erroresTotales.length,
      // erroresMuestra es Json? -- Prisma exige un valor explicito para
      // "sin valor" en un campo JSON nullable (Prisma.DbNull, no `null`
      // a secas: `null` es ambiguo entre "NULL de base de datos" y "el
      // JSON literal null", y Prisma rechaza la ambiguedad en tiempo de
      // tipos). Sin errores queremos NULL de base de datos (ausencia de
      // valor), no el literal JSON null -- por eso Prisma.DbNull, nunca
      // Prisma.JsonNull.
      erroresMuestra: erroresTotales.length > 0 ? erroresTotales.slice(0, 50) : Prisma.DbNull,
    },
  });
}

export interface ResultadoProcesarImportacionesCsv {
  procesados: number;
}

/**
 * fetch/complete/fail sobre la cola de importaciones confirmadas --
 * SOLO el cron de respaldo (src/app/api/internal/jobs/run/route.ts) la
 * llama hoy. Drena lo mas viejo de TODA la cola compartida, sin importar
 * a que importacion pertenece -- correcto para un barrido general
 * periodico, donde el orden entre importaciones distintas no importa
 * (tarde o temprano procesa todo lo pendiente).
 *
 * Bug real encontrado por Alex (2026-09-29, importacion
 * 52aed226-1b0f-4550-bd30-fdd497ba0ed3): el disparo inmediato de la ruta
 * de confirmar usaba ESTA funcion con batchSize=1, pero boss.fetch()
 * toma el job MAS VIEJO de la cola por created_on -- sin importar cual
 * importacion disparo la llamada. Si en ese momento habia un job mas
 * viejo esperando su retryDelay (el reintento de OTRA importacion), el
 * disparo inmediato de ESTA importacion procesaba ESE job ajeno y dejaba
 * el propio en "created" -- confirmado con pgboss.job real en Windows
 * (job 27f5f447-..., created_on 19:56:41, nunca fetcheado; el job de
 * otra importacion, creado 22 minutos antes y en "retry", arranco 0.6s
 * despues de esta confirmacion). Localmente, sin cron de respaldo (ver
 * el comentario de cabecera de /api/internal/jobs/run/route.ts: aca no
 * hay Vercel Cron ni GitHub Actions), eso podia significar "nunca se
 * procesa". El disparo inmediato ahora usa
 * procesarImportacionCsvPropia() (mas abajo), que reclama EXCLUSIVAMENTE
 * el job de la importacion que acaba de confirmar.
 */
export async function procesarImportacionesCsv(boss: PgBoss, batchSize = 5): Promise<ResultadoProcesarImportacionesCsv> {
  const jobs = await boss.fetch<PayloadImportacionCsv>(COLA_IMPORTACION_CSV, { batchSize });
  if (!jobs || jobs.length === 0) {
    return { procesados: 0 };
  }

  for (const job of jobs) {
    try {
      await procesarUnaImportacionCsv(job.data);
      await boss.complete(COLA_IMPORTACION_CSV, job.id);
    } catch (err) {
      await boss.fail(COLA_IMPORTACION_CSV, job.id, {
        mensaje: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { procesados: jobs.length };
}

// Schema de pg-boss -- ver src/infra/jobs/pgBoss.ts ("schema: PGBOSS_SCHEMA"
// en la config del PgBoss compartido). Duplicado aca (pgBoss.ts no lo
// exporta) porque procesarImportacionCsvPropia() necesita el nombre del
// schema en SQL crudo -- si alguna vez cambia, actualizar los dos
// lugares.
const PGBOSS_SCHEMA = "pgboss";

/**
 * Reclama y procesa EXCLUSIVAMENTE el job de ESTA importacion
 * (singleton_key = importId, ver encolarImportacionCsv()), sin pasar por
 * boss.fetch() sobre la cola compartida -- ver el comentario de
 * procesarImportacionesCsv() de arriba para el bug real que motiva esto.
 *
 * Reclamo atomico EQUIVALENTE al que hace pg-boss internamente en
 * fetch() (mismo criterio: UPDATE ... WHERE state < 'active' ..., mismo
 * calculo de retry_count -- ver fetchNextJob() en
 * node_modules/pg-boss/dist/plans.js) pero filtrado por singleton_key en
 * vez de "el mas viejo de toda la cola". Misma exclusividad que
 * garantiza pg-boss: dos reclamos concurrentes sobre el MISMO job (sea
 * este codigo o el fetch() generico del cron de respaldo corriendo al
 * mismo tiempo) nunca ganan los dos -- el segundo UPDATE espera a que el
 * primero confirme y su propio WHERE (state < 'active') ya no matchea,
 * 0 filas afectadas. boss.complete()/boss.fail() se llaman igual que en
 * procesarImportacionesCsv() para que el libro contable de pg-boss
 * (retries, output, keep_until) quede identico a como lo dejaria un
 * fetch() generico -- nunca se duplica logica de finalizacion.
 *
 * Nunca toca ningun otro job de la cola -- si el UPDATE no afecta
 * ninguna fila (el job ya esta active/completed/failed/cancelled, por
 * ejemplo porque el cron de respaldo lo tomo primero, o -- mas raro -- el
 * INSERT de la misma transaccion de confirmar todavia no es visible para
 * esta conexion), esto es un no-op silencioso: el job sigue disponible
 * para el proximo intento, nunca un error.
 */
export async function procesarImportacionCsvPropia(
  boss: PgBoss,
  payload: PayloadImportacionCsv,
): Promise<{ procesado: boolean }> {
  const db = boss.getDb();
  const reclamo = await db.executeSql(
    `UPDATE ${PGBOSS_SCHEMA}.job SET
       state = 'active',
       started_on = ${PGBOSS_SCHEMA}.job_now(),
       heartbeat_on = ${PGBOSS_SCHEMA}.job_now(),
       retry_count = CASE WHEN started_on IS NOT NULL THEN retry_count + 1 ELSE retry_count END
     WHERE name = $1
       AND singleton_key = $2
       AND state < 'active'
       AND start_after <= ${PGBOSS_SCHEMA}.job_now()
       AND NOT blocked
     RETURNING id`,
    [COLA_IMPORTACION_CSV, payload.importId],
  );
  const jobId = reclamo.rows[0]?.id as string | undefined;
  if (!jobId) {
    return { procesado: false };
  }

  try {
    await procesarUnaImportacionCsv(payload);
    await boss.complete(COLA_IMPORTACION_CSV, jobId);
  } catch (err) {
    await boss.fail(COLA_IMPORTACION_CSV, jobId, {
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
  return { procesado: true };
}
