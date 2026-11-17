// Infraestructura -- deriva, en SERVIDOR, los 2 valores que
// crearAccionDecisionKpi() necesita y que ANTES se aceptaban del body
// del POST (ruleVersionOrigen, prioridadOrigen). Correccion de ronda de
// revision (ver el reporte de entrega, "bloqueantes corregidos", punto
// 1): el bug real que esto corrige -- el cliente (AccionesDecisionKpi.tsx)
// le mostraba al usuario la prioridad/version que la PAGINA ya habia
// calculado, pero el body del POST las volvia a declarar como texto
// plano, y el servidor las guardaba tal cual venian, sin volver a
// calcularlas. Un body manipulado a mano podia declarar
// `prioridadOrigen: "ALTA"` para un origen que el analisis real no
// considera ALTA (o que ni siquiera amerita una accion), o una
// `ruleVersionOrigen` que no es la version real del origen -- la UI
// nunca mostraria esa inconsistencia (ella misma vuelve a pedir el
// historial despues de crear la accion), pero el dato persistido
// quedaria mintiendo sobre que decia el analisis real en ese momento.
//
// Esta funcion vuelve a ejecutar EXACTAMENTE el mismo analisis que ya
// corre en las paginas de detalle (generarAnalisisObservacionKpi /
// generarAnalisisImportacionCobertura, ambas en analisisDecision.ts),
// con las MISMAS consultas de historico (cargarHistoricoObservacionesKpi /
// cargarHistoricoResumenCobertura, relocadas a infra para poder
// reutilizarlas desde aca sin duplicar su logica -- ver el comentario de
// cabecera de cada una). Si el origen no existe, o si el analisis actual
// NO sugiere una accion (misma condicion que gatea el formulario de alta
// en la UI: `siguienteAccionPropuesta && recomendacion`, nunca BAJA ni
// informacion insuficiente), esta funcion rechaza la creacion -- nunca
// inventa un valor ni confia en lo que el llamador hubiera declarado.
import { generarAnalisisImportacionCobertura, generarAnalisisObservacionKpi, type PuntoObservacionKpi } from "../analisisDecision";
import { cargarHistoricoObservacionesKpi } from "../historicoObservacionKpi";
import { cargarHistoricoResumenCobertura, cargarResumenYVersionCobertura } from "../cobertura/resumenCobertura";
import type { TenantPrismaClient } from "../../prisma/tenantClient";
import type { OrigenAccionKpi, PrioridadRecomendacionAccionKpi } from "./tipos";

export type ResultadoDerivarOrigenActual =
  | {
      ok: true;
      empresaId: string;
      cadenaId: string;
      ruleVersionOrigen: string;
      prioridadOrigen: PrioridadRecomendacionAccionKpi;
    }
  | {
      ok: false;
      // OBSERVACION_KPI_INEXISTENTE / IMPORTACION_CSV_INEXISTENTE: el id
      // declarado en `origen` no existe (o no es de este tenant, via
      // tenantClient() -- ver el comentario de crearAccionDecisionKpi()
      // en servicio.ts para el mismo razonamiento de 2 capas).
      // ORIGEN_SIN_RECOMENDACION_ACCIONABLE: el origen SI existe, pero
      // el analisis actual no sugiere ninguna accion (BAJA o
      // informacion insuficiente) -- misma condicion que ya oculta el
      // formulario de alta en la UI, ahora tambien aplicada en el
      // servidor.
      error: "OBSERVACION_KPI_INEXISTENTE" | "IMPORTACION_CSV_INEXISTENTE" | "ORIGEN_SIN_RECOMENDACION_ACCIONABLE";
    };

export async function derivarOrigenActualAccionKpi(
  cliente: TenantPrismaClient,
  origen: OrigenAccionKpi,
): Promise<ResultadoDerivarOrigenActual> {
  if (origen.tipo === "OBSERVACION_KPI") {
    return derivarDesdeObservacionKpi(cliente, origen.observacionKpiId);
  }
  return derivarDesdeImportacionCsv(cliente, origen.importacionCsvId);
}

