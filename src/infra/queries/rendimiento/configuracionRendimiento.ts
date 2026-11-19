// Infraestructura (solo para las herramientas de scripts/perf/, nunca
// usado por la app en runtime) -- configuracion PURA compartida por los
// 3 scripts inertes de medicion de rendimiento de Incremento 5 PR4
// (semillaSinteticaConsultas.ts, explicarConsultas.ts,
// cargaConsultas.ts). Pura a proposito (Alex, 2026-11-19, misma
// filosofia que destinoPrueba.ts: "separar lo que se puede probar sin
// tocar una base real de lo que necesita una conexion real") -- se
// prueba con vitest sin mockear Prisma ni tocar ninguna base.
//
// NINGUNO de estos 3 scripts se ejecuta ni se conecta a Neon bajo esta
// autorizacion (Alex, 2026-11-19): "Autorizo crear scripts inertes...
// pero no ejecutarlos ni conectarse todavia a Neon." Este archivo y los
// scripts que lo usan quedan listos para cuando llegue esa autorizacion
// separada (ver diseno de PR4, Seccion 6.4/Decision D1).

/** Escalas de filas sinteticas POR CADENA exigidas por Alex (2026-11-19):
 * 100 (volumen piloto real esperado), 1.000 y 10.000 (margen de
 * crecimiento), 50.000 (estres, muy por encima de MAX_FILAS_CONSULTA=
 * 1.000 -- a proposito: a esa escala el techo de filas del ejecutor YA
 * trunca el resultado devuelto al cliente, pero el COSTO de que
 * Postgres decida como llegar a esas primeras 1.000 filas dentro de un
 * universo de 50.000 es exactamente lo que un indice nuevo cambiaria --
 * medir solo hasta 10.000 no alcanzaria para verlo). */
export const ESCALAS_FILAS_POR_CADENA = [100, 1_000, 10_000, 50_000] as const;
export type EscalaFilasPorCadena = (typeof ESCALAS_FILAS_POR_CADENA)[number];

export function esEscalaValida(valor: number): valor is EscalaFilasPorCadena {
  return (ESCALAS_FILAS_POR_CADENA as readonly number[]).includes(valor);
}

/** Marca incrustada en el nombre de la Empresa/Cadena sinteticas (mismo
 * criterio que MARCA="borrar si queda huerfana" de
 * scripts/limpiarTenantsPrueba.ts): nunca coincide con el nombre de una
 * empresa/cadena real, y es la UNICA condicion que semillaSinteticaConsultas.ts
 * usa para encontrar y borrar (--limpiar) exactamente lo que el mismo
 * script creo -- limpieza recuperable, nunca un DELETE sin esa marca. */
export const MARCA_SINTETICA_RENDIMIENTO_PR4 = "chainpulse-pr4-rendimiento-sintetico";

/** Nombre reproducible de la Empresa/Cadena sinteticas para una escala
 * dada -- siempre el mismo nombre para la misma escala, para que
 * volver a correr el script sin --limpiar primero sea un error claro
 * (colision de nombre) en vez de acumular cadenas duplicadas sin darse
 * cuenta. */
export function nombreEmpresaSinteticaParaEscala(escala: EscalaFilasPorCadena): string {
  return `${MARCA_SINTETICA_RENDIMIENTO_PR4}-escala-${escala}`;
}

/** Las 4 tablas que las 6 consultas determinísticas leen (ver diseno de
 * PR4, Seccion 1) -- `filasPorCadenaObjetivo` es cuantas filas
 * SINTETICAS de esa tabla sembrar para ESTA cadena especifica a esta
 * escala. Documentado explicitamente el porque de cada numero (nunca
 * "escala filas" ciegamente igual en las 4 tablas -- cada una tiene una
 * forma de crecer distinta en la realidad, ver comentarios). */
