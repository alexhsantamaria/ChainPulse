// Infraestructura — helper de error de Prisma (Ronda 5 de revision,
// R5-23). Duck-typing en vez de `instanceof Prisma.PrismaClientKnownRequestError`
// porque `engineType="client"` (ADR-0003, adenda ARM64) no reexporta ese
// tipo desde "@prisma/client" -- el codigo de error si esta presente en
// runtime. El mismo bloque de 3 lineas estaba copiado literal en
// conexiones/route.ts, registro.ts y aceptarInvitacion.ts; este archivo
// es ahora el unico lugar que lo define.
export function codigoErrorPrisma(err: unknown): string | undefined {
  return err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
}

/** true si el error es una violacion de restriccion unica (P2002) de Prisma. */
export function esViolacionUnica(err: unknown): boolean {
  return codigoErrorPrisma(err) === "P2002";
}

// Diagnostico seguro de fallos de $queryRaw/$executeRaw (RF24, ronda 6 de
// revision -- a pedido de Alex: "SQLSTATE; severidad; mensaje PostgreSQL
// sanitizado; etiqueta de consulta -- sin URL, contrasena ni error que
// pueda incluir secretos"). Lee, con el MISMO duck-typing defensivo de
// arriba (nunca `instanceof Prisma.X`, mismo motivo: engineType="client"
// no reexporta esas clases), la forma INTERNA -- no publica, confirmada
// leyendo node_modules/@prisma/client/runtime/client.js y
// node_modules/@prisma/adapter-pg/dist/index.js de @prisma/client 6.19.3
// (version instalada en este proyecto) -- que usa Prisma para envolver
// cualquier fallo de consulta cruda: siempre llega como
// PrismaClientKnownRequestError con code "P2010", y su `meta.driverAdapterError.cause`
// trae el detalle real, que es uno de dos tipos muy distintos:
//   - Un error de Postgres genuino (cause.kind === "postgres"): trae
//     cause.originalCode (el SQLSTATE real, p.ej. "42501"), cause.severity
//     y cause.originalMessage (el mensaje corto de Postgres -- Postgres
//     nunca incluye la cadena de conexion ni credenciales en un mensaje de
//     ERROR, solo texto diagnostico).
//   - Un error del lado del DRIVER/ADAPTADOR, NUNCA de Postgres (la causa
//     real confirmada para el fallo de GRANTS_EXECUTE_PUBLIC de esta
//     ronda): cause.kind === "UnsupportedNativeDataType", cause.type = el
//     nombre del tipo nativo de Postgres que el adaptador no sabe
//     deserializar -- "name" (OID 19, el tipo interno de los
//     identificadores de catalogo: nombre de funcion/rol/tabla) y los
//     dominios de information_schema construidos sobre el (sql_identifier,
//     usado por routine_name/grantee en information_schema.routine_privileges)
//     NO estan en el mapeo de @prisma/adapter-pg (confirmado leyendo
//     fieldToColumnType() -- el OID 19 no esta en ningun case, y el
//     fallback solo cubre OIDs >= FIRST_NORMAL_OBJECT_ID=16384, rango que
//     excluye tanto "name" como los dominios de information_schema
//     creados por initdb). En este caso NO existe un SQLSTATE real: la
//     consulta nunca llega a fallar en Postgres, falla en el cliente Node
//     al convertir los METADATOS de columna, antes de inspeccionar
//     ninguna fila -- mismo mecanismo ya documentado y corregido una vez
//     en este proyecto para `current_user::text`
//     (src/infra/auth/restablecerPasswordMantenimiento.ts).
// Defensivo en cada nivel (nunca asume la forma; si algun campo no esta
// disponible, o si una version futura de Prisma cambia esta forma interna,
// simplemente queda `undefined` -- nunca se inventa un valor ni se lanza).
export interface DiagnosticoErrorConsultaCruda {
  codigoPrisma?: string;
  sqlstate?: string;
  severidad?: string;
  tipoNoSoportado?: string;
  mensaje?: string;
}

function comoRegistro(valor: unknown): Record<string, unknown> | undefined {
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : undefined;
}

function comoCadena(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined;
}

// Defensivo ADEMAS de lo ya confirmado arriba sobre el origen de este texto
// (nunca deberia traer URL ni credenciales) -- nunca se confia en un
// string de un tercero solo por haber leido su codigo una vez.
const PATRON_POSIBLE_SECRETO = /postgresql:\/\/|neon\.tech|password\s*=|token\s*=|secret\s*=/i;

function comoMensajeSaneado(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  return PATRON_POSIBLE_SECRETO.test(valor)
    ? "[REDACTADO -- el mensaje original parecia incluir una cadena de conexion o un secreto]"
    : valor;
}

export function diagnosticoErrorConsultaCruda(err: unknown): DiagnosticoErrorConsultaCruda {
  const codigoPrisma = codigoErrorPrisma(err);
  const meta = comoRegistro(comoRegistro(err)?.meta);
  const driverAdapterError = comoRegistro(meta?.driverAdapterError);
  const cause = comoRegistro(driverAdapterError?.cause);
  const sqlstate = comoCadena(cause?.originalCode);
  const severidad = cause?.kind === "postgres" ? comoCadena(cause?.severity) : undefined;
  const tipoNoSoportado = cause?.kind === "UnsupportedNativeDataType" ? comoCadena(cause?.type) : undefined;
  const mensajeOriginal = comoCadena(cause?.originalMessage) ?? (err instanceof Error ? err.message : undefined);
  return { codigoPrisma, sqlstate, severidad, tipoNoSoportado, mensaje: comoMensajeSaneado(mensajeOriginal) };
}

