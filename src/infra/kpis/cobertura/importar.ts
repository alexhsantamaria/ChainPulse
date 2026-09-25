// Infraestructura -- escritura de ObservacionCobertura a partir de un CSV
// ya interpretado y preparado (src/domain/prepararFilasCoberturaParaImportar.ts).
// Incremento 4 Bloque B, rebanada vertical de Cobertura.
//
// Regla de identidad vigente/historial (confirmada por Alex el
// 2026-09-24, ver el comentario de ObservacionCobertura en
// prisma/schema.prisma): NUNCA UPDATE en el lugar sobre el contenido de
// una observacion -- una correccion real (contenidoHash distinto) inserta
// una fila NUEVA (vigente=true) y marca la fila anterior como no vigente
// (vigente=false, reemplazadaPorId=id de la nueva). Un reintento
// identico (mismo contenidoHash) es un no-op explicito: no se inserta
// nada, la fila vigente existente se queda tal cual.
//
// Alcance de la deteccion de "fila vigente previa": SOLO fuente="csv" --
// no existe todavia ningun camino de escritura manual/pegado para
// Cobertura (Bloque B lo construye mas adelante), asi que reconciliar
// contra observaciones manuales/pegado queda fuera de esta primera
// rebanada. idx_observaciones_cobertura_vigente_lookup
// (cadenaId, sku, ubicacion, fechaCorte, fuente, vigente) cubre esta
// consulta.
//
// Retry-safety de un intento de importacion especifico (mismo importId +
// mismo numeroFila reintentado, ej. el job se corta a mitad de un lote y
// el cron de respaldo lo vuelve a correr): create() puede chocar contra
// uq_observacion_cobertura_intento_csv (P2002) -- se atrapa y se
// interpreta como "esta fila ya se proceso", nunca como un error real.
// Como create() + el update() del historial viejo ocurren dentro de la
// MISMA tenantTransaction (una transaccion de Postgres por lote), un
// choque en create() significa que TODO el trabajo de esa fila (create +
// el update de la fila vieja, si aplicaba) ya se confirmo en un intento
// anterior -- nunca queda a medias.
import { tenantTransaction } from "../../prisma/tenantTransaction";
import { calcularContenidoHashCobertura } from "../../../domain/contenidoHashCobertura";
import type { FilaCoberturaParaImportar } from "../../../domain/prepararFilasCoberturaParaImportar";

