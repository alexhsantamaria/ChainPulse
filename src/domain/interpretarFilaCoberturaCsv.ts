// Dominio -- interpreta una fila cruda de un CSV de Cobertura (ya
// mapeada por mapeoColumnasCsv.ts) en una fila tipada para el motor
// (src/engine/kpis/cobertura.ts). Funcion PURA -- ver cabecera de
// mapeoColumnasCsv.ts.
//
// Normalizacion de sku/ubicacion: SOLO mayusculas + trim de extremos --
// preserva ceros iniciales, guiones y espacios internos. Regla
// confirmada por Alex el 2026-09-24 (ver el comentario de
// ObservacionCobertura en prisma/schema.prisma) -- NUNCA "limpiar" mas
// que eso, o dos SKU distintos podrian colisionar en la misma clave de
// negocio. El valor original (sin normalizar) se devuelve aparte
// (skuOriginal/ubicacionOriginal) para *Original.
//
// Fecha de corte: se exige ISO 8601 estricto AAAA-MM-DD, nunca DD/MM/AAAA
// ni MM/DD/AAAA -- un archivo de origen peruano y uno "americano"
// interpretarian esas dos convenciones al reves sin ningun aviso, la
// misma clase de inferencia silenciosa que este proyecto evita en todos
// lados (ver engine/kpis/cobertura.ts regla 9, cabecera de
// sanitizacionCsv.ts). Una fila con otro formato se rechaza con error
// explicito, nunca se adivina.
//
// Unidades vacias (unidadInventario/unidadConsumoDiario): se pasan tal
// cual (string vacio) al motor -- cobertura.ts ya las trata como
// "incompatibles" por diseño propio (regla 1: "si vienen vacias, se
// tratan como incompatibles"). Esta funcion NO las rechaza como error de
// fila -- rechazarlas aca duplicaria una decision que el motor ya toma.
//
// Inventario/consumo (inventarioDisponible/consumoDiarioEsperado): celda
// vacia -> null (el motor lo interpreta como "Datos incompletos", nunca
// 0). Celda no vacia pero no numerica -> error de fila -- nunca se
// coacciona en silencio a null ni a 0.
import type { FilaCobertura } from "@/engine/kpis/cobertura";
import type { CampoCoberturaCsv, MapeoColumnasCobertura } from "./mapeoColumnasCsv";

const PATRON_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface FilaCoberturaInterpretada {
  fila: FilaCobertura;
  skuOriginal: string;
  ubicacionOriginal: string;
}

export type ResultadoInterpretarFila =
  | { ok: true; datos: FilaCoberturaInterpretada }
  | { ok: false; numeroFila: number; error: string };

function leerColumna(filaCruda: Record<string, string>, mapeo: MapeoColumnasCobertura, campo: CampoCoberturaCsv): string {
  const columna = mapeo[campo];
  // El caller valida el mapeo completo con validarMapeoColumnas() antes
  // de llamar a esta funcion fila por fila -- si columna es null aca es
  // un error de programacion del caller, no de datos del usuario; se
  // trata como celda vacia en vez de lanzar, para no tumbar el parseo
  // completo por un bug de otro modulo.
  if (!columna) return "";
  return (filaCruda[columna] ?? "").trim();
}

function normalizarClaveNegocio(valor: string): string {
  return valor.trim().toUpperCase();
}

type ResultadoNumeroOpcional = { ok: true; valor: number | null } | { ok: false; error: string };

function parsearNumeroOpcional(valor: string, etiqueta: string): ResultadoNumeroOpcional {
  if (valor === "") return { ok: true, valor: null };
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${etiqueta} "${valor}" no es un numero valido` };
  }
  return { ok: true, valor: n };
}

/** Ancla a MEDIODIA UTC (nunca medianoche) para que diaEnZona() (regla 8
 * de cobertura.ts) recupere el MISMO dia calendario que este string en
 * cualquier zona horaria real usada por este producto (America Latina,
 * offsets UTC-3 a UTC-6 hoy) -- anclar a medianoche UTC desplazaria la
 * fecha un dia hacia atras en cualquier zona con offset negativo,
 * exactamente el riesgo que el comentario de
 * ObservacionCobertura.fechaCorte (prisma/schema.prisma) documenta.
 * Seguro para cualquier offset real entre UTC-12 y UTC+11 (todo el
 * continente americano y la inmensa mayoria del planeta) -- si este
 * producto opera algun dia en una zona de offset UTC+12 o mayor, este
 * anclaje debe revisarse. */
function fechaCorteDesdeIso(fechaIso: string): Date {
  return new Date(`${fechaIso}T12:00:00.000Z`);
}

/**
 * @param numeroFila 1-based tal como se muestra al usuario (fila 1 =
 * primera fila de datos, sin contar el encabezado) -- se persiste en
 * ObservacionCobertura.numeroFila para retry-safety (ver
 * uq_observacion_cobertura_intento_csv en la migracion).
 * @param mapeo Debe haber pasado validarMapeoColumnas() con valido=true
 * antes de llamar aca -- esta funcion no vuelve a validar el mapeo en
 * si, solo el contenido de la fila.
 */
export function interpretarFilaCobertura(
  filaCruda: Record<string, string>,
  numeroFila: number,
  mapeo: MapeoColumnasCobertura,
): ResultadoInterpretarFila {
  const skuOriginal = leerColumna(filaCruda, mapeo, "sku");
  const ubicacionOriginal = leerColumna(filaCruda, mapeo, "ubicacion");
  const fechaCruda = leerColumna(filaCruda, mapeo, "fechaCorte");
  const unidadInventario = leerColumna(filaCruda, mapeo, "unidadInventario");
  const unidadConsumoDiario = leerColumna(filaCruda, mapeo, "unidadConsumoDiario");

  if (!skuOriginal) return { ok: false, numeroFila, error: "SKU vacio" };
  if (!ubicacionOriginal) return { ok: false, numeroFila, error: "Ubicacion vacia" };
  if (!fechaCruda) return { ok: false, numeroFila, error: "Fecha de corte vacia" };
  if (!PATRON_FECHA_ISO.test(fechaCruda)) {
    return { ok: false, numeroFila, error: `Fecha de corte "${fechaCruda}" no tiene el formato AAAA-MM-DD exigido` };
  }
  const fecha = fechaCorteDesdeIso(fechaCruda);
  if (Number.isNaN(fecha.getTime())) {
    return { ok: false, numeroFila, error: `Fecha de corte "${fechaCruda}" no es una fecha valida` };
  }

  const inventario = parsearNumeroOpcional(leerColumna(filaCruda, mapeo, "inventarioDisponible"), "Inventario disponible");
  if (!inventario.ok) return { ok: false, numeroFila, error: inventario.error };
  const consumo = parsearNumeroOpcional(leerColumna(filaCruda, mapeo, "consumoDiarioEsperado"), "Consumo diario esperado");
  if (!consumo.ok) return { ok: false, numeroFila, error: consumo.error };

  return {
    ok: true,
    datos: {
      skuOriginal,
      ubicacionOriginal,
      fila: {
        sku: normalizarClaveNegocio(skuOriginal),
        ubicacion: normalizarClaveNegocio(ubicacionOriginal),
        fecha,
        inventarioDisponible: inventario.valor,
        consumoDiarioEsperado: consumo.valor,
        unidadInventario,
        unidadConsumoDiario,
      },
    },
  };
}
