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

/**
 * Variante de procesarImportacionCsvPropia() para herramientas de
 * mantenimiento (ver scripts/desbloquearImportacion.ts) que ya conocen
 * el id EXACTO del job a reclamar y quieren la garantia atomica de que,
 * si ese id no coincide con la cola/importId/empresa/elegibilidad
 * esperados, el UPDATE no afecta NINGUNA fila -- nunca reclama "otro"
 * job con el mismo singleton_key por error.
 *
 * Alex, 2026-09-29 (al revisar el script de desbloqueo puntual de
 * 52aed226-1b0f-4550-bd30-fdd497ba0ed3): "el reclamo debe incluir el
 * jobId exacto en el mismo UPDATE, junto con la cola, importId, empresa
 * y condiciones de elegibilidad. Si no coincide, debe afectar cero
 * filas. La comprobacion posterior no sustituye esa proteccion." -- por
 * eso el filtro por empresa (data ->> 'empresaId') Y por importId
 * (data ->> 'importId', ADEMAS de singleton_key) van DENTRO del UPDATE,
 * el mismo payload que puso encolarImportacionCsv() al crear el job --
 * nunca solo verificados antes o despues en el propio script que llama
 * a esto. El chequeo de data.importId es defensa en profundidad respecto
 * de singleton_key (que en la practica vale lo mismo, ver
 * encolarImportacionCsv()) -- si alguna vez quedaran desincronizados por
 * un bug en otro lado, el UPDATE sigue negandose a reclamar.
 *
 * Mismas garantias de exclusividad que procesarImportacionCsvPropia()
 * (ver su comentario arriba) -- esta es la version con un filtro extra
 * por id, pensada para un reclamo puntual guiado por un operador humano,
 * no para el disparo automatico de la ruta de confirmar (que no conoce
 * el jobId de antemano, por eso sigue usando
 * procesarImportacionCsvPropia() sin cambios).
 */
