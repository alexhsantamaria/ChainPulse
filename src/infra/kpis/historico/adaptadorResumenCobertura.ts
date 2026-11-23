// Infraestructura (PURA -- sin Prisma) -- adapta un PuntoResumenCobertura
// (Cobertura, agregado por importación) al contrato normalizado
// PuntoHistoricoKpi. Segundo corte de PR-A, ver
// diseno-pr-a-segundo-corte-contrato-historico-2026-11-23.md.
//
// NO reemplaza generarAnalisisImportacionCobertura() -- misma razón que
// adaptadorObservacionKpi.ts: esto es RESHAPING de tipo para lectura
// genérica, nunca la fuente de la recomendación real.
//
// `valor` del contrato normalizado es la TASA VÁLIDA (fracción 0..1 de
// filas con resultado numérico sobre el total), no un conteo ni un
// "promedio de días" -- es la ÚNICA magnitud de Cobertura comparable en
// una escala 0..1 común con OTIF/Fill Rate; el resto de
// ResumenFilasCobertura (conteos por categoría) sigue disponible solo a
// través del tipo específico de Cobertura, nunca forzado dentro de este
// contrato genérico. Fórmula canónica (tasaValidaDeResumen) reutilizada
// de estadoVisualizacion.ts -- la misma que ya usa
// generarAnalisisImportacionCobertura(), nunca duplicada.
//
// Invariante de EstadoDatoNormalizado (corregido 2026-11-23, segundo
// corte de PR-A, ronda de revisión): CERO_REAL y VALOR son los unicos 2
// estados que llevan un `valor` numerico -- SIN_DATOS y CON_ERRORES
// siempre llevan `valor: null`; CERO_REAL lleva `valor: 0` exacto y
// VALOR lleva un numero distinto de cero (nunca `VALOR` con `valor: 0`
// ni con `valor: null`). Una tasa valida exactamente en 0 (0% de filas
// validas sobre un total positivo) sigue siendo un dato REAL medido, no
// una ausencia -- misma semantica que ObservacionKpi.valor===0 (ver
// clasificarValorObservacionKpi() en estadoVisualizacion.ts, que ya
// aplica este mismo criterio) -- por eso se clasifica CERO_REAL, no
// VALOR; cualquier tasa > 0 es VALOR.
//
// Caso defensivo (ronda de revisión, 2026-11-23): estadoVersion "UNICA"
// con resumen.total === 0 es una combinación que el contrato de origen
// declara imposible -- derivarEstadoVersionCobertura() en
// cobertura/resumenCobertura.ts solo produce "UNICA" cuando total > 0.
// Si llega igual (un PuntoResumenCobertura construido a mano, o un bug
// futuro en el origen), tasaValidaDeResumen() devolvería null y este
// adaptador NUNCA debe silenciarlo produciendo `{ estado: "VALOR",
// valor: null }` (rompería el invariante de arriba sin que nadie se
// entere) -- se lanza un error descriptivo en su lugar, para que la
// violación del contrato de origen se note donde ocurre.
import { tasaValidaDeResumen } from "../estadoVisualizacion";
import type { PuntoResumenCobertura } from "../analisisDecision";
import type { EstadoDatoNormalizado, PuntoHistoricoKpi } from "./contrato";

export function adaptarPuntoResumenCobertura(punto: PuntoResumenCobertura): PuntoHistoricoKpi {
  if (punto.estadoVersion === "UNICA" && punto.resumen.total === 0) {
    throw new Error(
      `adaptarPuntoResumenCobertura: PuntoResumenCobertura con estadoVersion "UNICA" y resumen.total === 0 ` +
        `(importId=${punto.importId}) viola el invariante de origen -- derivarEstadoVersionCobertura() en ` +
        `cobertura/resumenCobertura.ts garantiza que "UNICA" implica total > 0. No se silencia produciendo un ` +
        `punto inconsistente: revisar la construcción de este PuntoResumenCobertura.`,
    );
  }

  // SIN_FILAS -> no hay ninguna fila; nunca se disfraza de "0% válido"
  // (mismo criterio ya establecido en tasaValidaDeResumen()/
  // generarAnalisisImportacionCobertura() para total===0). `valor: null`.
  // MEZCLADA -> la importación mezcla 2+ ruleVersion; ninguna tasa
  // propia es confiable para comparar -- se marca CON_ERRORES (datos
  // presentes, pero no utilizables para esta lectura) en vez de
  // SIN_DATOS (que significaría "no hay nada"). `valor: null`.
  // UNICA -> ya descartado el caso total===0 arriba, la tasa válida
  // SIEMPRE es un número real aquí. Si esa tasa es exactamente 0
  // (ninguna fila válida sobre un total positivo) -> CERO_REAL, `valor: 0`
  // (ver invariante de EstadoDatoNormalizado arriba). Cualquier tasa > 0
  // -> VALOR.
  const tasaValidaUnica = punto.estadoVersion === "UNICA" ? tasaValidaDeResumen(punto.resumen) : null;
  const estado: EstadoDatoNormalizado =
    punto.estadoVersion === "SIN_FILAS"
      ? "SIN_DATOS"
      : punto.estadoVersion === "MEZCLADA"
        ? "CON_ERRORES"
        : tasaValidaUnica === 0
          ? "CERO_REAL"
          : "VALOR";
  // SIN_DATOS/CON_ERRORES siempre null; CERO_REAL/VALOR llevan la tasa
  // real (invariante de EstadoDatoNormalizado, ver comentario de arriba).
  const valor = estado === "SIN_DATOS" || estado === "CON_ERRORES" ? null : tasaValidaUnica;

  return {
    id: punto.importId,
    periodoInicio: punto.periodoReferencia.inicio,
    periodoFin: punto.periodoReferencia.fin,
    valor,
    estado,
    fuente: "COBERTURA",
    ruleVersion: punto.ruleVersion,
  };
}
