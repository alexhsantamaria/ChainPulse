// Infraestructura (dominio puro, sin Prisma) -- las 3 validaciones de
// aplicacion que el diseno de AccionDecisionKpi exige correr SIEMPRE
// antes de persistir (ver el comentario de cabecera del modelo en
// prisma/schema.prisma): origen unico, consistencia estado/finalizacion,
// y consistencia de tenant entre la accion y cada referencia cruzada.
// Pruebas puras, sin mock de Prisma -- mismo patron que
// src/infra/kpis/analisisDecision.ts y src/infra/prisma/tenantScope.ts.
import { esEstadoTerminal, type EstadoAccionKpi, type RefConEmpresa, type RefConEmpresaYCadena, type ResultadoValidacion } from "./tipos";

function ok(): ResultadoValidacion {
  return { valido: true, errores: [] };
}

function fallo(...errores: string[]): ResultadoValidacion {
  return { valido: false, errores };
}

/** Exactamente UN origen -- nunca ambos, nunca ninguno. Espejo exacto,
 * en la capa de aplicacion, del CHECK "chk_accion_decision_kpi_un_origen"
 * de la migracion (defensa en profundidad: Prisma no puede expresar un
 * XOR multi-columna en schema.prisma, asi que esta funcion es la PRIMERA
 * linea de defensa real -- el CHECK de base es la segunda, nunca la
 * unica). */
export function validarOrigenUnico(
  observacionKpiId: string | null | undefined,
  importacionCsvId: string | null | undefined,
): ResultadoValidacion {
  const presentes = [observacionKpiId, importacionCsvId].filter((v) => v !== null && v !== undefined && v !== "").length;
  if (presentes !== 1) {
    return fallo("Debe declararse exactamente un origen (observacionKpiId o importacionCsvId), nunca ambos ni ninguno.");
  }
  return ok();
}

/** Espejo exacto, en la capa de aplicacion, del CHECK
 * "chk_accion_decision_kpi_finalizacion_consistente": un estado terminal
 * (COMPLETADA/DESCARTADA) exige finalizadaEn y finalizadaPorId AMBOS
 * presentes; cualquier otro estado los exige AMBOS ausentes. Nunca uno
 * sin el otro. */
export function validarFinalizacionConsistente(
  estado: EstadoAccionKpi,
  finalizadaEn: Date | null,
  finalizadaPorId: string | null,
): ResultadoValidacion {
  const terminal = esEstadoTerminal(estado);
  const ambosPresentes = finalizadaEn !== null && finalizadaPorId !== null;
  const ambosAusentes = finalizadaEn === null && finalizadaPorId === null;

  if (terminal && !ambosPresentes) {
    return fallo("Un estado terminal (COMPLETADA/DESCARTADA) exige finalizadaEn y finalizadaPorId, ambos presentes.");
  }
  if (!terminal && !ambosAusentes) {
    return fallo("Un estado no terminal (PENDIENTE/EN_PROGRESO) no puede tener finalizadaEn ni finalizadaPorId.");
  }
  return ok();
}

/** Ninguna FK por si sola impide un responsable/creador/finalizador/
 * origen de OTRO tenant (Usuario.id, ObservacionKpi.id e
 * ImportacionCsv.id son unicos globales, no compuestos con empresaId) --
 * ver el comentario de la propuesta original (chainpulse/
 * pr2-incremento4-ronda3-correcciones-2026-11-09.md, seccion "Tenant").
 * Esta funcion es la capa 2 (la capa 1, tenantClient()/RLS, ya filtra
 * CUALQUIER lectura por empresaId -- ver servicio.ts para por que el eje
 * empresaId de abajo es defensa en profundidad, pero el eje cadenaId es
 * la UNICA capa que lo protege: tenantClient() no filtra por cadena). */
