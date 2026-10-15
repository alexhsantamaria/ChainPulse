// Infraestructura -- orquestador central de Incremento 5 (I5-09 + I5-10 +
// I5-11 + I5-13): dado un EntradaConsultaPermitida ya tipado y una
// sesion valida, valida tenant/periodo, despacha EXHAUSTIVAMENTE (switch
// sobre CatalogoConsultaId, I5-11) al ejecutor correspondiente, y
// registra la auditoria (I5-13) antes de devolver la respuesta.
//
// Mismo patron que confirmarObservacionOtif() (persistir.ts): construye
// tenantClient(empresaId) UNA vez aca, nunca en los ejecutores
// individuales -- cadenaId se resuelve DENTRO de ese cliente con scope de
// tenant (I5-10/I5-28: una cadena de otra empresa nunca puede dar
// CADENA_INEXISTENTE distinto de "no existe para este tenant").
import { tenantClient } from "@/infra/prisma/tenantClient";
import type { CatalogoConsultaId, EntradaConsultaPermitida, RespuestaConsulta } from "@/domain/queries/tipos";
import { nuncaOcurre } from "@/domain/queries/tipos";
import { esCatalogoConsultaId, obtenerMetadatosCatalogo } from "./catalogo";
import { validarPeriodoConsulta } from "@/domain/limitesConsultas";
import { registrarConsulta } from "./registrarConsulta";
import { cargarYEjecutarOtifCaida } from "./ejecutores/otifCaida";
import { cargarYEjecutarOtifProveedorRetrasos } from "./ejecutores/otifProveedorRetrasos";
import { cargarYEjecutarDependenciaCritica } from "./ejecutores/dependenciaCritica";
import { cargarYEjecutarFaltantesFillRate } from "./ejecutores/faltantesFillRate";
import { cargarYEjecutarAccionPrioritaria } from "./ejecutores/accionPrioritaria";
import { cargarYEjecutarCambiosUltimoPulso } from "./ejecutores/cambiosUltimoPulso";

export interface ContextoEjecucionConsulta {
  empresaId: string;
  usuarioId: string;
  rol: "ADMINISTRADOR" | "RESPONSABLE";
}

export type ResultadoEjecutarConsulta =
  | RespuestaConsulta
  | { ok: false; error: "CATALOGO_ID_INVALIDO" }
  | { ok: false; error: "CADENA_INEXISTENTE" }
  | { ok: false; error: "PERMISO_DENEGADO" }
  | { ok: false; error: "PERIODO_REQUERIDO" }
  | { ok: false; error: "PERIODO_INVALIDO" }
  | { ok: false; error: "PERIODO_DEMASIADO_LARGO" };

function periodoCrudoAFecha(valor: string): Date | null {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha;
}

export interface EntradaCrudaEjecutarConsulta {
  catalogoId: string;
  cadenaId: string;
  periodoInicio?: string | null;
  periodoFin?: string | null;
}

/**
 * I5-09 -- construye una EntradaConsultaPermitida validada a partir del
 * payload crudo de red (unknown ya proyectado por la ruta API). Nunca
 * acepta un catalogoId que no sea uno de los 6 literales exactos (I5-08:
 * "no permitir que el cliente envíe nombre de tabla, columna, SQL,
 * función interna, tenant o empresa").
 */
export function construirConsultaPermitida(
  cruda: EntradaCrudaEjecutarConsulta,
): { ok: true; entrada: EntradaConsultaPermitida | { catalogoId: CatalogoConsultaId; cadenaId: string; periodo: null } } | { ok: false; error: "CATALOGO_ID_INVALIDO" | "PERIODO_REQUERIDO" | "PERIODO_INVALIDO" | "PERIODO_DEMASIADO_LARGO" } {
  if (!esCatalogoConsultaId(cruda.catalogoId)) {
    return { ok: false, error: "CATALOGO_ID_INVALIDO" };
  }
  const metadatos = obtenerMetadatosCatalogo(cruda.catalogoId);
  if (!metadatos) {
    return { ok: false, error: "CATALOGO_ID_INVALIDO" };
  }

  if (!metadatos.requierePeriodo) {
    return { ok: true, entrada: { catalogoId: metadatos.id, cadenaId: cruda.cadenaId, periodo: null } };
  }

  if (!cruda.periodoInicio || !cruda.periodoFin) {
    return { ok: false, error: "PERIODO_REQUERIDO" };
  }
  const inicio = periodoCrudoAFecha(cruda.periodoInicio);
  const fin = periodoCrudoAFecha(cruda.periodoFin);
  if (!inicio || !fin) {
    return { ok: false, error: "PERIODO_INVALIDO" };
  }
  const validacion = validarPeriodoConsulta(inicio, fin);
  if (!validacion.valido) {
    return { ok: false, error: validacion.motivo === "PERIODO_DEMASIADO_LARGO" ? "PERIODO_DEMASIADO_LARGO" : "PERIODO_INVALIDO" };
  }

  return { ok: true, entrada: { catalogoId: metadatos.id, cadenaId: cruda.cadenaId, periodo: { inicio, fin } } };
}

