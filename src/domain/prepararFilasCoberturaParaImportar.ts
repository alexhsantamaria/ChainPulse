// Dominio -- toma TODAS las filas ya interpretadas de un CSV de Cobertura
// (interpretarFilaCoberturaCsv.ts, una por cada fila del archivo que paso
// esa etapa) y corre calcularCobertura() (src/engine/kpis/cobertura.ts)
// UNA SOLA VEZ sobre el archivo completo -- nunca por lote -- porque la
// deteccion de duplicados (regla 7 de cobertura.ts) agrupa por
// SKU+ubicacion+fecha de corte a traves de TODO el archivo, y un
// duplicado podria caer en lotes distintos de escritura (~500 filas cada
// uno, ver src/infra/kpis/cobertura/importar.ts). Funcion PURA -- no toca
// Prisma ni R2.
//
// "DUPLICADO no aplica en ObservacionCobertura" (ver el comentario de
// EstadoObservacionCobertura en prisma/schema.prisma): calcularCobertura
// ya excluye los duplicados en conflicto ANTES de llegar a persistencia
// -- esta funcion es exactamente esa etapa. Las filas en conflicto se
// devuelven como errores de importacion (erroresDuplicado), nunca se
// persisten.
//
// Acoplamiento deliberado con la implementacion de calcularCobertura:
// esa funcion hace `{...fila, estado, coberturaDias}` en cada resultado
// (nunca reconstruye un objeto desde cero) -- por eso adjuntar metadata
// extra (numeroFila/skuOriginal/ubicacionOriginal) a cada FilaCobertura
// ANTES de llamarla sobrevive intacta en el resultado, aunque el tipo
// declarado de retorno (CoberturaPorSku) no la mencione. Si
// engine/kpis/cobertura.ts alguna vez deja de spread-ear la fila original
// en su resultado, el test "preserva la metadata adjunta" de este archivo
// deberia fallar primero -- revisar ahi antes que en produccion.
import { calcularCobertura, type EstadoCoberturaFila, type FilaCobertura } from "@/engine/kpis/cobertura";
import type { FilaCoberturaInterpretada } from "./interpretarFilaCoberturaCsv";

export interface FilaCoberturaParaImportar {
  numeroFila: number;
  skuOriginal: string;
  ubicacionOriginal: string;
  fila: FilaCobertura;
  estado: Exclude<EstadoCoberturaFila, "DUPLICADO">;
  coberturaDias: number | null;
}

export interface ErrorFilaImportacion {
  numeroFila: number;
  error: string;
}

export interface ResultadoPrepararImportacion {
  filasParaGuardar: FilaCoberturaParaImportar[];
  erroresDuplicado: ErrorFilaImportacion[];
  advertencias: string[];
}

interface EntradaFilaInterpretada {
  numeroFila: number;
  datos: FilaCoberturaInterpretada;
}

// Campos de metadata adjuntados a cada FilaCobertura antes de llamar a
// calcularCobertura -- ver cabecera. Prefijo "__" para que nunca choquen
// por accidente con un campo real de FilaCobertura si esta se extiende en
// el futuro.
interface FilaConMetadata extends FilaCobertura {
  __numeroFila: number;
  __skuOriginal: string;
  __ubicacionOriginal: string;
}

/**
 * @param zonaHoraria Zona horaria IANA (ej. "America/Lima") usada por
 * calcularCobertura para agrupar por dia calendario -- normalmente
 * DefinicionKpi("COBERTURA").zonaHoraria, resuelta por el caller (el job
 * de procesamiento), nunca asumida aca.
 */
export function prepararFilasCoberturaParaImportar(
  filasInterpretadas: readonly EntradaFilaInterpretada[],
  zonaHoraria: string,
): ResultadoPrepararImportacion {
  const conMetadata: FilaConMetadata[] = filasInterpretadas.map(({ numeroFila, datos }) => ({
    ...datos.fila,
    __numeroFila: numeroFila,
    __skuOriginal: datos.skuOriginal,
    __ubicacionOriginal: datos.ubicacionOriginal,
  }));

  const resultado = calcularCobertura(conMetadata, zonaHoraria);

  const filasParaGuardar: FilaCoberturaParaImportar[] = [];
  const erroresDuplicado: ErrorFilaImportacion[] = [];

  for (const item of resultado.porSku) {
    // La metadata sobrevive por el spread de calcularCobertura -- ver
    // cabecera. Cast explicito y unico punto de esta suposicion en todo
    // el modulo.
    const meta = item as unknown as FilaConMetadata;
    if (item.estado === "DUPLICADO") {
      erroresDuplicado.push({
        numeroFila: meta.__numeroFila,
        error:
          "Fila duplicada en conflicto: mismo SKU/ubicacion/fecha de corte que otra fila del archivo, con valores distintos -- resolver a mano.",
      });
      continue;
    }
    filasParaGuardar.push({
      numeroFila: meta.__numeroFila,
      skuOriginal: meta.__skuOriginal,
      ubicacionOriginal: meta.__ubicacionOriginal,
      fila: {
        sku: item.sku,
        ubicacion: item.ubicacion,
        fecha: item.fecha,
        inventarioDisponible: item.inventarioDisponible,
        consumoDiarioEsperado: item.consumoDiarioEsperado,
        unidadInventario: item.unidadInventario,
        unidadConsumoDiario: item.unidadConsumoDiario,
      },
      estado: item.estado,
      coberturaDias: item.coberturaDias,
    });
  }

  return { filasParaGuardar, erroresDuplicado, advertencias: resultado.advertencias };
}