export interface PlanSiembraPorTabla {
  // CORRECCION (ronda 2 de revision, 2026-11-19, punto 5): la version
  // anterior tenia un solo campo "observacionKpi", y semillaSinteticaConsultas.ts
  // sembraba TODAS esas filas bajo definicionOtif.id -- aunque
  // explicarConsultas.ts (desde la correccion de la ronda 1) ya resuelve
  // y usa definicionFillRateId para el caso FALTANTES_FILL_RATE, el SQL
  // medido para ese caso filtraba por un definicionKpiId que NUNCA tenia
  // ninguna fila en la tabla -- el EXPLAIN mediria un escaneo contra un
  // conjunto VACIO, no contra el volumen real a la escala pedida. Ahora
  // son 2 campos separados, cada uno con la MISMA escala (nunca
  // mezclados en un solo total ambiguo) -- Alex: "manteniendo claramente
  // las escalas por cada consulta".
  observacionKpiOtif: number;
  observacionKpiFillRate: number;
  observacionOtifProveedor: number;
  conexionCadena: number;
  hallazgoCadena: number;
}

export function planSiembraParaEscala(escala: EscalaFilasPorCadena): PlanSiembraPorTabla {
  return {
    // ObservacionKpi (OTIF_CAIDA): en la realidad, el limite natural es
    // "un periodo declarado por fuente" (@@unique incluye
    // periodoInicio/periodoFin) -- generar `escala` periodos reales (ej.
    // diarios) para llegar a 50.000 exigiria ~137 anios de historia, nada
    // realista. En vez de eso se varia `fuente` (string libre,
    // "sintetico-rendimiento-000001".."NNNNNN") para satisfacer la
    // restriccion unica sin inventar un volumen de calendario absurdo --
    // INTENCIONALMENTE no representativo del dominio real, adecuado
    // UNICAMENTE para medir como escanea Postgres un volumen de filas
    // con la MISMA forma de indice, nunca para simular un escenario de
    // negocio real.
    observacionKpiOtif: escala,
    // ObservacionKpi (FALTANTES_FILL_RATE) -- CORRECCION (ronda 2, punto
    // 5): mismo razonamiento y misma escala que observacionKpiOtif de
    // arriba, pero bajo definicionFillRateId (nunca definicionOtifId) --
    // el unico definicionKpiId que FALTANTES_FILL_RATE_periodo_exacto
    // (casosExplainConsultas.ts) de verdad filtra. La restriccion unica
    // de ObservacionKpi incluye definicionKpiId, asi que reusar la MISMA
    // secuencia de nombres de `fuente` que observacionKpiOtif no colisiona
    // (son 2 definicionKpiId distintos).
    observacionKpiFillRate: escala,
    // ObservacionOtifProveedor: al contrario, SI es realista pensar en
    // `escala` proveedores distintos declarando en el MISMO periodo
    // exacto (la consulta I5-02 rankea proveedores de un periodo) --
    // aca `escala` filas = `escala` proveedorAliasClave distintos,
    // mismo periodo, escenario directamente comparable al real.
    observacionOtifProveedor: escala,
    // ConexionCadena: `escala` conexiones en el mapa de UNA cadena es
    // estres puro (un piloto real tiene decenas, no miles) -- generado
    // igual para medir el peor caso del indice de cadenaId.
    conexionCadena: escala,
    // HallazgoCadena: a diferencia de las otras, esta tabla en
    // produccion SOLO conserva una fila por dimension mientras sea
    // DIFERENCIA (persistirHallazgosCadena.ts borra la fila cuando se
    // resuelve) -- `escala` filas simultaneas en una sola cadena NUNCA
    // ocurre en la app real. Se siembran igual, directamente via SQL/
    // Prisma (nunca pasando por persistirHallazgosCadena.ts, que
    // rechazaria este volumen por diseno), porque lo que este script
    // mide es el comportamiento del PLANIFICADOR de Postgres contra un
    // volumen hipotetico, no un flujo de negocio real.
    hallazgoCadena: escala,
  };
}
