// Infraestructura -- resumen/version de Cobertura (ImportacionCsv +
// ObservacionCobertura), extraido de cobertura/importaciones/[id]/
// page.tsx (correccion de ronda de revision, ver el reporte de entrega,
// "bloqueantes corregidos", punto 1). Relocacion de la logica de
// AGREGACION y de la consulta de HISTORICO -- no de la pagina completa
// (que ademas consulta `filas`/`rangoFechaCorte` para mostrar la tabla,
// algo que esta capa de analisis/derivacion nunca necesita) -- para que
// derivarOrigenActual.ts pueda recalcular, en el SERVIDOR, el mismo
// `estadoVersion`/`ruleVersion`/`resumen` y el mismo historico que ya
// usa la pagina para "Analisis y decision", sin duplicar la logica de
// agregacion (solo las 2 consultas Prisma en si -- ver
// cargarResumenYVersionCobertura() mas abajo -- quedan "duplicadas"
// entre la pagina y esta capa, porque la pagina necesita 2 consultas
// MAS que la derivacion de prioridad no usa; la logica de COMO se
// deriva estadoVersion/ruleVersion a partir de los grupos SI es una
// sola, reutilizada por ambas).
//
// `derivarEstadoVersionCobertura()` y `derivarEstadoVersionCoberturaPorImport()`
// son funciones PURAS -- mismo codigo que antes vivia inline (el reduce
// sobre `porEstadoBruto`) en cargarResultadoImportacionCobertura() y
// cargarHistoricoResumenCobertura() de la pagina, extraido sin cambiar
// ni un operador, para poder probarlas con datos de entrada directos
// (sin mockear Prisma) y para que ambos puntos de entrada (pagina y
// derivarOrigenActual.ts) usen EXACTAMENTE la misma regla.
import type { EstadoObservacionCobertura } from "@prisma/client";
import type { TenantPrismaClient } from "../../prisma/tenantClient";
import { resumirFilasCobertura, type ResumenFilasCobertura } from "../estadoVisualizacion";
import type { EstadoVersionCobertura, PuntoResumenCobertura } from "../analisisDecision";

// Tope de importaciones PROCESADA anteriores a traer para el analisis de
// tendencia -- mismo criterio que LIMITE_FILAS_TABLA en la pagina: un
// numero fijo, documentado, no "todo el historico".
export const LIMITE_HISTORICO_COBERTURA = 6;

interface GrupoPorEstadoYVersion {
  estado: EstadoObservacionCobertura;
  ruleVersion: string;
  _count: { _all: number };
}

/** Deriva, a partir de los grupos de UN solo groupBy (by: ["estado",
 * "ruleVersion"], where: {importId}), el conteo por estado Y el
 * EstadoVersionCobertura/ruleVersion de esa UNA importacion -- SIN_FILAS
 * si no hay ningun grupo (0 filas), UNICA si todos declaran la misma
 * ruleVersion, MEZCLADA si hay 2+ distintas. */
export function derivarEstadoVersionCobertura(grupos: GrupoPorEstadoYVersion[]): {
  porEstado: Partial<Record<EstadoObservacionCobertura, number>>;
  estadoVersion: EstadoVersionCobertura;
  ruleVersion: string | null;
} {
  const porEstado: Partial<Record<EstadoObservacionCobertura, number>> = {};
  const versionesVistas = new Set<string>();
  for (const grupo of grupos) {
    porEstado[grupo.estado] = (porEstado[grupo.estado] ?? 0) + grupo._count._all;
    versionesVistas.add(grupo.ruleVersion);
  }
  const estadoVersion: EstadoVersionCobertura =
    versionesVistas.size === 0 ? "SIN_FILAS" : versionesVistas.size === 1 ? "UNICA" : "MEZCLADA";
  const ruleVersion = estadoVersion === "UNICA" ? [...versionesVistas][0] ?? null : null;
  return { porEstado, estadoVersion, ruleVersion };
}

interface GrupoPorImportEstadoYVersion {
  importId: string | null;
  estado: EstadoObservacionCobertura;
  ruleVersion: string;
  _count: { _all: number };
}

/** Misma derivacion que la de arriba, pero para VARIAS importaciones a
 * la vez (un solo groupBy agrupado tambien por "importId") -- usada por
 * el historico. Un importId sin ningun grupo (0 filas) no aparece en
 * ningun Map de salida -- el llamador lo trata como SIN_FILAS al leerlo
 * con `.get(id) ?? "SIN_FILAS"`, igual que ya hacia la pagina. */
export function derivarEstadoVersionCoberturaPorImport(grupos: GrupoPorImportEstadoYVersion[]): {
  porImportEstado: Map<string, Partial<Record<EstadoObservacionCobertura, number>>>;
  estadoVersionPorImport: Map<string, EstadoVersionCobertura>;
  ruleVersionPorImport: Map<string, string | null>;
} {
  const porImportEstado = new Map<string, Partial<Record<EstadoObservacionCobertura, number>>>();
  const versionesPorImport = new Map<string, Set<string>>();
  for (const grupo of grupos) {
    if (!grupo.importId) continue;
    const actual = porImportEstado.get(grupo.importId) ?? {};
    actual[grupo.estado] = (actual[grupo.estado] ?? 0) + grupo._count._all;
    porImportEstado.set(grupo.importId, actual);
    const versiones = versionesPorImport.get(grupo.importId) ?? new Set<string>();
    versiones.add(grupo.ruleVersion);
    versionesPorImport.set(grupo.importId, versiones);
  }
  const estadoVersionPorImport = new Map<string, EstadoVersionCobertura>();
  const ruleVersionPorImport = new Map<string, string | null>();
  for (const [importId, versiones] of versionesPorImport) {
    const estado: EstadoVersionCobertura = versiones.size === 1 ? "UNICA" : "MEZCLADA";
    estadoVersionPorImport.set(importId, estado);
    ruleVersionPorImport.set(importId, estado === "UNICA" ? [...versiones][0] ?? null : null);
  }
  return { porImportEstado, estadoVersionPorImport, ruleVersionPorImport };
}

