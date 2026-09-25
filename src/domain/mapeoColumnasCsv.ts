// Dominio -- mapeo de columnas de un CSV de Cobertura a los campos
// canonicos que espera el motor (src/engine/kpis/cobertura.ts) y el
// modelo ObservacionCobertura (prisma/schema.prisma). Funcion PURA (sin
// Prisma, sin R2, sin red) para poder probarla aislada -- mismo criterio
// que sanitizacionCsv.ts/limitesImportacionCsv.ts.
//
// Alcance de este archivo (Incremento 4 Bloque B, vertical slice de
// Cobertura elegida por Alex 2026-09-25 -- PLAN-DE-TRABAJO.md): SOLO
// sku/ubicacion/fecha de corte/inventario/unidad-inventario/
// consumo/unidad-consumo vienen del CSV. fuenteConsumo y el periodo de
// referencia del consumo se piden UNA SOLA VEZ en el formulario de
// confirmacion y se aplican a todas las filas de la importacion (decision
// de Alex, 2026-09-25, ver AskUserQuestion de esa fecha) -- NO son
// columnas mapeables aca a proposito.
//
// "requerido" abajo se refiere UNICAMENTE al mapeo (la columna debe
// existir en el archivo para que sepamos de donde leer el valor) -- no
// implica que la CELDA de cada fila deba venir llena. Ver
// interpretarFilaCoberturaCsv.ts para las reglas de celda-por-celda
// (ej. inventario/consumo vacios son validos, "Datos incompletos").
export type CampoCoberturaCsv =
  | "sku"
  | "ubicacion"
  | "fechaCorte"
  | "inventarioDisponible"
  | "unidadInventario"
  | "consumoDiarioEsperado"
  | "unidadConsumoDiario";

interface DefinicionCampoCoberturaCsv {
  campo: CampoCoberturaCsv;
  etiqueta: string; // para mostrar en la UI de mapeo
  // Encabezados candidatos YA normalizados (ver normalizarEncabezado) --
  // agregar alias aca es seguro, nunca cambia una fila ya interpretada.
  alias: readonly string[];
}

export const CAMPOS_COBERTURA_CSV: readonly DefinicionCampoCoberturaCsv[] = [
  { campo: "sku", etiqueta: "SKU", alias: ["sku", "codigo sku", "codigo", "sku codigo"] },
  { campo: "ubicacion", etiqueta: "Ubicacion", alias: ["ubicacion", "almacen", "sede", "location", "warehouse"] },
  {
    campo: "fechaCorte",
    etiqueta: "Fecha de corte",
    alias: ["fecha de corte", "fecha corte", "fechacorte", "fecha", "cutoff date", "fecha de observacion"],
  },
  {
    campo: "inventarioDisponible",
    etiqueta: "Inventario disponible",
    alias: ["inventario disponible", "inventario", "stock", "stock disponible", "available inventory"],
  },
  {
    campo: "unidadInventario",
    etiqueta: "Unidad de inventario",
    alias: ["unidad inventario", "unidad de inventario", "unidad stock", "unidad de stock", "unidad"],
  },
  {
    campo: "consumoDiarioEsperado",
    etiqueta: "Consumo diario esperado",
    alias: ["consumo diario esperado", "consumo diario", "consumo esperado", "consumo", "daily consumption"],
  },
  {
    campo: "unidadConsumoDiario",
    etiqueta: "Unidad de consumo diario",
    alias: ["unidad consumo diario", "unidad de consumo diario", "unidad de consumo", "unidad consumo"],
  },
];

/** Normaliza un encabezado para comparar contra `alias`: sin acentos,
 * minusculas, guiones/guiones bajos colapsados a espacio, espacios
 * multiples colapsados. Nunca se usa para el valor de una CELDA (eso lo
 * gobierna la regla de sku/ubicacion en interpretarFilaCoberturaCsv.ts,
 * que preserva ceros iniciales/guiones/espacios internos a proposito). */