// Diagnostico MINIMO y seguro para loggear un FALLO DE LECTURA (nunca de
// escritura) sin exponer su contenido -- a pedido de Alex (incidente real
// de validacion manual Windows, 2026-11-06: "DriverAdapterError:
// Authentication timed out" en una consulta de SOLO LECTURA de
// ObservacionCobertura). Nunca el objeto `error` completo ni su
// message/stack/query/params/detail/hint/causa sin filtrar.
//
// Correccion de Alex (2026-11-07, antes del staging): la allowlist
// ESTRUCTURAL (que campos se loguean) no alcanza -- el CONTENIDO de cada
// valor tambien debe estar restringido, o un error disenado a proposito
// (o una version futura de una libreria que decida meter algo sensible
// en uno de estos mismos campos) podria filtrar una cadena arbitraria
// igual, aunque el NOMBRE del campo este permitido. Misma logica que ya
// usa este mismo repositorio en etiquetaSegura()
// (src/infra/auth/etiquetaErrorSegura.ts): un valor crudo SOLO se acepta
// cuando coincide EXACTAMENTE (nombreClase) o con un FORMATO fijo
// (codigo) con una constante cerrada de este archivo -- NUNCA se
// interpola el valor de entrada tal cual. Cualquier valor que no
// coincida se convierte en una categoria fija ("ERROR_DESCONOCIDO") o en
// `null`, nunca en el valor original.
//
// El campo `tipo`/`kind` (meta.driverAdapterError.cause.kind o
// cause.kind directo) que existia en la version anterior de esta
// funcion se elimino por completo: este mismo archivo ya documenta
// arriba (ver diagnosticoErrorConsultaCruda) que
// `meta.driverAdapterError` NO es una API publica documentada de Prisma
// (issue real: prisma/orm#29496) -- los unicos 2 valores de `kind`
// conocidos ("postgres", "UnsupportedNativeDataType") se confirmaron
// leyendo el codigo fuente INSTALADO de una version puntual de la
// libreria, no una garantia de Prisma. No existe, por lo tanto, una
// lista ESTABLE de valores permitidos para este campo -- y un
// diagnostico menos detallado (sin `tipo`) es preferible a validar
// contra una lista que podria quedar incompleta en la proxima version
// de la libreria y dejar pasar un valor no confiable.
const NOMBRES_CLASE_CONOCIDOS = new Set<string>([
  "DriverAdapterError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
  "Error",
  "TypeError",
  "RangeError",
]);

// Limites estrictos de longitud, ANTES de comparar contra la allowlist
// -- nunca se compara (ni se guarda, ni se loguea) un valor de entrada
// mas largo que el mayor nombre de clase realmente conocido de arriba.
const LONGITUD_MAXIMA_NOMBRE_CLASE = 40;
// "P" + 4 digitos (codigo de Prisma, p.ej. "P2002", "P2010" -- ver
// https://www.prisma.io/docs/orm/reference/error-reference) o un
// SQLSTATE de Postgres de EXACTAMENTE 5 caracteres (clase + subclase,
// p.ej. "28000", "42501", "08006") -- ambos formatos tienen longitud
// fija 5, asi que CUALQUIER valor mas largo se descarta de entrada, sin
// siquiera llegar a los regex de abajo.
const LONGITUD_MAXIMA_CODIGO = 5;
const PATRON_CODIGO_PRISMA = /^P[0-9]{4}$/;
const PATRON_SQLSTATE = /^[0-9A-Z]{5}$/;

function nombreClaseSeguro(valorCrudo: unknown): string {
  if (typeof valorCrudo !== "string" || valorCrudo.length === 0 || valorCrudo.length > LONGITUD_MAXIMA_NOMBRE_CLASE) {
    return "ERROR_DESCONOCIDO";
  }
  return NOMBRES_CLASE_CONOCIDOS.has(valorCrudo) ? valorCrudo : "ERROR_DESCONOCIDO";
}

function codigoSeguro(valorCrudo: unknown): string | null {
  if (typeof valorCrudo !== "string" || valorCrudo.length === 0 || valorCrudo.length > LONGITUD_MAXIMA_CODIGO) {
    return null;
  }
  return PATRON_CODIGO_PRISMA.test(valorCrudo) || PATRON_SQLSTATE.test(valorCrudo) ? valorCrudo : null;
}

export interface DiagnosticoLecturaSeguro {
  nombreClase: string;
  codigo: string | null;
}

export function diagnosticoLecturaSeguro(err: unknown): DiagnosticoLecturaSeguro {
  const registro = comoRegistro(err);
  const nombreClaseCruda = (registro?.constructor as { name?: unknown } | undefined)?.name;
  return {
    nombreClase: nombreClaseSeguro(nombreClaseCruda),
    codigo: codigoSeguro(codigoErrorPrisma(err)),
  };
}
