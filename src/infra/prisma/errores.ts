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
