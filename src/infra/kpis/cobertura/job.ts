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
export interface MapeoColumnasPersistido {
  encabezados: string[];
  propuesto: MapeoColumnasCobertura;
  confirmado: MapeoColumnasCobertura | null;
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
  if (sospechosas.length > 0) {
    // Misma regla que la ruta de confirmar -- nunca se procesa un
    // archivo con columnas de fuente/periodo sin resolver, ni siquiera
    // si la ruta de confirmar las dejo pasar por algun bug.
    await marcarError(
      empresaId,
      importId,
      `El archivo trae columna(s) que parecen fuente/periodo de consumo sin resolver: ${sospechosas.map((s) => s.encabezado).join(", ")}.`,
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
      erroresMuestra: erroresTotales.length > 0 ? erroresTotales.slice(0, 50) : null,
    },
  });
}

export interface ResultadoProcesarImportacionesCsv {
  procesados: number;
}

/**
 * fetch/complete/fail sobre la cola de importaciones confirmadas --
 * llamado tanto por el disparo inmediato de la ruta de confirmar (caso
 * feliz, procesa en el mismo ciclo) como por el cron de respaldo
 * (src/app/api/internal/jobs/run/route.ts).
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
