// Infraestructura -- logging saneado y de vocabulario CERRADO para la
// LATENCIA TOTAL de POST /api/consultas/ejecutar, de punta a punta
// (Incremento 5 PR4, a pedido explicito de Alex, 2026-11-19). Mismo
// criterio de dos niveles de proteccion que eventoPresupuestoComputo.ts
// (PR2) / eventoConsultaRateLimit.ts (PR1):
//   1. ESTRUCTURAL (tipos): cadenaId, empresaId, usuarioId y la huella
//      (cruda o hasheada) NUNCA tienen un parametro posible en la firma
//      de abajo -- no existe ningun argumento por el que colarlos.
//   2. TIPO CERRADO + GUARDIA EN RUNTIME (catalogoId): tipado
//      CatalogoConsultaId (nunca `string`), y ademas validado en runtime
//      con esCatalogoConsultaId() antes de loguearse -- si por algun
//      motivo llega un valor que no es uno de los 6 literales reales,
//      se omite del log en silencio en vez de persistirlo.
//
// Diferencia deliberada con PRESUPUESTO_COMPUTO_MS
// (presupuestoComputo.ts): ese mecanismo mide UNICAMENTE el computo
// sincronico de un motor puro, DESPUES de que sus datos ya estan en
// memoria -- nunca el IO. Este evento mide la peticion COMPLETA (desde
// la primera linea del handler de la ruta hasta la respuesta
// construida): autenticacion, lectura/validacion del body, el
// round-trip de rate limiting, el/los round-trip(s) de Prisma del
// ejecutor despachado, el computo (ya acotado por su propio
// presupuesto, sin cambios aqui) y el INSERT de auditoria
// (registrarConsulta.ts). Es la unica senal hoy de si una peticion real
// se acerca al objetivo "<5 segundos" de punta a punta -- ver el diseno
// de PR4 (chainpulse/diseno-pr4-cierre-incremento5-auditoria-rendimiento-2026-11-19.md,
// Seccion 3: "el objetivo <5 segundos nunca se mide de punta a punta").
// Los dos mecanismos coexisten sin reemplazarse: PRESUPUESTO_COMPUTO_MS
// sigue siendo el UNICO que descarta un resultado y devuelve
// PRESUPUESTO_COMPUTO_EXCEDIDO -- este evento NUNCA descarta ni altera
// la respuesta real, solo la observa desde afuera y la reporta.
//
// statusHttp es un entero HTTP estandar (200/4xx/5xx) -- nunca un dato
// de tenant/usuario, se incluye sin guardia adicional.
import { esCatalogoConsultaId } from "@/infra/queries/catalogo";
import type { CatalogoConsultaId } from "@/domain/queries/tipos";

export type CodigoEventoLatenciaConsulta = "CONSULTA_LATENCIA_TOTAL";

/** Campos permitidos -- lista cerrada y chica a proposito (ninguno de
 * estos es sensible ni identifica al usuario/empresa/origen/cadena). */
export interface DetalleEventoLatenciaConsulta {
  duracionMs?: number;
  statusHttp?: number;
  catalogoId?: CatalogoConsultaId;
}

/**
 * Unica forma permitida de loguear la latencia total de
 * /api/consultas/ejecutar. Nunca lanza -- la funcion ENTERA (armado de
 * `linea`, la guardia de catalogo, JSON.stringify Y la llamada a
 * console.info) vive dentro de un unico try/catch mas abajo: un fallo
 * de logging, sea en la construccion de la linea o en emitirla, nunca
 * debe tumbar la ruta HTTP que lo llama -- mismo criterio que
 * eventoPresupuestoComputo.ts.
 *
 * Severidad fija "info": a diferencia de un presupuesto de computo
 * excedido (que ya es, por definicion, una anomalia -- "error"), que
 * una peticion completa haya tardado X milisegundos es una medicion de
 * rutina, nunca en si misma una falla -- decidir si X es "demasiado"
 * (acercarse al objetivo de 5 segundos) es trabajo de un panel de
 * monitoreo o de un umbral de alerta configurado aparte sobre este
 * mismo campo duracionMs, no de esta funcion.
 */
export function registrarEventoLatenciaConsulta(
  codigo: CodigoEventoLatenciaConsulta,
  detalle: DetalleEventoLatenciaConsulta = {},
): void {
  try {
    const linea: Record<string, unknown> = { nivel: "info", codigo, timestamp: new Date().toISOString() };
    if (detalle.duracionMs !== undefined) linea.duracionMs = detalle.duracionMs;
    if (detalle.statusHttp !== undefined) linea.statusHttp = detalle.statusHttp;
    // Guardia en runtime (ver comentario de cabecera, punto 2).
    if (detalle.catalogoId !== undefined && esCatalogoConsultaId(detalle.catalogoId)) {
      linea.catalogoId = detalle.catalogoId;
    }

    console.info(JSON.stringify(linea));
  } catch {
    // Nunca lanza (ver docstring de arriba) -- cualquier fallo dentro de
    // este bloque se descarta en silencio en vez de propagarse.
  }
}