// Codigo Postgres de violacion de restriccion unica, reexpuesto por
// Prisma como error.code === "P2002" -- mismo criterio de deteccion que
// el resto del proyecto (ver rateLimit.ts).
function esErrorDeUnicidad(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export interface ContextoImportacionCobertura {
  empresaId: string;
  cadenaId: string;
  definicionKpiId: string;
  importId: string;
  fuenteConsumo: string;
  periodoReferenciaConsumoInicio: Date | null;
  periodoReferenciaConsumoFin: Date | null;
  ruleVersion: string;
  zonaHorariaReferencia: string;
}

export interface ResultadoImportarLote {
  insertadas: number;
  corregidas: number; // insertadas que ademas reemplazaron una fila vigente anterior (subconjunto de `insertadas`)
  sinCambios: number; // reintento identico -- no-op
  yaProcesadas: number; // retry-safety: importId+numeroFila ya existia (P2002)
}

export function claveNegocio(sku: string, ubicacion: string, fechaCorte: Date): string {
  return `${sku}|${ubicacion}|${fechaCorte.toISOString().slice(0, 10)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo criterio que tenantTransaction.ts: el tx real de Prisma no tiene tipos exactos generados en este entorno (ver ADR-0003).
type TxCobertura = any;

/**
 * Procesa UN lote (ya recortado a ~500 filas por el caller, ver
 * importarObservacionesCobertura) dentro de una tenantTransaction ya
 * abierta. Exportada por separado para poder probarla con un `tx` falso
 * (mismo patron que purgaHuellaOrigenJob.test.ts con un PgBoss falso) sin
 * depender de una conexion real a Postgres.
 */
export async function procesarLoteCobertura(
  tx: TxCobertura,
  contexto: ContextoImportacionCobertura,
  lote: readonly FilaCoberturaParaImportar[],
): Promise<ResultadoImportarLote> {
  const resultado: ResultadoImportarLote = { insertadas: 0, corregidas: 0, sinCambios: 0, yaProcesadas: 0 };
  if (lote.length === 0) return resultado;

  // Una sola consulta para todas las filas vigentes del lote (nunca una
  // consulta por fila) -- cada fila del lote tiene una clave de negocio
  // distinta entre si (prepararFilasCoberturaParaImportar.ts ya
  // colapso/excluyo los duplicados dentro del archivo antes de llegar
  // aca), asi que esta consulta cubre el lote completo de una vez.
  const vigentesExistentes = await tx.observacionCobertura.findMany({
    where: {
      cadenaId: contexto.cadenaId,
      fuente: "csv",
      vigente: true,
      OR: lote.map((f) => ({ sku: f.fila.sku, ubicacion: f.fila.ubicacion, fechaCorte: f.fila.fecha })),
    },
    select: { id: true, sku: true, ubicacion: true, fechaCorte: true, contenidoHash: true },
  });
  const vigentesPorClave = new Map<string, { id: string; contenidoHash: string }>();
  for (const fila of vigentesExistentes) {
    vigentesPorClave.set(claveNegocio(fila.sku, fila.ubicacion, fila.fechaCorte), fila);
  }

  for (const fila of lote) {
    const hash = calcularContenidoHashCobertura({
      sku: fila.fila.sku,
      ubicacion: fila.fila.ubicacion,
      fechaCorte: fila.fila.fecha,
      inventarioDisponible: fila.fila.inventarioDisponible,
      unidadInventario: fila.fila.unidadInventario,
      consumoDiarioEsperado: fila.fila.consumoDiarioEsperado,
      unidadConsumoDiario: fila.fila.unidadConsumoDiario,
      fuenteConsumo: contexto.fuenteConsumo,
      periodoReferenciaConsumoInicio: contexto.periodoReferenciaConsumoInicio,
      periodoReferenciaConsumoFin: contexto.periodoReferenciaConsumoFin,
      ruleVersion: contexto.ruleVersion,
    });

    const existente = vigentesPorClave.get(claveNegocio(fila.fila.sku, fila.fila.ubicacion, fila.fila.fecha));

    if (existente && existente.contenidoHash === hash) {
      // Reintento identico -- no-op explicito, nunca se inserta ni se
      // toca la fila vigente existente.
      resultado.sinCambios += 1;
      continue;
    }

    let nuevaFilaId: string;
    try {
      const creada = await tx.observacionCobertura.create({
        data: {
          empresaId: contexto.empresaId,
          cadenaId: contexto.cadenaId,
          definicionKpiId: contexto.definicionKpiId,
          sku: fila.fila.sku,
          skuOriginal: fila.skuOriginal,
          ubicacion: fila.fila.ubicacion,
          ubicacionOriginal: fila.ubicacionOriginal,
          fechaCorte: fila.fila.fecha,
          zonaHorariaReferencia: contexto.zonaHorariaReferencia,
          inventarioDisponible: fila.fila.inventarioDisponible,
          unidadInventario: fila.fila.unidadInventario,
          consumoDiarioEsperado: fila.fila.consumoDiarioEsperado,
          unidadConsumoDiario: fila.fila.unidadConsumoDiario,
          fuenteConsumo: contexto.fuenteConsumo,
          periodoReferenciaConsumoInicio: contexto.periodoReferenciaConsumoInicio,
          periodoReferenciaConsumoFin: contexto.periodoReferenciaConsumoFin,
          coberturaDias: fila.coberturaDias,
          estado: fila.estado,
          ruleVersion: contexto.ruleVersion,
          fuente: "csv",
          importId: contexto.importId,
          numeroFila: fila.numeroFila,
          contenidoHash: hash,
          vigente: true,
        },
        select: { id: true },
      });
      nuevaFilaId = creada.id;
    } catch (err) {
      if (esErrorDeUnicidad(err)) {
        // uq_observacion_cobertura_intento_csv -- esta fila (importId +
        // numeroFila) ya se proceso en un intento anterior, incluyendo el
        // update() del historial si aplicaba (misma transaccion). Nunca
        // se reintenta ni se cuenta como error.
        resultado.yaProcesadas += 1;
        continue;
      }
      throw err;
    }

    resultado.insertadas += 1;

    if (existente) {
      await tx.observacionCobertura.update({
        where: { id: existente.id },
        data: { vigente: false, reemplazadaPorId: nuevaFilaId, reemplazadaEn: new Date() },
      });
      resultado.corregidas += 1;
    }
  }

  return resultado;
}

const TAMANO_LOTE = 500; // ver el razonamiento completo en src/domain/limitesImportacionCsv.ts

function sumarResultados(a: ResultadoImportarLote, b: ResultadoImportarLote): ResultadoImportarLote {
  return {
    insertadas: a.insertadas + b.insertadas,
    corregidas: a.corregidas + b.corregidas,
    sinCambios: a.sinCambios + b.sinCambios,
    yaProcesadas: a.yaProcesadas + b.yaProcesadas,
  };
}

/**
 * Orquesta la escritura completa: parte `filas` en lotes de ~500 y corre
 * cada lote en su propia tenantTransaction (nunca una transaccion
 * gigante para todo el archivo -- ver limitesImportacionCsv.ts). Un lote
 * que falla no revierte los lotes anteriores ya confirmados (son
 * transacciones independientes) -- si el job se reintenta, los lotes ya
 * confirmados vuelven a pasar por procesarLoteCobertura() pero cada fila
 * resuelve en yaProcesadas via P2002, nunca se duplica.
 */
export async function importarObservacionesCobertura(
  contexto: ContextoImportacionCobertura,
  filas: readonly FilaCoberturaParaImportar[],
): Promise<ResultadoImportarLote> {
  let total: ResultadoImportarLote = { insertadas: 0, corregidas: 0, sinCambios: 0, yaProcesadas: 0 };
  for (let inicio = 0; inicio < filas.length; inicio += TAMANO_LOTE) {
    const lote = filas.slice(inicio, inicio + TAMANO_LOTE);
    const resultadoLote = await tenantTransaction(contexto.empresaId, (tx) => procesarLoteCobertura(tx, contexto, lote));
    total = sumarResultados(total, resultadoLote);
  }
  return total;
}

export interface AlcanceReemplazo {
  fechaCorteInicio: Date;
  fechaCorteFin: Date;
  // Ya normalizadas (mayusculas + trim de extremos) -- mismo criterio que
  // sku/ubicacion en interpretarFilaCoberturaCsv.ts. El caller (la ruta
  // de confirmar) es responsable de normalizar antes de llegar aca.
  ubicaciones: readonly string[];
}

export interface ResultadoRetiro {
  retiradas: number;
}

/**
 * SOLO para estrategia REEMPLAZO_ALCANCE (ver EstrategiaImportacionCsv en
 * prisma/schema.prisma) -- retira explicitamente (vigente=false,
 * reemplazadaPorId=null: "se retira", no "se reemplaza por otra fila")
 * cualquier ObservacionCobertura vigente de fuente="csv" dentro del
 * alcance declarado (rango de fechaCorte + lista de ubicaciones, los DOS
 * obligatorios -- un rango de fechas por si solo NUNCA autoriza a retirar
 * nada, regla confirmada por Alex el 2026-09-24) que NO este entre las
 * claves de negocio que trajo el archivo. Se llama DESPUES de que
 * importarObservacionesCobertura() ya escribio todas las filas del
 * archivo -- `clavesEnArchivo` debe incluir TODAS las filas del archivo
 * que se guardaron o que ya estaban vigentes sin cambios (sinCambios),
 * nunca solo las insertadas, o esta funcion retiraria por error una fila
 * que el archivo si declaraba pero que resulto identica a la vigente.
 */
export async function procesarRetiroFueraDeAlcance(
  tx: TxCobertura,
  contexto: Pick<ContextoImportacionCobertura, "empresaId" | "cadenaId">,
  alcance: AlcanceReemplazo,
  clavesEnArchivo: ReadonlySet<string>,
): Promise<ResultadoRetiro> {
  const vigentesEnAlcance = await tx.observacionCobertura.findMany({
    where: {
      cadenaId: contexto.cadenaId,
      fuente: "csv",
      vigente: true,
      fechaCorte: { gte: alcance.fechaCorteInicio, lte: alcance.fechaCorteFin },
      ubicacion: { in: [...alcance.ubicaciones] },
    },
    select: { id: true, sku: true, ubicacion: true, fechaCorte: true },
  });

  const aRetirar = vigentesEnAlcance.filter(
    (fila: { sku: string; ubicacion: string; fechaCorte: Date }) =>
      !clavesEnArchivo.has(claveNegocio(fila.sku, fila.ubicacion, fila.fechaCorte)),
  );

  for (const fila of aRetirar) {
    await tx.observacionCobertura.update({
      where: { id: fila.id },
      data: { vigente: false, reemplazadaEn: new Date() },
    });
  }

  return { retiradas: aRetirar.length };
}

/** Wrapper delgado que abre la tenantTransaction -- ver
 * procesarRetiroFueraDeAlcance() para la logica en si (probada aparte con
 * un `tx` falso, mismo patron que procesarLoteCobertura()). */
export async function retirarObservacionesFueraDeAlcance(
  contexto: Pick<ContextoImportacionCobertura, "empresaId" | "cadenaId">,
  alcance: AlcanceReemplazo,
  clavesEnArchivo: ReadonlySet<string>,
): Promise<ResultadoRetiro> {
  return tenantTransaction(contexto.empresaId, (tx) => procesarRetiroFueraDeAlcance(tx, contexto, alcance, clavesEnArchivo));
}

