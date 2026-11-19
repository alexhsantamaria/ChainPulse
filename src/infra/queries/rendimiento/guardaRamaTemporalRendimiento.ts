// Infraestructura (solo para scripts/perf/, nunca usado por la app en
// runtime) -- compuerta de aislamiento contra produccion para los 2
// scripts de PR4 que ESCRIBEN o generan carga real contra una base
// (semillaSinteticaConsultas.ts, cargaConsultas.ts). explicarConsultas.ts
// (solo EXPLAIN ANALYZE, de solo lectura salvo por el propio efecto de
// ANALYZE en estadisticas -- nunca escribe filas) la reutiliza igual,
// por el mismo principio de "nunca asumir, siempre exigir confirmacion
// explicita" que ya exige destinoPrueba.ts para cualquier escritura.
//
// PURA a proposito (mismo criterio que destinoPrueba.ts/
// configuracionRendimiento.ts): ninguna de las funciones de aca toca
// una conexion real -- solo lee variables de entorno y parsea una URL.
// La verificacion de ROL de conexion (que SI necesita una consulta
// real) sigue siendo responsabilidad exclusiva de
// verificarRolConexionAdministrativa() (destinoPrueba.ts, ya probado
// alli) -- este archivo nunca la duplica.
//
// Reutiliza DIRECTAMENTE resumenUrl/destinoConfirmado/
// exigirEntornoConfirmado de destinoPrueba.ts (mismo patron ya usado
// por scripts/verificacionSoloLecturaEntornoPrueba.ts fuera del
// contexto RF19/RF20 -- es infraestructura general para "cualquier
// script que toque un entorno de prueba", no exclusiva de esa feature)
// en vez de reimplementar la confirmacion de destino exacto.
//
// Agrega, especificamente para PR4 (Alex, 2026-11-19: "scripts...
// deben incluir compuertas estrictas contra produccion"), el mismo
// patron de bloqueo por HOST que ya usa scripts/rf20RamaTemporalNeonRunbook.ts
// (exigirAislamiento() alli, privado a ese script) -- reescrito aqui
// como funciones EXPORTADAS y probadas, nunca duplicadas a mano en cada
// script nuevo:
//   NEON_RAMA_TEMPORAL_HOST_CONFIRMADO -- el host EXACTO de la rama
//     temporal que la persona confirmo a mano para ESTA corrida.
//   NEON_PRODUCCION_HOST_BLOQUEADO -- el host de produccion, declarado
//     explicitamente (nunca asumido) para poder compararlo.
//   AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL="si" -- autorizacion
//     puntual y nombrada para ESTE paquete de scripts (PR4), nunca
//     reutiliza el nombre de otra feature (RF19/RF20/RF24) ni al reves.
import { destinoConfirmado, exigirEntornoConfirmado, resumenUrl, type InfoDestino } from "../../pruebaRevocacion/destinoPrueba";

/** Mismo criterio que rf20RamaTemporalNeonRunbook.ts: una rama Neon
 * tiene variantes directa y pooler del mismo hostname -- normalizar
 * evita que produccion pase por distinta solo por "-pooler.". */
export function normalizarHostNeon(host: string): string {
  return host.toLowerCase().replace("-pooler.", ".");
}

export interface InfoDestinoConSsl extends InfoDestino {
  sslmode: string | null;
}

/** Variante de resumenUrl() (destinoPrueba.ts) que ADEMAS extrae
 * `?sslmode=` -- resumenUrl() no lo necesita (solo diagnostica destino
 * para confirmacion de base/esquema), pero las escrituras/carga de PR4
 * contra una rama temporal exigen ademas TLS fuerte (ver
 * exigirHostDeRamaTemporal() mas abajo), igual que
 * rf20RamaTemporalNeonRunbook.ts. */
export function resumenUrlConSsl(nombreVar: string, valor: string | undefined): InfoDestinoConSsl {
  const destino = resumenUrl(nombreVar, valor);
  // valor ya fue validado (no vacio, URL parseable) dentro de
  // resumenUrl() -- si hubiera fallado, ya lanzo antes de llegar aca.
  const u = new URL(valor as string);
  return { ...destino, sslmode: u.searchParams.get("sslmode") };
}

/**
 * Exige, con un codigo de error fijo por cada motivo (nunca el valor
 * crudo de ninguna variable, que podria contener una password mal
 * formada en la URL): que el host sea EXACTAMENTE el que la persona
 * confirmo como rama temporal, que un host de produccion haya sido
 * declarado explicitamente (para poder descartarlo) y que no coincida
 * con el host efectivo, que la conexion sea DIRECTA (nunca pooler) y
 * con TLS fuerte, y que exista la autorizacion puntual nombrada de PR4.
 * Nunca lanza con el valor de la URL en el mensaje.
 */
export function exigirHostDeRamaTemporalRendimiento(host: string, sslmode: string | null): void {
  const temporalConfirmado = process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO;
  const produccionBloqueado = process.env.NEON_PRODUCCION_HOST_BLOQUEADO;
  if (!temporalConfirmado || temporalConfirmado !== host) {
    throw new Error("HOST_TEMPORAL_NO_CONFIRMADO");
  }
  if (!produccionBloqueado) {
    throw new Error("HOST_PRODUCCION_NO_DECLARADO");
  }
  if (normalizarHostNeon(host) === normalizarHostNeon(produccionBloqueado)) {
    throw new Error("DESTINO_ES_PRODUCCION");
  }
  if (host.toLowerCase().includes("-pooler.")) {
    throw new Error("CONEXION_TEMPORAL_DEBE_SER_DIRECTA");
  }
  if (sslmode !== "require" && sslmode !== "verify-full") {
    throw new Error("TLS_FUERTE_REQUERIDO");
  }
  if (process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL !== "si") {
    throw new Error("AUTORIZACION_PR4_RENDIMIENTO_FALTANTE");
  }
}

/**
 * Punto de entrada unico para los 3 scripts de PR4: parsea la URL de
 * conexion (nombreVar, ej. "SEED_DATABASE_URL"), exige el bloqueo por
 * host (exigirHostDeRamaTemporalRendimiento) Y la confirmacion de
 * destino exacto (exigirEntornoConfirmado, destinoPrueba.ts, misma
 * variable ENTORNO_PRUEBA_CONFIRMADO que ya usan los demas scripts de
 * esta carpeta) -- las DOS compuertas, nunca una sola. Devuelve el
 * destino ya verificado para que el script lo use al construir su
 * propio cliente de Prisma/pg.
 */
export function exigirDestinoRendimientoSeguro(nombreVar: string, valor: string | undefined): InfoDestinoConSsl {
  const destino = resumenUrlConSsl(nombreVar, valor);
  exigirHostDeRamaTemporalRendimiento(destino.host, destino.sslmode);
  exigirEntornoConfirmado(destino);
  return destino;
}

export { destinoConfirmado };
