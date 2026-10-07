// Infraestructura — etiquetas de error seguras, compartidas por todo el
// mecanismo de restablecerPasswordMantenimiento.ts/
// restablecerPasswordCuentaPrueba.ts. Modulo deliberadamente SIN
// dependencias (ni Prisma, ni ningun otro modulo de infra, ni nada mas
// alla de JavaScript puro) -- esto es lo que permite que
// --probar-entrada (en el script) pueda usar etiquetaSegura() en su
// manejador final de errores sin arrastrar, ni siquiera
// transitivamente, la construccion de PrismaClient: ../prisma/client.ts
// construye `new PrismaPg(...)` y `new PrismaClient({ adapter })` en el
// momento de CARGARSE (codigo de nivel de modulo, fuera de cualquier
// funcion) -- cualquier import, estatico o dinamico, de un modulo que a
// su vez importe ese archivo dispara esa construccion de inmediato,
// aunque despues nunca se use. Mantener este archivo sin esa cadena de
// imports es lo que garantiza que etiquetaSegura() se pueda usar en
// cualquier contexto, incluido uno que deliberadamente no debe tocar
// Prisma en absoluto.
const ETIQUETAS_ERROR: Record<string, string> = {
  "42501": "permiso denegado",
  "08006": "conexion perdida",
  "08001": "no se pudo establecer conexion",
  ETIMEDOUT: "tiempo de espera agotado",
  ECONNREFUSED: "conexion rechazada",
  // Agregado (sexta ronda de revision, a pedido de Alex): "P2010" es un
  // codigo de Prisma (no un SQLSTATE de Postgres, pero mismo campo
  // err.code) para "la consulta cruda fallo" -- entre otras causas,
  // cuando el driver adapter no sabe convertir el tipo nativo de alguna
  // columna devuelta (p. ej. el tipo Postgres "name" de columnas como
  // `current_user` sin cast -- ver el comentario de verificarRolEfectivo()
  // en restablecerPasswordMantenimiento.ts). La etiqueta queda fija y
  // generica a proposito -- P2010 cubre mas de una causa posible, y esta
  // funcion nunca interpola nada mas alla del codigo ya reconocido.
  P2010: "consulta cruda fallida (posible tipo de columna no soportado por el driver)",
};

// Corregido (tercera ronda de revision, a pedido de Alex): antes, un
// codigo NO reconocido se interpolaba igual en la etiqueta
// ("[<codigo-crudo>] error no clasificado") -- si ese codigo viniera de
// un valor no controlado (p. ej. un driver que por error pusiera algo
// sensible en err.code, o cualquier otra fuente), se habria impreso
// igual, sin clasificar. Ahora el codigo crudo SOLO se interpola en la
// etiqueta cuando es EXACTAMENTE una de las claves fijas de
// ETIQUETAS_ERROR (constantes de este archivo, nunca datos externos,
// verificado con hasOwnProperty para no matchear nada de la cadena de
// prototipos) -- cualquier otro valor, sea lo que sea (incluida la
// ausencia de codigo), produce la misma etiqueta totalmente fija, sin
// ningun dato externo interpolado.
export function etiquetaSegura(err: unknown): string {
  const codigo = (err as { code?: unknown })?.code;
  if (typeof codigo === "string" && Object.prototype.hasOwnProperty.call(ETIQUETAS_ERROR, codigo)) {
    return `[${codigo}] ${ETIQUETAS_ERROR[codigo]}`;
  }
  return "[ERROR] error no clasificado";
}

/**
 * Único punto de registro de fallos de todo este mecanismo. Nunca recibe
 * ni imprime el error crudo -- ni err.message, ni err.stack, ni el
 * objeto err en sí -- solo un contexto fijo (qué función) y la etiqueta
 * ya clasificada de etiquetaSegura().
 */
export function registrarFalloSeguro(contexto: string, err: unknown): void {
  console.error(`[${contexto}] ${etiquetaSegura(err)}`);
}
