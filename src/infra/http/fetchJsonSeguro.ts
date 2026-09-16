// Infraestructura (cliente) — fetch + parseo JSON con manejo de errores
// centralizado (Ronda 5 de revision, R5-8, ALTO). Los 7 componentes
// cliente que llaman a la API hacian `const r = await fetch(...); const
// resultado = await r.json();` sin try/catch: si el fetch fallaba por red,
// o el servidor respondia con algo que no era JSON (por ejemplo un 500
// HTML no estructurado de Next.js), `await r.json()` lanzaba sin
// capturarse -- el estado de "cargando" quedaba pegado para siempre, sin
// mensaje de error ni forma de reintentar salvo recargar la pagina.
//
// Esta funcion nunca lanza: si algo falla, devuelve el mismo objeto
// `{ ok: false, error: "..." }` que ya devuelve la API en cualquier otro
// caso de error, para que el codigo que llama (que ya sabe manejar
// `!resultado.ok`) no necesite ningun try/catch propio -- el fix queda
// en un solo lugar en vez de repetirse en cada componente.
export interface RespuestaApiBase {
  ok: boolean;
  error?: string;
  [clave: string]: unknown;
}

export async function fetchJsonSeguro<T extends RespuestaApiBase = RespuestaApiBase>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(input, init);
  } catch {
    // Fallo de red real (sin conexion, DNS, CORS, etc.) -- nunca llego a
    // haber una respuesta HTTP.
    return { ok: false, error: "ERROR_RED" } as T;
  }

  try {
    return (await respuesta.json()) as T;
  } catch {
    // Hubo respuesta HTTP pero el cuerpo no es JSON valido (por ejemplo un
    // 500 HTML no estructurado, o un timeout de gateway) -- se trata como
    // el mismo error generico que el resto de la API ya usa.
    return { ok: false, error: "ERROR_INTERNO" } as T;
  }
}
