// Infraestructura de cliente — guarda el progreso de una evaluacion
// expres en sessionStorage del navegador (UX de "guardado automatico" del
// cuestionario, V2 Sec. 7.3). No existe un endpoint publico para releer
// las preguntas de una evaluacion ya creada (el contrato de los 5
// endpoints publicos solo las devuelve una vez, al crearla -- ver
// src/app/api/public/evaluations/route.ts), asi que esta es la unica
// copia del lado del cliente: vive solo en esta pestaña/navegador, nunca
// se envia a ningun sitio. Recibe un "almacen" inyectable para poder
// probarse sin depender de window.sessionStorage real (ver __tests__).
import type { PreguntaPublica } from "./tipos";

export interface RespuestaLocal {
  opcionValor?: string;
  contextoLibre?: string;
}

export interface ProgresoEvaluacion {
  preguntas: PreguntaPublica[];
  respuestas: Record<string, RespuestaLocal>;
}

interface AlmacenSimilar {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

function clave(evaluacionId: string): string {
  return `chainpulse:evaluacion-expres:${evaluacionId}`;
}

function obtenerAlmacen(almacen?: AlmacenSimilar): AlmacenSimilar | null {
  if (almacen) return almacen;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function guardarProgreso(evaluacionId: string, progreso: ProgresoEvaluacion, almacen?: AlmacenSimilar): void {
  const destino = obtenerAlmacen(almacen);
  if (!destino) return;
  try {
    destino.setItem(clave(evaluacionId), JSON.stringify(progreso));
  } catch {
    // Almacenamiento no disponible (modo privado, cuota excedida, etc.) --
    // no es critico, cada respuesta ya quedo persistida en el servidor.
  }
}

export function leerProgreso(evaluacionId: string, almacen?: AlmacenSimilar): ProgresoEvaluacion | null {
  const origen = obtenerAlmacen(almacen);
  if (!origen) return null;
  try {
    const crudo = origen.getItem(clave(evaluacionId));
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as ProgresoEvaluacion;
    if (!Array.isArray(datos.preguntas) || typeof datos.respuestas !== "object") return null;
    return datos;
  } catch {
    return null;
  }
}

export function guardarRespuestaLocal(
  evaluacionId: string,
  codigoPregunta: string,
  respuesta: RespuestaLocal,
  almacen?: AlmacenSimilar,
): void {
  const progreso = leerProgreso(evaluacionId, almacen);
  if (!progreso) return;
  progreso.respuestas[codigoPregunta] = respuesta;
  guardarProgreso(evaluacionId, progreso, almacen);
}

export function limpiarProgreso(evaluacionId: string, almacen?: AlmacenSimilar): void {
  const destino = obtenerAlmacen(almacen);
  if (!destino) return;
  try {
    destino.removeItem(clave(evaluacionId));
  } catch {
    // No critico -- ver guardarProgreso.
  }
}
