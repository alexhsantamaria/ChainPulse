// Infraestructura — logging saneado y de vocabulario CERRADO para el
// camino de limite de tasa de POST /api/consultas/ejecutar (Incremento
// 5 PR1, a pedido explicito de Alex, 2026-11-17, ajustado en la ronda 2
// de revision del 2026-11-18: "catalogoId debe ser CatalogoConsultaId,
// no string -- no afirmar que es estructuralmente imposible filtrar
// datos si la firma todavia acepta strings abiertos").
//
// logError() (src/infra/log.ts) y Sentry.captureException() (usado en
// api/public/evaluations/route.ts:106, entre otros) persisten
// err.message/err.stack tal cual -- un criterio razonable para errores
// generales, pero deliberadamente INSUFICIENTE para este camino: un
// error real de Postgres aca puede incluir fragmentos del propio SQL, o
// (segun el driver/version) del connection string, en su propio
// mensaje, y este es el camino de rate-limit de autenticacion, no un
// lugar donde asumir que un string de error es seguro de persistir sin
// mirarlo.
//
// Dos niveles de proteccion, nunca uno solo:
//   1. ESTRUCTURAL (tipos): el objeto Error crudo (err.message/err.stack),
//      el body de la request, cadenaId, empresaId, usuarioId y la
//      huella (cruda o hasheada) NUNCA tienen un parametro posible en
//      la firma de abajo -- a esos sí corresponde decir que es
//      estructuralmente imposible pasarlos, porque no existe ningun
//      argumento por el que colarlos.
//   2. TIPO CERRADO + GUARDIA EN RUNTIME (catalogoId): a diferencia de
//      los anteriores, catalogoId SI es un dato legitimo de este log
//      (identifica la pregunta del catalogo cerrado, nunca un dato de
//      tenant/usuario) -- por eso tiene un parametro, tipado
//      CatalogoConsultaId (la union cerrada de 6 literales, nunca
//      `string`: pasar cadenaId, empresaId u otro string generico ya
//      falla en tiempo de compilacion). Como un `as` o un futuro
//      refactor TODAVIA podrian forzar un valor que no sea uno de los
//      6 literales reales, esta funcion ADEMAS valida en runtime con
//      esCatalogoConsultaId() (mismo guard que usa el dispatcher real,
//      catalogo.ts) y descarta en silencio cualquier valor que no
//      pase esa validacion -- nunca lanza, nunca lo loguea igual.
//
// La perdida de detalle de depuracion del error real de infraestructura
// (nunca hay stack trace en el camino 503) es una contrapartida
// DELIBERADA y aceptada a cambio de la garantia de saneamiento -- ver
// la entrega de este PR para la justificacion completa.
import { esCatalogoConsultaId } from "@/infra/queries/catalogo";
import type { CatalogoConsultaId } from "@/domain/queries/tipos";

export type CodigoEventoRateLimitConsulta =
  | "CONSULTA_RATE_LIMIT_PERMITIDA"
  | "CONSULTA_RATE_LIMIT_RECHAZADA"
  | "CONSULTA_RATE_LIMIT_INFRAESTRUCTURA";

const SEVERIDAD_POR_CODIGO: Record<CodigoEventoRateLimitConsulta, "info" | "warn" | "error"> = {
  CONSULTA_RATE_LIMIT_PERMITIDA: "info",
  CONSULTA_RATE_LIMIT_RECHAZADA: "warn",
  CONSULTA_RATE_LIMIT_INFRAESTRUCTURA: "error",
};

/** Campos permitidos -- lista cerrada y chica a proposito (ninguno de
 * estos es sensible ni identifica al usuario/empresa/origen). */
export interface DetalleEventoRateLimitConsulta {
  contador?: number;
  duracionMs?: number;
  catalogoId?: CatalogoConsultaId;
}

/**
 * Unica forma permitida de loguear el camino de rate-limit de
 * /api/consultas/ejecutar. Nunca lanza (un fallo de logging nunca debe
 * tumbar la ruta que lo llama).
 */
export function registrarEventoRateLimitConsulta(
  codigo: CodigoEventoRateLimitConsulta,
  detalle: DetalleEventoRateLimitConsulta = {},
): void {
  const nivel = SEVERIDAD_POR_CODIGO[codigo];
  const linea: Record<string, unknown> = { nivel, codigo, timestamp: new Date().toISOString() };
  if (detalle.contador !== undefined) linea.contador = detalle.contador;
  if (detalle.duracionMs !== undefined) linea.duracionMs = detalle.duracionMs;
  // Guardia en runtime (ver comentario de cabecera, punto 2): nunca
  // confia ciegamente en el tipo -- si por algun motivo llega un valor
  // que no es uno de los 6 literales reales del catalogo cerrado, se
  // omite del log en silencio en vez de persistirlo.
  if (detalle.catalogoId !== undefined && esCatalogoConsultaId(detalle.catalogoId)) {
    linea.catalogoId = detalle.catalogoId;
  }

  const texto = JSON.stringify(linea);
  if (nivel === "error") console.error(texto);
  else if (nivel === "warn") console.warn(texto);
  else console.info(texto);
}
