// Limites explicitos de Incremento 5 (I5-14) -- mismo criterio que
// limitesDeclaracionOtif.ts: valores de partida razonados, revisables en
// un solo lugar. "el modelo de lenguaje nunca recibe credenciales" se
// satisface de forma vacia bajo el Producto 1 (no existe ningun modelo de
// lenguaje en esta arquitectura) -- ver
// docs/engineering/INCREMENTO5_CONSULTAS_DETERMINISTICAS_TRAZABILIDAD.md,
// fila I5-14.

/** 1.000 filas -- techo de filas crudas que un ejecutor puede leer de la
 * base por consulta (ej. observaciones/conexiones de una cadena en un
 * periodo). Una cadena real de un piloto no se acerca a este volumen; sirve
 * de freno de cordura contra un periodo mal acotado, no una medicion de
 * uso real. */
export const MAX_FILAS_CONSULTA = 1_000;

/** 400 dias (~13 meses) -- un periodo de consulta mas largo no tiene
 * sentido para las 6 preguntas del catalogo (todas comparan "este
 * periodo" contra "el inmediatamente anterior", nunca series historicas
 * largas) y evita que un periodo mal construido fuerce un full-scan
 * costoso. */
export const MAX_DIAS_PERIODO_CONSULTA = 400;

/** 1.500 ms -- presupuesto de computo determinista por consulta (sin IO
 * de red externo: todo el calculo es sincronico sobre filas ya cargadas).
 * No es un timeout de red -- es un techo de cordura para abortar un
 * calculo que claramente entro en un caso patologico (ej. un grafo con un
 * ciclo no esperado en DEPENDENCIA_CRITICA). */
export const PRESUPUESTO_COMPUTO_MS = 1_500;

/** 20 -- maximo de elementos en camposFaltantes/advertencias devueltos al
 * cliente (I5-20/I5-25) -- evita una respuesta desproporcionada si faltan
 * decenas de campos; el mensaje indica cuantos mas hay cuando se trunca. */
export const MAX_ELEMENTOS_LISTA_RESPUESTA = 20;

/** 4 KB -- el body de POST /api/consultas/ejecutar es siempre chico (un
 * catalogoId de 6 literales posibles, un cadenaId, y opcionalmente dos
 * fechas ISO): a diferencia de OTIF/Fill Rate (1 MB, filas pegadas de un
 * CSV), aca no hay ningun payload legitimo grande -- cualquier body que
 * supere esto ya es DATOS_INVALIDOS por construccion. */
export const MAX_TAMANO_BODY_CONSULTA_BYTES = 4 * 1024;

export interface ResultadoValidacionPeriodoConsulta {
  valido: boolean;
  motivo?: "PERIODO_INVALIDO" | "PERIODO_DEMASIADO_LARGO";
}

/** Pura -- valida que inicio<=fin y que el periodo no exceda
 * MAX_DIAS_PERIODO_CONSULTA. */
export function validarPeriodoConsulta(inicio: Date, fin: Date): ResultadoValidacionPeriodoConsulta {
  if (inicio.getTime() > fin.getTime()) {
    return { valido: false, motivo: "PERIODO_INVALIDO" };
  }
  const dias = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24);
  if (dias > MAX_DIAS_PERIODO_CONSULTA) {
    return { valido: false, motivo: "PERIODO_DEMASIADO_LARGO" };
  }
  return { valido: true };
}

/** Pura -- trunca una lista a MAX_ELEMENTOS_LISTA_RESPUESTA, agregando un
 * ultimo elemento informativo si se truncó (nunca silenciosamente). */
export function truncarListaRespuesta(elementos: readonly string[]): string[] {
  if (elementos.length <= MAX_ELEMENTOS_LISTA_RESPUESTA) {
    return [...elementos];
  }
  const visibles = elementos.slice(0, MAX_ELEMENTOS_LISTA_RESPUESTA);
  const restantes = elementos.length - MAX_ELEMENTOS_LISTA_RESPUESTA;
  visibles.push(`… y ${restantes} elemento(s) más (omitidos por límite de longitud)`);
  return visibles;
}