/** Las 2 consultas (groupBy + count) que, juntas, alcanzan para derivar
 * resumen/estadoVersion/ruleVersion de UNA importacion -- subconjunto de
 * las 4 que usa cargarResultadoImportacionCobertura() en la pagina
 * (esta funcion NUNCA pide `rangoFechaCorte` ni `filas`, que son
 * exclusivamente para mostrar la tabla, no para el analisis). Usada por
 * la pagina (que ademas pide aggregate+findMany en el mismo Promise.all)
 * y por derivarOrigenActual.ts (que no necesita nada mas que esto). */
export async function cargarResumenYVersionCobertura(
  client: TenantPrismaClient,
  importId: string,
): Promise<{ resumen: ResumenFilasCobertura; estadoVersion: EstadoVersionCobertura; ruleVersion: string | null; totalFilasPersistidas: number }> {
  const [porEstadoBruto, calculadaConCeroDias] = await Promise.all([
    client.observacionCobertura.groupBy({ by: ["estado", "ruleVersion"], where: { importId }, _count: { _all: true } }),
    client.observacionCobertura.count({ where: { importId, estado: "CALCULADA", coberturaDias: 0 } }),
  ]);

  const { porEstado, estadoVersion, ruleVersion } = derivarEstadoVersionCobertura(
    porEstadoBruto as GrupoPorEstadoYVersion[],
  );
  let totalFilasPersistidas = 0;
  for (const cantidad of Object.values(porEstado)) totalFilasPersistidas += cantidad ?? 0;

  return {
    resumen: resumirFilasCobertura(porEstado, calculadaConCeroDias),
    estadoVersion,
    ruleVersion,
    totalFilasPersistidas,
  };
}

/** Historico de importaciones PROCESADA anteriores (misma cadena), con
 * el resumen por categoria de cada una -- para "Analisis y decision"
 * (PR2) y, ahora, para derivarOrigenActual.ts (PR3, correccion de
 * ronda de revision). Relocacion EXACTA de la funcion que antes vivia
 * en la pagina -- mismas 2 consultas (nunca N+1), mismo orden
 * cronologico ascendente, mismo criterio de "sin confirmadaEn no hay
 * ancla temporal valida" -- ver el comentario original (ahora aca) para
 * el razonamiento completo. */
export async function cargarHistoricoResumenCobertura(
  client: TenantPrismaClient,
  cadenaId: string,
  importIdActual: string,
  confirmadaEnActual: Date | null,
): Promise<PuntoResumenCobertura[]> {
  if (confirmadaEnActual === null) {
    return [];
  }

  const importaciones = await client.importacionCsv.findMany({
    where: {
      cadenaId,
      definicionKpi: { codigo: "COBERTURA" },
      estado: "CONFIRMADA",
      procesadaEn: { not: null },
      id: { not: importIdActual },
      confirmadaEn: { lt: confirmadaEnActual },
    },
    orderBy: { confirmadaEn: "desc" },
    take: LIMITE_HISTORICO_COBERTURA,
    select: { id: true, periodoReferenciaConsumoInicio: true, periodoReferenciaConsumoFin: true },
  });

  if (importaciones.length === 0) {
    return [];
  }

  const importIds = importaciones.map((imp: { id: string }) => imp.id);

  const [porEstadoBruto, calculadaConCeroDiasBruto] = await Promise.all([
    client.observacionCobertura.groupBy({
      by: ["importId", "estado", "ruleVersion"],
      where: { importId: { in: importIds } },
      _count: { _all: true },
    }),
    client.observacionCobertura.groupBy({
      by: ["importId"],
      where: { importId: { in: importIds }, estado: "CALCULADA", coberturaDias: 0 },
      _count: { _all: true },
    }),
  ]);

  const { porImportEstado, estadoVersionPorImport, ruleVersionPorImport } = derivarEstadoVersionCoberturaPorImport(
    porEstadoBruto as GrupoPorImportEstadoYVersion[],
  );

  const ceroDiasPorImport = new Map<string, number>();
  for (const grupo of calculadaConCeroDiasBruto as Array<{ importId: string | null; _count: { _all: number } }>) {
    if (!grupo.importId) continue;
    ceroDiasPorImport.set(grupo.importId, grupo._count._all);
  }

  // La consulta de arriba vino en orden desc (mas reciente primero) --
  // generarAnalisisImportacionCobertura() espera orden cronologico
  // ascendente, mismo criterio que cargarHistoricoObservacionesKpi().
  const importacionesAscendente = [...importaciones].reverse();

  return importacionesAscendente.map(
    (imp: { id: string; periodoReferenciaConsumoInicio: Date | null; periodoReferenciaConsumoFin: Date | null }) => ({
      importId: imp.id,
      periodoReferencia: { inicio: imp.periodoReferenciaConsumoInicio, fin: imp.periodoReferenciaConsumoFin },
      resumen: resumirFilasCobertura(porImportEstado.get(imp.id) ?? {}, ceroDiasPorImport.get(imp.id) ?? 0),
      estadoVersion: estadoVersionPorImport.get(imp.id) ?? "SIN_FILAS",
      ruleVersion: ruleVersionPorImport.get(imp.id) ?? null,
    }),
  );
}
