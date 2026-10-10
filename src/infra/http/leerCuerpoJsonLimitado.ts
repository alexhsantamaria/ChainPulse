// Infraestructura (servidor) -- lee el body JSON de una Request de forma
// LIMITADA por bytes REALES, nunca solo por el header Content-Length
// (correccion de Alex, 2026-10-10: "el limite no puede depender
// unicamente de Content-Length" -- un header ausente, invalido, o que
// declara menos bytes de los que en verdad vienen, dejaba pasar
// `request.json()` sobre un body sin ningun limite real).
//
// Dos chequeos, en este orden, nunca uno solo:
//   1. Rechazo TEMPRANO por Content-Length, si el header esta presente y
//      ya supera el limite -- barato, evita siquiera empezar a leer el
//      stream para el caso obvio (un cliente que declara correctamente
//      un body grande).
//   2. Lectura REAL del stream por chunks (`ReadableStream.getReader()`),
//      contando bytes a medida que llegan -- SIEMPRE se hace, sin
//      importar lo que haya dicho (o no) Content-Length. Apenas el
//      conteo real supera el limite, se CANCELA el stream
//      (`reader.cancel()`) y se rechaza de inmediato -- nunca se termina
//      de acumular en memoria un body que ya se sabe que excede el
//      limite, y los chunks ya acumulados se liberan (`chunks.length =
//      0`) en el mismo momento del rechazo.
//
// Solo si el body ENTERO entro dentro del limite se concatena, se
// decodifica a texto UTF-8 y se intenta `JSON.parse` -- nunca antes, y
// nunca se mantiene mas de una copia (los chunks individuales se liberan
// apenas se consolidan en el buffer final).
export type MotivoRechazoCuerpoJson = "CUERPO_DEMASIADO_GRANDE" | "CUERPO_INVALIDO";

export type ResultadoLeerCuerpoJsonLimitado = { ok: true; datos: unknown } | { ok: false; motivo: MotivoRechazoCuerpoJson };

export async function leerCuerpoJsonLimitado(request: Request, maxBytes: number): Promise<ResultadoLeerCuerpoJsonLimitado> {
  const declarado = request.headers.get("content-length");
  if (declarado !== null) {
    const n = Number(declarado);
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, motivo: "CUERPO_DEMASIADO_GRANDE" };
    }
    // n invalido (no numerico) o dentro del limite declarado: nunca se
    // confia solo en esto -- la lectura real de abajo es la que decide.
  }

  if (!request.body) {
    return { ok: false, motivo: "CUERPO_INVALIDO" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      chunks.length = 0; // nunca retiene una copia innecesaria del body excesivo
      return { ok: false, motivo: "CUERPO_DEMASIADO_GRANDE" };
    }
    chunks.push(value);
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  chunks.length = 0; // los chunks individuales ya no hacen falta una vez consolidados

  let texto: string;
  try {
    texto = buffer.toString("utf-8");
  } catch {
    return { ok: false, motivo: "CUERPO_INVALIDO" };
  }

  try {
    return { ok: true, datos: JSON.parse(texto) as unknown };
  } catch {
    return { ok: false, motivo: "CUERPO_INVALIDO" };
  }
}
