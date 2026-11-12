// Dominio puro (UI) -- piezas compartidas por AccionesDecisionKpi.tsx
// (el componente cliente que reemplaza, en ambas paginas de detalle, el
// aviso "el registro y seguimiento de acciones estara disponible en una
// proxima version" -- Incremento 4 PR3). Separado del componente para
// que la logica (que transiciones de estado mostrar, que mensaje mostrar
// por cada error de la API, validacion de formulario antes del fetch) se
// pueda probar con pruebas de funcion pura, sin renderizar nada a DOM --
// mismo criterio que el resto de este repo (vitest.config.ts no trae
// jsdom/Testing Library, ver el comentario de cabecera de ese archivo).
import { esEstadoTerminal, type EstadoAccionKpi, type PrioridadRecomendacionAccionKpi } from "@/infra/kpis/acciones/tipos";
import { validarTransicionEstado } from "@/infra/kpis/acciones/validacion";

export const ETIQUETA_ESTADO_ACCION: Record<EstadoAccionKpi, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
  DESCARTADA: "Descartada",
};

export const ESTILO_ESTADO_ACCION: Record<EstadoAccionKpi, string> = {
  PENDIENTE: "bg-slate-100 text-slate-600",
  EN_PROGRESO: "bg-blue-100 text-blue-700",
  COMPLETADA: "bg-emerald-100 text-emerald-700",
  DESCARTADA: "bg-slate-200 text-slate-500",
};

export const ETIQUETA_PRIORIDAD_ACCION: Record<PrioridadRecomendacionAccionKpi, string> = {
  ALTA: "Prioridad alta",
  MEDIA: "Prioridad media",
  BAJA: "Prioridad baja",
};

export const ESTILO_PRIORIDAD_ACCION: Record<PrioridadRecomendacionAccionKpi, string> = {
  ALTA: "bg-red-100 text-red-700",
  MEDIA: "bg-amber-100 text-amber-700",
  BAJA: "bg-slate-100 text-slate-600",
};

const TODOS_LOS_ESTADOS: readonly EstadoAccionKpi[] = ["PENDIENTE", "EN_PROGRESO", "COMPLETADA", "DESCARTADA"];

/** Estados a los que una accion en `estadoActual` puede pasar, para
 * poblar el selector de cambio de estado -- nunca incluye el actual
 * (cambiar al mismo valor no tiene sentido en un selector de "pasar a")
 * y nunca ninguno si ya esta en un estado terminal. Reusa
 * validarTransicionEstado() -- la MISMA regla que ya corre en el
 * servidor, nunca duplicada aca con otro criterio que pueda divergir. */
export function estadosSiguientesPosibles(estadoActual: EstadoAccionKpi): EstadoAccionKpi[] {
  if (esEstadoTerminal(estadoActual)) return [];
  return TODOS_LOS_ESTADOS.filter((estado) => estado !== estadoActual && validarTransicionEstado(estadoActual, estado).valido);
}

export interface FormularioCrearAccion {
  descripcionAccion: string;
  responsableId: string;
  // Tal como lo entrega <input type="date"> -- "yyyy-mm-dd".
  fechaObjetivo: string;
}

export type ResultadoValidacionFormulario = { ok: true } | { ok: false; error: string };

/** Validacion en el CLIENTE antes de disparar el fetch -- nunca sustituye
 * la validacion del servidor (zod en route.ts + validacion.ts), solo
 * evita un viaje de red para un error obvio de formulario vacio. */
export function validarFormularioCrearAccion(form: FormularioCrearAccion): ResultadoValidacionFormulario {
  if (form.descripcionAccion.trim().length === 0) {
    return { ok: false, error: "Describí la acción antes de guardarla." };
  }
  if (!form.responsableId) {
    return { ok: false, error: "Elegí un responsable." };
  }
  if (!form.fechaObjetivo) {
    return { ok: false, error: "Elegí una fecha objetivo." };
  }
  return { ok: true };
}

const MENSAJE_POR_ERROR: Record<string, string> = {
  DATOS_INVALIDOS: "Revisá los datos del formulario.",
  ORIGEN_INVALIDO: "No se pudo determinar el origen de la acción.",
  RESPONSABLE_INEXISTENTE: "El responsable elegido ya no existe.",
  CREADOR_INEXISTENTE: "Tu usuario ya no existe -- volvé a iniciar sesión.",
  OBSERVACION_KPI_INEXISTENTE: "La observación de origen ya no existe.",
  IMPORTACION_CSV_INEXISTENTE: "La importación de origen ya no existe.",
  // Correccion de ronda de revision (bloqueante 1): el servidor rechaza
  // la creacion si, al derivar la prioridad de nuevo, el origen ya no
  // amerita una accion (por ejemplo, el analisis cambio entre que esta
  // pagina se abrio y el formulario se envio).
  ORIGEN_SIN_RECOMENDACION_ACCIONABLE: "El análisis de este origen ya no sugiere registrar una acción -- recargá la página.",
  TENANT_INCONSISTENTE: "El responsable o el origen no pertenecen a esta empresa o cadena.",
  ACCION_INEXISTENTE: "Esta acción ya no existe -- recargá la página.",
  TRANSICION_INVALIDA: "Esta acción ya fue finalizada y no se puede modificar.",
  // Correccion de ronda de revision (bloqueante 2): distinto de
  // TRANSICION_INVALIDA -- este codigo llega cuando el PATCH intentaba
  // cambiar OTRO campo (no el estado) de una accion ya finalizada.
  ACCION_FINALIZADA_INMUTABLE: "Esta acción ya fue finalizada y es inmutable -- no se puede modificar ningún campo.",
  // Correccion de ronda de revision (bloqueante 3): otro cierre
  // concurrente ya cambio el estado de esta accion entre que se cargo
  // el historial y se confirmo el cambio.
  ACCION_MODIFICADA_CONCURRENTEMENTE: "Otra persona ya actualizó esta acción -- recargá la página e intentá de nuevo.",
  FALTA_FINALIZADA_POR: "No se pudo registrar quién finalizó la acción.",
  FINALIZACION_INCONSISTENTE: "No se pudo completar la acción. Intentá de nuevo.",
  FINALIZADOR_INEXISTENTE: "Tu usuario ya no existe -- volvé a iniciar sesión.",
  ERROR_RED: "No se pudo conectar. Revisá tu conexión e intentá de nuevo.",
  ERROR_INTERNO: "No se pudo guardar. Intentá de nuevo.",
};

/** Mensaje en castellano para cada codigo de error que la API puede
 * devolver -- cae a un mensaje generico para cualquier codigo que esta
 * funcion no reconozca (nunca deja el codigo crudo visible al usuario). */
export function mensajeParaError(error: string | undefined): string {
  return MENSAJE_POR_ERROR[error ?? ""] ?? "No se pudo guardar. Intentá de nuevo.";
}