export function validarTenantConsistente(params: {
  accion: { empresaId: string; cadenaId: string };
  responsable: RefConEmpresa;
  creadaPor: RefConEmpresa;
  finalizadaPor?: RefConEmpresa | null;
  origen: RefConEmpresaYCadena;
}): ResultadoValidacion {
  const errores: string[] = [];

  if (params.responsable.empresaId !== params.accion.empresaId) {
    errores.push("El responsable debe pertenecer a la misma empresa que la accion.");
  }
  if (params.creadaPor.empresaId !== params.accion.empresaId) {
    errores.push("Quien crea la accion debe pertenecer a la misma empresa que la accion.");
  }
  if (params.finalizadaPor && params.finalizadaPor.empresaId !== params.accion.empresaId) {
    errores.push("Quien finaliza la accion debe pertenecer a la misma empresa que la accion.");
  }
  if (params.origen.empresaId !== params.accion.empresaId) {
    errores.push("El origen (observacion o importacion) debe pertenecer a la misma empresa que la accion.");
  }
  if (params.origen.cadenaId !== params.accion.cadenaId) {
    errores.push("El origen (observacion o importacion) debe pertenecer a la misma cadena que la accion.");
  }

  return errores.length === 0 ? ok() : fallo(...errores);
}

/** Una vez finalizada (COMPLETADA/DESCARTADA), una accion no vuelve a
 * ningun otro estado -- ni siquiera a otro estado terminal distinto.
 * Decision de diseno explicita para este PR (flaggeada en el reporte de
 * entrega como "decision pendiente de revision"): si una accion se cerro
 * por error, la correccion es crear una accion NUEVA, nunca reabrir la
 * vieja -- mismo criterio que ya usa ImportacionCsv ("hace falta una
 * importacion nueva" para reintentar con otros valores, ver el
 * comentario de [id]/confirmar/route.ts). Cualquier transicion entre
 * PENDIENTE/EN_PROGRESO (en cualquier direccion, incluida PENDIENTE
 * directo a COMPLETADA/DESCARTADA sin pasar por EN_PROGRESO) esta
 * permitida. */
export function validarTransicionEstado(estadoActual: EstadoAccionKpi, estadoNuevo: EstadoAccionKpi): ResultadoValidacion {
  if (estadoActual === estadoNuevo) return ok();
  if (esEstadoTerminal(estadoActual)) {
    return fallo(`No se puede cambiar el estado de una accion ya finalizada (estado actual: ${estadoActual}).`);
  }
  return ok();
}

/** Correccion de ronda de revision (ver el reporte de entrega,
 * "bloqueantes corregidos", punto 2): el bug real que esto corrige --
 * `validarTransicionEstado()` de arriba SOLO compara estadoActual
 * contra estadoNuevo, y devuelve ok() de inmediato si son iguales
 * (`estadoActual === estadoNuevo`). Eso significa que un PATCH que NO
 * declara `estado` (por lo tanto `estadoNuevo` se calcula como
 * `cambios.estado ?? actual.estado`, es decir el mismo valor) pero SI
 * cambia `responsableId`/`fechaObjetivo`/`descripcionAccion` pasaba esa
 * validacion sin que nada la rechazara, aunque la accion ya estuviera
 * COMPLETADA/DESCARTADA -- una accion finalizada no era en realidad
 * inmutable, solo "no se le podia cambiar el estado a otro distinto".
 * Esta funcion es independiente de `estadoNuevo`: una accion en un
 * estado terminal rechaza CUALQUIER actualizacion, sin excepcion,
 * sin importar que campos declare el PATCH. `actualizarAccionDecisionKpi()`
 * la corre PRIMERO, antes de mirar ningun otro campo del body. */
export function validarAccionModificable(estadoActual: EstadoAccionKpi): ResultadoValidacion {
  if (esEstadoTerminal(estadoActual)) {
    return fallo(
      `Una acción finalizada (estado actual: ${estadoActual}) es inmutable: no admite ningún cambio, ni de estado ni de ningún otro campo.`,
    );
  }
  return ok();
}