export function normalizarEncabezado(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export type MapeoColumnasCobertura = Record<CampoCoberturaCsv, string | null>;

/** Propone un mapeo campo->encabezado original comparando cada encabezado
 * del archivo (normalizado) contra los alias conocidos. SIEMPRE editable
 * por el usuario en la UI antes de confirmar -- esto es una propuesta,
 * nunca se aplica en silencio (mismo criterio que el resto del proyecto,
 * ver cabecera de sanitizacionCsv.ts). */
export function proponerMapeoColumnas(encabezados: readonly string[]): MapeoColumnasCobertura {
  const candidatos = encabezados.map((original) => ({ original, normalizado: normalizarEncabezado(original) }));
  const mapeo = {} as MapeoColumnasCobertura;
  for (const def of CAMPOS_COBERTURA_CSV) {
    const encontrado = candidatos.find((c) => def.alias.includes(c.normalizado));
    mapeo[def.campo] = encontrado ? encontrado.original : null;
  }
  return mapeo;
}

export interface ResultadoValidacionMapeo {
  valido: boolean;
  camposFaltantes: CampoCoberturaCsv[]; // sin columna asignada
  columnasInvalidas: CampoCoberturaCsv[]; // asignadas a un encabezado que ya no existe en el archivo
  columnasDuplicadas: string[]; // un mismo encabezado asignado a mas de un campo
}

/** Valida un mapeo (propuesto o editado a mano por el usuario) contra los
 * encabezados reales del archivo -- se llama tanto en la previsualizacion
 * como otra vez en la confirmacion (el usuario pudo editar el mapeo entre
 * medio, nunca se confia en la propuesta original sin re-validar). */
export function validarMapeoColumnas(
  mapeo: MapeoColumnasCobertura,
  encabezadosDisponibles: readonly string[],
): ResultadoValidacionMapeo {
  const disponibles = new Set(encabezadosDisponibles);
  const camposFaltantes: CampoCoberturaCsv[] = [];
  const columnasInvalidas: CampoCoberturaCsv[] = [];
  const conteoPorColumna = new Map<string, number>();

  for (const def of CAMPOS_COBERTURA_CSV) {
    const columna = mapeo[def.campo];
    if (!columna) {
      camposFaltantes.push(def.campo);
      continue;
    }
    if (!disponibles.has(columna)) {
      columnasInvalidas.push(def.campo);
      continue;
    }
    conteoPorColumna.set(columna, (conteoPorColumna.get(columna) ?? 0) + 1);
  }

  const columnasDuplicadas = [...conteoPorColumna.entries()].filter(([, n]) => n > 1).map(([columna]) => columna);

  return {
    valido: camposFaltantes.length === 0 && columnasInvalidas.length === 0 && columnasDuplicadas.length === 0,
    camposFaltantes,
    columnasInvalidas,
    columnasDuplicadas,
  };
}

// -- Deteccion de columnas sospechosas de fuente/periodo de consumo --
//
// Decision de Alex (2026-09-25): fuenteConsumo y el periodo de
// referencia del consumo se piden UNA SOLA VEZ en el formulario de
// confirmacion, nunca como columna del CSV (ver cabecera). Pero si el
// archivo TRAE una columna que se parece a uno de esos tres campos, sea
// porque el usuario malentendio el formato o porque viene de un export
// que los incluye, esa columna NUNCA debe ignorarse ni sobreescribirse
// en silencio -- hay que detectarla y forzar una resolucion explicita
// antes de confirmar (nunca asumir cual de los dos valores -- el del
// formulario o el de la columna ignorada -- es el correcto).
//
// Alias deliberadamente MAS AMPLIOS que los de mapeoColumnas (incluyen
// "origen"/"period[o]" sueltos) porque el costo de un falso positivo acá
// (preguntarle al usuario "¿esta columna es de fuente/periodo de
// consumo?" cuando en realidad no lo es) es bajo -- una confirmacion de
// mas -- mientras que el costo de un falso negativo (una columna de
// fuente/periodo real que pasa desapercibida) es alto -- un dato
// silenciosamente ignorado, exactamente lo que Alex pidio evitar.
const ALIAS_FUENTE_CONSUMO_SOSPECHOSOS = [
  "fuente consumo",
  "fuente de consumo",
  "fuente del consumo",
  "origen consumo",
  "origen del consumo",
  "consumo fuente",
  "source consumption",
];

const ALIAS_PERIODO_CONSUMO_SOSPECHOSOS = [
  "periodo consumo",
  "periodo de consumo",
  "periodo de referencia",
  "periodo de referencia del consumo",
  "periodo referencia consumo",
  "periodo referencia consumo inicio",
  "periodo referencia consumo fin",
  "consumption period",
  "inicio periodo consumo",
  "fin periodo consumo",
];

export interface ColumnaSospechosa {
  encabezado: string; // el encabezado original del archivo, sin normalizar
  campo: "fuenteConsumo" | "periodoReferenciaConsumo";
}

/**
 * Encabezados del archivo que NO forman parte del mapeo de
 * CAMPOS_COBERTURA_CSV (serian ignorados por el resto del flujo) pero se
 * parecen a fuenteConsumo o al periodo de referencia del consumo -- ver
 * cabecera de esta seccion. El caller (la ruta de subir/previsualizar, y
 * de nuevo la de confirmar -- nunca confiar solo en lo que mando el
 * cliente) debe bloquear la confirmacion mientras esta lista no este
 * vacia, salvo que el usuario la haya revisado explicitamente.
 */
export function detectarColumnasSospechosasDeConsumo(
  encabezados: readonly string[],
  mapeo: MapeoColumnasCobertura,
): ColumnaSospechosa[] {
  const columnasYaMapeadas = new Set(Object.values(mapeo).filter((c): c is string => c !== null));
  const sospechosas: ColumnaSospechosa[] = [];

  for (const encabezado of encabezados) {
    if (columnasYaMapeadas.has(encabezado)) continue; // ya es sku/ubicacion/etc, no puede ser tambien fuente/periodo
    const normalizado = normalizarEncabezado(encabezado);
    if (ALIAS_FUENTE_CONSUMO_SOSPECHOSOS.includes(normalizado)) {
      sospechosas.push({ encabezado, campo: "fuenteConsumo" });
    } else if (ALIAS_PERIODO_CONSUMO_SOSPECHOSOS.includes(normalizado)) {
      sospechosas.push({ encabezado, campo: "periodoReferenciaConsumo" });
    }
  }

  return sospechosas;
}