export async function reclamarJobImportacionCsvPorId(
  boss: PgBoss,
  payload: PayloadImportacionCsv & { jobId: string },
): Promise<{ procesado: boolean }> {
  const db = boss.getDb();
  const reclamo = await db.executeSql(
    `UPDATE ${PGBOSS_SCHEMA}.job SET
       state = 'active',
       started_on = ${PGBOSS_SCHEMA}.job_now(),
       heartbeat_on = ${PGBOSS_SCHEMA}.job_now(),
       retry_count = CASE WHEN started_on IS NOT NULL THEN retry_count + 1 ELSE retry_count END
     WHERE id = $1
       AND name = $2
       AND singleton_key = $3
       AND data ->> 'importId' = $3
       AND data ->> 'empresaId' = $4
       AND state < 'active'
       AND start_after <= ${PGBOSS_SCHEMA}.job_now()
       AND NOT blocked
     RETURNING id`,
    [payload.jobId, COLA_IMPORTACION_CSV, payload.importId, payload.empresaId],
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

/**
 * Recuperacion PUNTUAL de un job que quedo 'active' abandonado -- nunca
 * completado ni fallado, sin que nada lo este procesando (ver
 * scripts/repararJobAtascado.ts). A diferencia de
 * reclamarJobImportacionCsvPorId() (que reclama un job todavia ELEGIBLE,
 * en created/retry), esta funcion es para el caso en que el job YA fue
 * reclamado por otra corrida -- quedo 'active' -- y esa corrida nunca lo
 * termino (el incidente real: boss.fetch() sin acotar en una prueba de
 * integracion, ver el comentario de cabecera de
 * confirmarAtomicidad.integration.test.ts).
 *
 * Alex, 2026-09-30, tras revisar una primera version que llamaba
 * boss.fail() directamente: "Usar boss.fail() por ID no basta para
 * garantizar esas precondiciones". boss.fail() (failJobsById en
 * pg-boss, ver node_modules/pg-boss/dist/plans.js) SOLO verifica
 * name+id+state<'completed' -- no puede exigir atomicamente que el job
 * este REALMENTE vencido (segun el reloj de Postgres, nunca el de este
 * proceso), que la empresa coincida, o que queden reintentos
 * disponibles. Y como la verificacion (un SELECT de diagnostico) y la
 * transicion (el fail() en si) serian dos pasos separados, un cambio
 * concurrente entre esos dos pasos podria colarse -- exactamente lo que
 * un simple boss.fail() por id no puede evitar.
 *
 * La solucion es la MISMA tecnica que ya usa
 * reclamarJobImportacionCsvPorId(): un UNICO UPDATE atomico cuyo WHERE
 * es la precondicion COMPLETA. Si cualquier condicion no se cumple EN
 * ESE INSTANTE, el UPDATE afecta cero filas -- nunca hay una ventana
 * entre "verificar" y "transicionar" donde algo mas pueda cambiar el
 * job por debajo.
 *
 * Precondiciones, TODAS dentro del mismo WHERE (ninguna se verifica por
 * separado antes de este UPDATE):
 *   - Identidad exacta: id, name, singleton_key Y data.importId
 *     (defensa en profundidad, igual que reclamarJobImportacionCsvPorId)
 *     Y data.empresaId (aqui SI hace falta -- a diferencia de esa
 *     funcion, aca no hay un procesarUnaImportacionCsv() posterior que
 *     la verifique de nuevo).
 *   - state = 'active' EXACTO -- si alguien ya lo completo, fallo o
 *     re-reclamo, 0 filas, nunca pisa una transicion ajena.
 *   - Vencido segun el reloj de POSTGRES, no el de Node: started_on +
 *     expire_seconds * interval '1s' < job_now(). Mismo criterio que
 *     failJobsByTimeout() de pg-boss (el que correria solo si
 *     supervise:true) -- nunca Date.now() de este proceso.
 *   - retry_count < retry_limit: quedan reintentos disponibles. Si no
 *     quedan, este UPDATE se niega (0 filas) -- llevar un job sin
 *     reintentos a 'failed' es una decision distinta (deadletter/cierre
 *     manual), no "recuperar", y no la toma esta funcion.
 *
 * Transicion (SOLO si el WHERE de arriba matcheo) -- replica
 * EXACTAMENTE failJobsBody() de pg-boss para el caso "quedan
 * reintentos" (ver plans.js): state -> 'retry', completed_on -> NULL,
 * heartbeat_on -> NULL, output <- el mensaje dado (mismo formato que
 * mapCompletionDataArg() en manager.js: un objeto plano se guarda tal
 * cual), start_after recalculado con el MISMO retry_delay/retry_backoff
 * con que se encolo el job originalmente (nunca un valor inventado
 * aqui), retry_count SIN TOCAR (pg-boss lo incrementa recien en el
 * proximo claim real, misma formula que reclamarJobImportacionCsvPorId
 * y que fetchNextJob() de pg-boss). El job vuelve asi al camino NORMAL
 * de la cola -- lo reclama el consumidor real, nunca este codigo.
 *
 * (La rama "WHEN retry_count = retry_limit THEN start_after" del CASE
 * de abajo es inalcanzable dado el "retry_count < retry_limit" del
 * WHERE -- se conserva de todos modos para que la formula sea
 * identica, linea por linea, a failJobsBody() de pg-boss y quede facil
 * de auditar contra la fuente real.)
 *
 * Equivalencia CONFIRMADA contra la version instalada (Alex,
 * 2026-09-30: "no solamente la formula del retraso") -- ver
 * node_modules/pg-boss/package.json (12.33.0) y
 * node_modules/pg-boss/dist/plans.js: la rama retried_jobs de
 * failJobsBody() hace un DELETE+INSERT que copia SIN CAMBIOS todas las
 * columnas que este UPDATE tampoco toca -- mismo resultado final fila
 * por fila. Esa diferencia fisica (UPDATE vs DELETE+INSERT) no importa
 * aqui: no hay CREATE TRIGGER en el schema de pg-boss, la cola es
 * partition:false (bootstrapPgBoss.ts nunca lo pisa), y LISTEN/NOTIFY
 * es solo un hint de latencia para boss.work()/useListenNotify -- esta
 * app nunca usa ninguno de los dos (ver pgBoss.ts).
 *
 * Conflicto de reinsercion en failJobsBody() -- Alex, 2026-09-30: "failJobsBody
 * contempla conflictos de reinsercion y una rama failed_jobs aun con
 * reintentos disponibles". Es real y esta documentado con precision en
 * plans.js: retried_jobs hace `INSERT ... ON CONFLICT DO NOTHING`, y
 * failed_jobs INSERTA COMO 'failed' (SIN mirar retry_count/retry_limit)
 * cualquier id que NO haya quedado insertado en retried_jobs -- o sea,
 * si el INSERT de retried_jobs choca contra una constraint unica,
 * pg-boss degrada ese job a 'failed' EN SILENCIO, aunque le quedaran
 * reintentos.
 *
 * La unica constraint que ese INSERT podria chocar para esta cola es
 * job_i6 (`CREATE UNIQUE INDEX job_i6 ON pgboss.job (name,
 * COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy =
 * 'exclusive'`, ver createIndexJobPolicyExclusive() en plans.js) --
 * COLA_IMPORTACION_CSV se crea con policy:"exclusive"
 * (bootstrapPgBoss.ts), asi que job_i6 aplica a TODAS sus filas: a lo
 * sumo UNA fila por (name, singleton_key) puede estar en
 * created/retry/active a la vez. Por que ese conflicto NO puede pasar
 * en esta recuperacion puntual: nuestro WHERE exige `state = 'active'`
 * EN EL INSTANTE del UPDATE -- y mientras esa fila siga activa, job_i6
 * ya le esta impidiendo a CUALQUIER encolarImportacionCsv() (boss.send()
 * con el mismo singletonKey=importId) crear una segunda fila no
 * terminal para el mismo importId: esa llamada se deduplica y devuelve
 * null (ver el test "deduplicacion" en
 * confirmarAtomicidad.integration.test.ts), nunca inserta una fila
 * conflictiva. Nuestro UPDATE deja la fila DENTRO del mismo rango que
 * job_i6 protege (active -> retry, ambos <= 'active'), asi que si no
 * habia conflicto antes del UPDATE (garantizado por job_i6 mientras la
 * fila siguio 'active'), tampoco lo hay al terminar. En otras palabras:
 * la propia precondicion state='active' de este UPDATE es exactamente
 * la que job_i6 usa para excluir cualquier fila rival, asi que la rama
 * de conflicto de failJobsBody() es alcanzable para pg-boss en general
 * (p.ej. un boss.fail() por lote con ids de distintas filas que
 * compartieran singleton_key) pero INALCANZABLE para este UPDATE en
 * particular.
 *
 * CORREGIDO (Alex, 2026-09-30: "si job_i6 no existe, no puede producir
 * una violacion de unicidad por ese indice"): el parrafo anterior de
 * este comentario describia mal el caso hipotetico de que job_i6 este
 * ausente -- decia que Postgres lanzaria un unique_violation (23505),
 * lo cual es exactamente al reves. Si job_i6 NO EXISTE no hay ninguna
 * constraint que violar, asi que este UPDATE (o cualquier INSERT
 * concurrente) NO lanza ningun error: la garantia de exclusividad deja
 * de sostenerse EN SILENCIO. En ese escenario podria llegar a existir
 * mas de una fila created/retry/active para el mismo (name,
 * singleton_key) sin que nada lo impida ni lo avise -- y como nuestro
 * WHERE filtra solo por id (nunca por "soy la unica fila activa de este
 * singleton_key"), este UPDATE ni se entera: procede igual, sin error,
 * sobre la fila que le pidieron. Esa es la falla real que importa
 * documentar aqui: silenciosa, no ruidosa.
 *
 * Por eso la garantia de mas arriba ("provablemente inalcanzable para
 * este UPDATE en particular") depende de dos hechos de Postgres que el
 * codigo fuente de pg-boss NO puede confirmar por si solo -- hay que
 * verificarlos contra la base real (Alex, 2026-09-30: "la garantia
 * depende de que el indice exista y este valido en Neon y de que el job
 * tenga policy='exclusive'; eso todavia debemos verificarlo"):
 *
 *   1. Que exista, en la TABLA FISICA real del job, un indice unico
 *      valido y listo que exija esa exclusividad. CORREGIDO (Alex,
 *      2026-09-30, tras verificar en Neon): el nombre "job_i6" es solo
 *      el que usa la PLANTILLA de createIndexJobPolicyExclusive() en
 *      plans.js -- pg-boss particiona pgboss.job por LIST (name)
 *      (`createTableJob()`, `PARTITION BY LIST (name)`), y una cola con
 *      partition:false (como COLA_IMPORTACION_CSV) NO tiene particion
 *      propia: sus filas caen en la particion DEFAULT compartida,
 *      `pgboss.job_common` (`ATTACH PARTITION ... DEFAULT`). Cada indice
 *      de esa plantilla se crea realmente via `job_table_run()` +
 *      `job_table_format()`, que hace una sustitucion textual con regex
 *      (`\.job\y` -> tabla real, `\yjob_i(\d+)` -> `<tabla>_i\1`)
 *      ANTES de ejecutar el DDL -- el indice que termina existiendo de
 *      verdad para esta cola no se llama "job_i6", se llama
 *      "job_common_i6", confirmado en Neon (Alex, 2026-09-30): reside en
 *      `pgboss.job_common`, con `policy='exclusive'` en la fila del job,
 *      protegido por `pgboss.job_common_i6` (`indisunique`, `indisvalid`
 *      e `indisready` en true). Por eso la verificacion de este punto
 *      (verificarIndiceExclusividadDelJob() mas abajo) NUNCA asume un
 *      nombre fijo: primero lee `tableoid::regclass` de la fila REAL del
 *      job bajo recuperacion (la tabla fisica donde vive, sea cual sea
 *      su nombre), y despues busca, EN ESA tabla, el indice unico cuya
 *      DEFINICION (`pg_get_indexdef()`) matchee el patron esperado
 *      (`singleton_key` + `policy`/`exclusive` en el predicado parcial)
 *      -- nunca por nombre. Un CREATE INDEX CONCURRENTLY fallido deja un
 *      indice con `indisvalid=false` (o `indisready=false` a mitad de
 *      build) que Postgres nunca usa para exigir unicidad aunque exista
 *      la fila en `pg_index` -- por eso se verifican los tres
 *      indicadores, no solo uno.
 *   2. Que ESTE job en particular tenga policy='exclusive' -- no la cola
 *      (pgboss.queue.policy es la config actual, que podria haber
 *      cambiado desde que se encolo), sino la columna policy que
 *      createTableJob() copia al job AL MOMENTO de encolarlo (ver
 *      plans.js) y que es la que el indice de exclusividad realmente
 *      evalua en su predicado parcial. Por eso el WHERE de este UPDATE
 *      ahora exige "AND policy = 'exclusive'" explicitamente -- ya no se
 *      asume por leer bootstrapPgBoss.ts, se re-verifica en el instante
 *      del UPDATE igual que el resto de las precondiciones.
 *
 * scripts/repararJobAtascado.ts trata la falta, invalidez o no-listeza
 * de ese indice como un problema bloqueante mas (mismo trato que las
 * otras 5 precondiciones: corta el diagnostico, sale con codigo
 * distinto de cero, nunca intenta el UPDATE) -- la garantia de
 * exclusividad ya no es un supuesto de lectura de codigo ni de un
 * nombre fijo, es algo que el script confirma contra la tabla fisica
 * real antes de dejar avanzar nada.
 */
export async function recuperarJobActivoVencidoPorId(
  boss: PgBoss,
  payload: PayloadImportacionCsv & { jobId: string },
  mensaje: string,
): Promise<{ recuperado: boolean }> {
  const db = boss.getDb();
  const recuperacion = await db.executeSql(
    `UPDATE ${PGBOSS_SCHEMA}.job SET
       state = 'retry',
       completed_on = NULL,
       heartbeat_on = NULL,
       output = $5::jsonb,
       start_after = CASE
         WHEN retry_count = retry_limit THEN start_after
         WHEN NOT retry_backoff THEN ${PGBOSS_SCHEMA}.job_now() + retry_delay * interval '1'
         ELSE ${PGBOSS_SCHEMA}.job_now() + LEAST(
           retry_delay_max,
           GREATEST(retry_delay, 1) * (
             2 ^ LEAST(16, retry_count + 1) / 2 +
             2 ^ LEAST(16, retry_count + 1) / 2 * random()
           )
         ) * interval '1s'
       END
     WHERE id = $1
       AND name = $2
       AND singleton_key = $3
       AND data ->> 'importId' = $3
       AND data ->> 'empresaId' = $4
       AND state = 'active'
       AND policy = 'exclusive'
       AND retry_count < retry_limit
       AND (started_on + expire_seconds * interval '1s') < ${PGBOSS_SCHEMA}.job_now()
     RETURNING id`,
    [payload.jobId, COLA_IMPORTACION_CSV, payload.importId, payload.empresaId, JSON.stringify({ mensaje })],
  );
  const jobId = recuperacion.rows[0]?.id as string | undefined;
  return { recuperado: Boolean(jobId) };
}

export interface VerificacionIndiceExclusividad {
  /** tableoid::regclass de la fila REAL de este job -- la tabla fisica
   * donde vive de verdad (pgboss.job es solo el padre particionado,
   * PARTITION BY LIST (name), nunca tiene filas propias). null si el
   * jobId no existe. */
  tablaFisica: string | null;
  /** Nombre real del indice encontrado en esa tabla -- nunca asumido:
   * pg-boss lo genera por sustitucion textual (job_table_format() en
   * plans.js) a partir de la plantilla "job_i6", asi que varia por
   * particion (p.ej. "job_common_i6" en la particion compartida por
   * defecto, "job_common_i6" para la mayoria de las colas
   * partition:false, o "<tabla_de_la_cola>_i6" para una particion
   * dedicada). null si no se encontro ningun indice que matchee. */
  indiceNombre: string | null;
  /** pg_get_indexdef() completo del indice encontrado -- para poder
   * auditar el predicado a simple vista, nunca confiar ciegamente en
   * que el nombre encontrado es el correcto. */
  indiceDefinicion: string | null;
  /** true si se encontro, en esa tabla, un indice cuyas columnas CLAVE
   * son EXACTAMENTE (name, COALESCE(singleton_key, '')) -- ni una
   * columna clave de mas (que permitiria duplicados reales de
   * name+singleton_key, ver la prueba "claves extra" en
   * recuperarJobActivoVencidoPorIdSoloVencidoYExacto.integration.test.ts)
   * ni de menos -- y cuyo predicado parcial es, TEXTUALMENTE, EXACTO al
   * que produce la version instalada de pg-boss para esta cola --
   * `((state <= 'active'::pgboss.job_state) AND (policy =
   * 'exclusive'::text))`, confirmado contra el indice real de Alex en
   * Neon -- ni una condicion de mas ni de menos (nunca state =
   * 'created' solamente, ver la prueba "solo created"; nunca con una
   * condicion adicional como `AND singleton_key = '...'` que angoste el
   * predicado a un solo job, ver la prueba "condicion adicional" en el
   * mismo archivo). CORREGIDO (Alex, 2026-10-01: "las regex aceptan
   * condiciones adicionales que excluyan nuestro job"): la version
   * anterior de esta verificacion usaba dos regex `~*` que solo exigian
   * que el predicado CONTUVIERA ambas condiciones en algun lado -- un
   * indice con una tercera condicion (p.ej. `AND singleton_key =
   * 'solo-otro-job'`) tambien las contenia, asi que pasaba como si
   * protegiera cualquier job, cuando en realidad solo protege una
   * fila puntual. Por eso esta funcion ahora compara el predicado
   * COMPLETO, normalizado (minusculas, espacios colapsados), contra el
   * texto EXACTO esperado -- ninguna condicion de mas sobrevive esa
   * comparacion. Verificado ESTRUCTURALMENTE contra
   * pg_index/pg_get_indexdef/pg_get_expr, nunca por una coincidencia de
   * texto suelta (ILIKE ni regex de presencia) sobre la definicion
   * completa. */
  existe: boolean;
  /** indisunique del indice encontrado. */
  unico: boolean;
  /** indisvalid -- false tras un CREATE INDEX CONCURRENTLY fallido;
   * Postgres nunca usa un indice invalido para exigir unicidad aunque
   * exista la fila en pg_index. */
  valido: boolean;
  /** indisready -- false mientras un CREATE INDEX CONCURRENTLY todavia
   * esta construyendose; sin esto en true tampoco protege escrituras
   * concurrentes todavia. */
  listo: boolean;
}

/**
 * Verifica, contra la base real (nunca contra el codigo fuente de
 * pg-boss ni contra un nombre de indice asumido), que la fila de ESTE
 * job especifico esta protegida por un indice de exclusividad valido y
 * listo. CORREGIDO (Alex, 2026-09-30, tras verificar en Neon): la
 * version anterior de esta funcion buscaba un indice fijo llamado
 * "pgboss.job_i6" -- eso solo es correcto sin particionado. pg-boss
 * particiona pgboss.job por LIST (name) (ver docstring de
 * recuperarJobActivoVencidoPorId() mas arriba para el detalle completo
 * de job_table_format()/job_table_run()), asi que el indice real para
 * una cola con partition:false vive en la particion DEFAULT compartida
 * (pgboss.job_common en la base de Alex, confirmado con
 * indisunique/indisvalid/indisready en true) con un nombre generado por
 * sustitucion textual -- nunca "job_i6" literal.
 *
 * Por eso esta funcion procede en dos pasos, sin asumir NINGUN nombre:
 *
 *   1. Lee `tableoid::regclass` de la fila REAL de este jobId en
 *      pgboss.job -- tableoid es la columna de sistema de Postgres que
 *      dice, para cada fila, en que tabla fisica vive de verdad (la
 *      forma correcta de "seguir" una fila a traves de una tabla
 *      particionada, sin adivinar la particion por convencion de
 *      nombres).
 *   2. Busca, DENTRO de esa tabla fisica, un indice cuya ESTRUCTURA
 *      (nunca su nombre, y ya NO una coincidencia de texto suelta tipo
 *      ILIKE sobre pg_get_indexdef() completo) sea exactamente la que
 *      la exclusividad necesita -- CORREGIDO (Alex, 2026-09-30: "Falta
 *      comprobar las claves y el predicado del indice de exclusividad,
 *      no solo dos coincidencias con ILIKE"): un ILIKE
 *      '%singleton_key%' + '%exclusive%' hace match con CUALQUIER
 *      indice que mencione esas palabras en su definicion completa,
 *      aunque cubra columnas distintas o un predicado mas angosto
 *      (p.ej. un indice que solo proteja state='created', o que agregue
 *      una columna clave extra como `id`) -- ver los dos escenarios
 *      negativos que esta funcion ahora rechaza, probados contra
 *      Postgres real (tablas descartables en el schema pgboss) en
 *      recuperarJobActivoVencidoPorIdSoloVencidoYExacto.integration.test.ts.
 *      Por eso esta funcion pide, contra los catalogos del sistema:
 *        - `pg_index.indnkeyatts = 2`: exactamente DOS columnas CLAVE,
 *          ni una de mas -- una tercera columna clave (p.ej. `id`,
 *          siempre distinto) haria que dos filas con el mismo
 *          name+singleton_key pudieran coexistir sin violar el indice,
 *          derrotando la garantia de exclusividad aunque Postgres siga
 *          reportando el indice como `indisunique`.
 *        - `pg_get_indexdef(indexrelid, 1, true) = 'name'` y
 *          `pg_get_indexdef(indexrelid, 2, true) ILIKE
 *          'coalesce(singleton_key%'`: la columna 1 es `name` exacto, la
 *          columna 2 es la expresion `COALESCE(singleton_key, ...)` --
 *          columna por columna, nunca la definicion completa como texto
 *          suelto.
 *        - `pg_get_expr(indpred, indrelid)` (el predicado parcial
 *          reconstruido como texto), NORMALIZADO (minusculas, espacios
 *          colapsados con `regexp_replace(..., '\s+', ' ', 'g')`) e
 *          IGUAL, caracter por caracter, al predicado EXACTO que la
 *          version instalada de pg-boss produce para esta cola --
 *          `((state <= 'active'::pgboss.job_state) and (policy =
 *          'exclusive'::text))`, el mismo texto confirmado contra
 *          `pgboss.job_common_i6` en la base real de Alex. CORREGIDO
 *          (Alex, 2026-10-01: "las regex aceptan condiciones
 *          adicionales que excluyan nuestro job"): comparar por
 *          IGUALDAD COMPLETA, no por dos regex `~*` de presencia --
 *          `~* 'policy...'` y `~* 'state...'` solo exigian que ambas
 *          condiciones APARECIERAN en algun lado del predicado, asi que
 *          un indice con una condicion extra (p.ej. `AND singleton_key
 *          = 'solo-otro-job'`, que angosta el indice a proteger un solo
 *          job puntual, no la cola entera) tambien las contenia y
 *          pasaba como si fuera valido -- falso positivo real, cerrado
 *          por la comparacion exacta (ver la prueba "condicion
 *          adicional" en
 *          recuperarJobActivoVencidoPorIdSoloVencidoYExacto.integration.test.ts).
 *          La igualdad exacta tambien seguia distinguiendo el caso
 *          `state = 'created'` (operador `=`, no `<=`) del indice real,
 *          igual que antes.
 *      Deliberadamente esta funcion NO filtra por `indisunique`,
 *      `indisvalid` ni `indisready` en el WHERE -- son columnas del
 *      SELECT, no del filtro -- para que "existe estructuralmente pero
 *      no es unico/valido/listo" siga siendo un resultado distinguible
 *      (`existe:true` con `unico`/`valido`/`listo` en false), en vez de
 *      desaparecer como si el indice no existiera. Devuelve el nombre y
 *      la definicion encontrados para que quien lea el diagnostico
 *      pueda auditarlos a simple vista, en vez de confiar a ciegas en
 *      esta funcion.
 *
 *      Extraida a `buscarIndiceExclusividadEnTabla(boss, tablaFisica)`
 *      -- una funcion separada que recibe la tabla fisica ya resuelta
 *      -- para que las pruebas de integracion puedan ejercer esta
 *      consulta estructural contra tablas de prueba descartables
 *      (creadas y borradas dentro del propio schema `pgboss`, nunca
 *      contra `pgboss.job`/`pgboss.job_common`) sin depender de un job
 *      real encolado para cada escenario negativo.
 *
 * Ver el docstring de recuperarJobActivoVencidoPorId() de mas arriba
 * (Alex, 2026-09-30: "la garantia depende de que el indice exista y
 * este valido en Neon") -- esta funcion es la verificacion empirica de
 * esa dependencia. Es de solo lectura (pg_index/pg_class son catalogos
 * del sistema); no crea, repara ni toca ningun indice de ninguna forma.
 */
/**
 * Busca, DENTRO de una tabla fisica ya resuelta (ver
 * verificarIndiceExclusividadDelJob() mas abajo para el caso de uso
 * real -- la tabla fisica de un job concreto via tableoid), un indice
 * cuya ESTRUCTURA sea exactamente la que la exclusividad necesita:
 * exactamente dos columnas clave (name, COALESCE(singleton_key, '')) y
 * un predicado parcial que exija, a la vez, policy='exclusive' Y
 * state<='active'. Separada de verificarIndiceExclusividadDelJob() para
 * que las pruebas de integracion puedan ejercer esta consulta contra
 * tablas de prueba descartables (creadas y borradas dentro del propio
 * schema `pgboss`) sin depender de un job real encolado para cada
 * escenario -- ver el docstring completo (columna por columna, regex
 * del predicado) en verificarIndiceExclusividadDelJob() mas abajo.
 *
 * Es de solo lectura (pg_index/pg_class son catalogos del sistema); no
 * crea, repara ni toca ningun indice de ninguna forma.
 */
export async function buscarIndiceExclusividadEnTabla(
  boss: PgBoss,
  tablaFisica: string,
): Promise<Omit<VerificacionIndiceExclusividad, "tablaFisica">> {
  const db = boss.getDb();

  const filaIndice = await db.executeSql(
    `SELECT
        c.relname AS nombre,
        pg_get_indexdef(i.indexrelid) AS definicion,
        i.indisunique AS unico,
        i.indisvalid AS valido,
        i.indisready AS listo
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = $1::regclass
        AND i.indnkeyatts = 2
        AND lower(pg_get_indexdef(i.indexrelid, 1, true)) = 'name'
        AND regexp_replace(lower(pg_get_indexdef(i.indexrelid, 2, true)), '\\s+', ' ', 'g')
            = 'coalesce(singleton_key, ''''::text)'
        AND regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '\\s+', ' ', 'g')
            = '((state <= ''active''::pgboss.job_state) and (policy = ''exclusive''::text))'
      LIMIT 1`,
    [tablaFisica],
  );
  const fila = filaIndice.rows[0] as
    | { nombre: string; definicion: string; unico: boolean; valido: boolean; listo: boolean }
    | undefined;

  return {
    indiceNombre: fila?.nombre ?? null,
    indiceDefinicion: fila?.definicion ?? null,
    existe: fila !== undefined,
    unico: fila?.unico === true,
    valido: fila?.valido === true,
    listo: fila?.listo === true,
  };
}

export async function verificarIndiceExclusividadDelJob(
  boss: PgBoss,
  jobId: string,
): Promise<VerificacionIndiceExclusividad> {
  const db = boss.getDb();

  const filaTabla = await db.executeSql(
    `SELECT tableoid::regclass::text AS tabla FROM ${PGBOSS_SCHEMA}.job WHERE id = $1`,
    [jobId],
  );
  const tablaFisica = (filaTabla.rows[0] as { tabla: string } | undefined)?.tabla ?? null;
  if (!tablaFisica) {
    return {
      tablaFisica: null,
      indiceNombre: null,
      indiceDefinicion: null,
      existe: false,
      unico: false,
      valido: false,
      listo: false,
    };
  }

  const resultado = await buscarIndiceExclusividadEnTabla(boss, tablaFisica);
  return { tablaFisica, ...resultado };
}
