// Infraestructura PURA (solo para scripts/perf/explicarConsultas.ts) --
// extraido de ese script (Incremento 5 PR4, ronda de revision
// 2026-11-19) para poder probar con vitest que cada caso usa el
// definicionKpiId CORRECTO (en particular, que FALTANTES_FILL_RATE use
// la definicion de FILL_RATE y no la de OTIF, el error real que esta
// ronda de revision encontro) sin tener que importar el script
// completo -- ese script corre `main()` al cargarse (como todos los de
// scripts/perf/, ver su propio comentario), asi que importarlo
// directamente en una prueba arrancaria esa ejecucion.
export interface IdsResueltosParaExplain {
  empresaId: string;
  cadenaId: string;
  definicionOtifId: string;
  definicionOtifProveedorId: string;
  definicionFillRateId: string;
}

export interface CasoExplain {
  id: string;
  /** true -- este caso es uno de los candidatos a indice senalados por
   * Alex (2026-11-19), que esta auditoria NO debe dar por buenos sin
   * medir. false -- el resto de los casos (ya marcados "bien cubiertos"
   * en el diseno de PR4, pero medidos aca igual, por completitud). */
  esCandidatoSenaladoPorAlex: boolean;
  sql: string;
  params: unknown[];
}

/**
 * Las 8 consultas a medir con EXPLAIN (6 preguntas del catalogo, con
 * OTIF_CAIDA y CAMBIOS_ULTIMO_PULSO partidas en sus 2 lecturas reales
 * cada una). PURA -- nunca toca una conexion, solo arma SQL+params a
 * partir de los ids ya resueltos.
 */
export function construirCasosExplain(ids: IdsResueltosParaExplain): CasoExplain[] {
  const { cadenaId, definicionOtifId, definicionOtifProveedorId, definicionFillRateId } = ids;
  const periodoInicio = new Date("2026-01-01T00:00:00.000Z");
  const periodoFin = new Date("2026-01-31T00:00:00.000Z");
  const corte = new Date("2026-06-01T00:00:00.000Z"); // dentro del rango de 400 dias sembrado por semillaSinteticaConsultas.ts

  return [
    {
      id: "OTIF_CAIDA_lectura1_periodo_exacto",
      esCandidatoSenaladoPorAlex: false,
      sql: `SELECT * FROM observaciones_kpi WHERE "cadenaId"=$1 AND "definicionKpiId"=$2 AND "periodoInicio"=$3 AND "periodoFin"=$4 ORDER BY "createdAt" DESC LIMIT 1`,
      params: [cadenaId, definicionOtifId, periodoInicio, periodoFin],
    },
    {
      id: "OTIF_CAIDA_lectura2_anterior_CANDIDATO_SENALADO_POR_ALEX",
      // Patron REAL de src/infra/queries/ejecutores/otifCaida.ts:
      // periodoInicio queda SIN restringir -- el indice unico
      // (cadenaId,definicionKpiId,periodoInicio,periodoFin,fuente) solo
      // puede usar el PREFIJO de igualdad (cadenaId,definicionKpiId);
      // el rango+orden sobre periodoFin (columna 4, no 3) con
      // periodoInicio abierto en medio puede no beneficiarse del indice
      // tanto como pareceria a primera vista -- exactamente lo que
      // Alex pidio dejar de dar por sentado.
      esCandidatoSenaladoPorAlex: true,
      sql: `SELECT * FROM observaciones_kpi WHERE "cadenaId"=$1 AND "definicionKpiId"=$2 AND "periodoFin" < $3 ORDER BY "periodoFin" DESC LIMIT 1`,
      params: [cadenaId, definicionOtifId, periodoInicio],
    },
    {
      id: "OTIF_PROVEEDOR_RETRASOS_periodo_exacto",
      esCandidatoSenaladoPorAlex: false,
      sql: `SELECT * FROM observaciones_otif_proveedor WHERE "cadenaId"=$1 AND "definicionKpiId"=$2 AND "periodoInicio"=$3 AND "periodoFin"=$4 ORDER BY "proveedorAliasClave" ASC`,
      params: [cadenaId, definicionOtifProveedorId, periodoInicio, periodoFin],
    },
    {
      id: "DEPENDENCIA_CRITICA_por_cadena",
      esCandidatoSenaladoPorAlex: false,
      sql: `SELECT cc.id, cc."impactoFalla", cc."tieneAlternativa", cc."alternativaProbada", no.nombre AS origen_nombre, nd.nombre AS destino_nombre
            FROM conexiones_cadena cc
            JOIN nodos no ON no.id = cc."origenNodoId"
            JOIN nodos nd ON nd.id = cc."destinoNodoId"
            WHERE cc."cadenaId"=$1 LIMIT 1000`,
      params: [cadenaId],
    },
    {
      id: "FALTANTES_FILL_RATE_periodo_exacto",
      esCandidatoSenaladoPorAlex: false,
      // CORREGIDO (ronda de revision 2026-11-19): antes usaba por error
      // definicionOtifId. El ejecutor real (faltantesFillRate.ts) hace
      // definicionKpi.findFirst({codigo:"FILL_RATE", estado:"PUBLICADA"})
      // y despues observacionKpi.findFirst() con ESE id -- misma forma
      // de SQL que OTIF_CAIDA lectura1, pero con la definicion correcta.
      sql: `SELECT * FROM observaciones_kpi WHERE "cadenaId"=$1 AND "definicionKpiId"=$2 AND "periodoInicio"=$3 AND "periodoFin"=$4 ORDER BY "createdAt" DESC LIMIT 1`,
      params: [cadenaId, definicionFillRateId, periodoInicio, periodoFin],
    },
    {
      id: "ACCION_PRIORITARIA_por_cadena",
      esCandidatoSenaladoPorAlex: false,
      sql: `SELECT id, dimension, resultado, "createdAt" FROM hallazgos_cadena WHERE "cadenaId"=$1 LIMIT 1000`,
      params: [cadenaId],
    },
    {
      id: "CAMBIOS_ULTIMO_PULSO_antes_del_corte_CANDIDATO_SENALADO_POR_ALEX",
      esCandidatoSenaladoPorAlex: true,
      sql: `SELECT id, dimension, resultado, "createdAt" FROM hallazgos_cadena WHERE "cadenaId"=$1 AND "createdAt" < $2 LIMIT 1000`,
      params: [cadenaId, corte],
    },
    {
      id: "CAMBIOS_ULTIMO_PULSO_desde_el_corte_CANDIDATO_SENALADO_POR_ALEX",
      esCandidatoSenaladoPorAlex: true,
      sql: `SELECT id, dimension, resultado, "createdAt" FROM hallazgos_cadena WHERE "cadenaId"=$1 AND "createdAt" >= $2 LIMIT 1000`,
      params: [cadenaId, corte],
    },
  ];
}