/**
 * I5-10/I5-11/I5-13 -- punto de entrada unico de ejecucion. `entrada.periodo`
 * es `null` para las preguntas que no requieren periodo (ver catalogo.ts).
 */
export async function ejecutarConsultaPermitida(
  entrada: { catalogoId: CatalogoConsultaId; cadenaId: string; periodo: { inicio: Date; fin: Date } | null },
  contexto: ContextoEjecucionConsulta,
): Promise<ResultadoEjecutarConsulta> {
  const metadatos = obtenerMetadatosCatalogo(entrada.catalogoId);
  if (!metadatos) {
    return { ok: false, error: "CATALOGO_ID_INVALIDO" };
  }
  // I5-10 -- control de permisos antes de ejecutar.
  if (!metadatos.permisos.includes(contexto.rol)) {
    return { ok: false, error: "PERMISO_DENEGADO" };
  }

  const cliente = tenantClient(contexto.empresaId);

  // I5-10/I5-28 -- cadenaId se resuelve DENTRO del tenantClient: una
  // cadena de otra empresa jamas es visible aca, mismo patron que
  // confirmarObservacionOtif().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const cadena = await (cliente as any).cadena.findUnique({ where: { id: entrada.cadenaId } });
  if (!cadena) {
    return { ok: false, error: "CADENA_INEXISTENTE" };
  }

  // I5-11 -- dispatcher EXHAUSTIVO: switch sobre la union discriminada de
  // 6 literales, sin `default`. nuncaOcurre() fuerza un error de
  // compilacion si se agrega un 7mo CatalogoConsultaId sin su rama aca.
  let respuesta: RespuestaConsulta;
  switch (entrada.catalogoId) {
    case "OTIF_CAIDA": {
      if (!entrada.periodo) return { ok: false, error: "PERIODO_REQUERIDO" };
      respuesta = await cargarYEjecutarOtifCaida(cliente, entrada.cadenaId, entrada.periodo);
      break;
    }
    case "OTIF_PROVEEDOR_RETRASOS": {
      if (!entrada.periodo) return { ok: false, error: "PERIODO_REQUERIDO" };
      respuesta = await cargarYEjecutarOtifProveedorRetrasos(cliente, entrada.cadenaId, entrada.periodo);
      break;
    }
    case "DEPENDENCIA_CRITICA": {
      respuesta = await cargarYEjecutarDependenciaCritica(cliente, entrada.cadenaId);
      break;
    }
    case "FALTANTES_FILL_RATE": {
      if (!entrada.periodo) return { ok: false, error: "PERIODO_REQUERIDO" };
      respuesta = await cargarYEjecutarFaltantesFillRate(cliente, entrada.cadenaId, entrada.periodo);
      break;
    }
    case "ACCION_PRIORITARIA": {
      respuesta = await cargarYEjecutarAccionPrioritaria(cliente, entrada.cadenaId);
      break;
    }
    case "CAMBIOS_ULTIMO_PULSO": {
      // "El corte" (ver engine/queries/cambiosUltimoPulso.ts): usa
      // periodo.inicio si vino, o "ahora" como corte si esta pregunta se
      // invoca sin periodo -- CAMBIOS_ULTIMO_PULSO.requierePeriodo=true
      // en catalogo.ts, asi que en la practica siempre viene.
      if (!entrada.periodo) return { ok: false, error: "PERIODO_REQUERIDO" };
      respuesta = await cargarYEjecutarCambiosUltimoPulso(cliente, entrada.cadenaId, entrada.periodo.inicio);
      break;
    }
    default:
      return nuncaOcurre(entrada.catalogoId, "ejecutarConsultaPermitida");
  }

  // I5-13 -- registro auditable, siempre (tanto si hubo datos como si no
  // -- un intento de consulta sin datos suficientes tambien es auditable).
  await registrarConsulta(cliente, {
    empresaId: contexto.empresaId,
    usuarioId: contexto.usuarioId,
    cadenaId: entrada.cadenaId,
    catalogoId: entrada.catalogoId,
    periodo: entrada.periodo,
  }, respuesta);

  return respuesta;
}