async function derivarDesdeObservacionKpi(
  cliente: TenantPrismaClient,
  observacionKpiId: string,
): Promise<ResultadoDerivarOrigenActual> {
  const observacion = await cliente.observacionKpi.findUnique({
    where: { id: observacionKpiId },
    select: {
      id: true,
      empresaId: true,
      cadenaId: true,
      definicionKpiId: true,
      periodoInicio: true,
      periodoFin: true,
      valor: true,
      numerador: true,
      denominador: true,
      ruleVersion: true,
    },
  });
  if (!observacion) {
    return { ok: false, error: "OBSERVACION_KPI_INEXISTENTE" };
  }

  const historico = await cargarHistoricoObservacionesKpi(
    cliente,
    observacion.cadenaId,
    observacion.definicionKpiId,
    observacion.periodoInicio,
  );

  const puntoActual: PuntoObservacionKpi = {
    id: observacion.id,
    periodoInicio: observacion.periodoInicio,
    periodoFin: observacion.periodoFin,
    valor: observacion.valor,
    numerador: observacion.numerador,
    denominador: observacion.denominador,
    ruleVersion: observacion.ruleVersion,
  };

  const analisis = generarAnalisisObservacionKpi(puntoActual, historico);
  if (!analisis.siguienteAccionPropuesta || !analisis.recomendacion) {
    return { ok: false, error: "ORIGEN_SIN_RECOMENDACION_ACCIONABLE" };
  }

  return {
    ok: true,
    empresaId: observacion.empresaId,
    cadenaId: observacion.cadenaId,
    ruleVersionOrigen: observacion.ruleVersion,
    prioridadOrigen: analisis.recomendacion.prioridad,
  };
}

async function derivarDesdeImportacionCsv(
  cliente: TenantPrismaClient,
  importacionCsvId: string,
): Promise<ResultadoDerivarOrigenActual> {
  const importacion = await cliente.importacionCsv.findUnique({
    where: { id: importacionCsvId },
    select: { id: true, empresaId: true, cadenaId: true, confirmadaEn: true },
  });
  if (!importacion) {
    return { ok: false, error: "IMPORTACION_CSV_INEXISTENTE" };
  }

  const { resumen, estadoVersion, ruleVersion } = await cargarResumenYVersionCobertura(cliente, importacion.id);
  const actual = {
    importId: importacion.id,
    // La derivacion de prioridad no usa periodoReferencia (ver
    // generarAnalisisImportacionCobertura() en analisisDecision.ts) --
    // solo resumen/estadoVersion/ruleVersion. Nunca se consulta
    // ImportacionCsv.periodoReferenciaConsumo* aca.
    periodoReferencia: { inicio: null, fin: null },
    resumen,
    estadoVersion,
    ruleVersion,
  };

  const historico = await cargarHistoricoResumenCobertura(cliente, importacion.cadenaId, importacion.id, importacion.confirmadaEn);

  const analisis = generarAnalisisImportacionCobertura(actual, historico);
  if (!analisis.siguienteAccionPropuesta || !analisis.recomendacion || ruleVersion === null) {
    // `ruleVersion === null` solo puede pasar con estadoVersion
    // SIN_FILAS/MEZCLADA -- ambos casos ya cortan antes por motivo
    // TOTAL_CERO/VERSION_MEZCLADA (recomendacion queda null), asi que
    // esta condicion es defensiva (nunca deberia ser la unica que
    // dispara el rechazo), no una rama nueva de negocio.
    return { ok: false, error: "ORIGEN_SIN_RECOMENDACION_ACCIONABLE" };
  }

  return {
    ok: true,
    empresaId: importacion.empresaId,
    cadenaId: importacion.cadenaId,
    ruleVersionOrigen: ruleVersion,
    prioridadOrigen: analisis.recomendacion.prioridad,
  };
}
