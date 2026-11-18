// Infraestructura -- logging saneado y de vocabulario CERRADO para el
// camino de presupuesto de computo de POST /api/consultas/ejecutar
// (Incremento 5 PR2, a pedido explicito de Alex, 2026-11-18). Mismo
// criterio de dos niveles de proteccion que
// src/infra/rateLimit/eventoConsultaRateLimit.ts (PR1):
//   1. ESTRUCTURAL (tipos): cadenaId, empresaId, usuarioId y la huella
//      (cruda o hasheada) NUNCA tienen un parametro posible en la firma
//      de abajo -- no existe ningun argumento por el que colarlos.
//   2. TIPO CERRADO + GUARDIA EN RUNTIME (catalogoId): tipado
//      CatalogoConsultaId (nunca `string`), y ademas validado en runtime
//      con esCatalogoConsultaId() antes de loguearse -- si por algun
//      motivo llega un valor que no es uno de los 6 literales reales,
//      se omite del log en silencio en vez de persistirlo.
import { esCatalogoConsultaId } from "@/infra/queries/catalogo";
import type { CatalogoConsultaId } from "@/domain/queries/tipos";

export type CodigoEventoPresupuestoComputo = "CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO";

const SEVERIDAD_POR_CODIGO: Record<CodigoEventoPresupuestoComputo, "info" | "warn" | "error"> = {
  // "error", no "warn": a diferencia de un rate-limit rechazado
  // (comportamiento normal de ritmo de uso), un presupuesto de computo
  // excedido significa que un calculo tardo mas de lo esperado y su
  // resultado se descarto -- merece la severidad mas alta para que se
  // note en el agregador de logs, sin asumir con que frecuencia puede
  // llegar a ocurrir en produccion.
  CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO: "error",
};

/** Campos permitidos -- lista cerrada y chica a proposito (ninguno de
 * estos es sensible ni identifica al usuario/empresa/origen/cadena). */
export interface DetalleEventoPresupuestoComputo {
  catalogoId?: CatalogoConsultaId;
  duracionMs?: number;
  presupuestoMs?: number;
}

/**
 * Unica forma permitida de loguear el camino de presupuesto de computo
 * de /api/consultas/ejecutar. Nunca lanza -- la funcion ENTERA (armado
 * de `linea`, la guardia de catalogo, JSON.stringify Y la llamada a
 * console.error/warn/info) vive dentro de un unico try/catch mas abajo:
 * un fallo de logging, sea en la construccion de la linea o en
 * emitirla, nunca debe tumbar la ruta HTTP que lo llama.
 */
export function registrarEventoPresupuestoComputo(
  codigo: CodigoEventoPresupuestoComputo,
  detalle: DetalleEventoPresupuestoComputo = {},
): void {
  // TODA la operacion vive dentro de este try/catch -- no solo la
  // llamada final a console.*. new Date().toISOString(), la
  // construccion de `linea`, la guardia de catalogo y
  // JSON.stringify(linea) tambien pueden lanzar (ej. JSON.stringify
  // falla ante una referencia circular o un BigInt) -- "nunca lanza"
  // cubre la funcion ENTERA, no solo su ultimo paso.
  try {
    const nivel = SEVERIDAD_POR_CODIGO[codigo];
    const linea: Record<string, unknown> = { nivel, codigo, timestamp: new Date().toISOString() };
    if (detalle.duracionMs !== undefined) linea.duracionMs = detalle.duracionMs;
    if (detalle.presupuestoMs !== undefined) linea.presupuestoMs = detalle.presupuestoMs;
    // Guardia en runtime (ver comentario de cabecera, punto 2).
    if (detalle.catalogoId !== undefined && esCatalogoConsultaId(detalle.catalogoId)) {
      linea.catalogoId = detalle.catalogoId;
    }

    const texto = JSON.stringify(linea);
    if (nivel === "error") console.error(texto);
    else if (nivel === "warn") console.warn(texto);
    else console.info(texto);
  } catch {
    // Nunca lanza (ver docstring de arriba) -- cualquier fallo dentro de
    // este bloque (construccion de la linea, JSON.stringify, o el
    // propio console.error/warn/info) se descarta en silencio en vez
    // de propagarse.
  }
}
