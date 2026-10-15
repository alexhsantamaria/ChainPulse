// Ruta API -- POST que ejecuta una de las 6 preguntas del catalogo
// cerrado de Incremento 5 (I5-09..I5-13). requireSession() (cualquier
// rol): el control de permisos POR PREGUNTA (metadatos.permisos) ocurre
// dentro de ejecutarConsultaPermitida(), nunca aca -- esta ruta nunca
// decide por si misma si un rol puede ejecutar una pregunta especifica.
//
// catalogoId/cadenaId/periodoInicio/periodoFin son los UNICOS campos que
// esta ruta acepta del body (I5-08: "no permitir que el cliente envíe
// nombre de tabla, columna, SQL, función interna, tenant o empresa") --
// empresaId/usuarioId/rol salen SIEMPRE de requireSession(), nunca del
// payload de red.
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { leerCuerpoJsonLimitado } from "@/infra/http/leerCuerpoJsonLimitado";
import { MAX_TAMANO_BODY_CONSULTA_BYTES } from "@/domain/limitesConsultas";
import {
  construirConsultaPermitida,
  ejecutarConsultaPermitida,
  type EntradaCrudaEjecutarConsulta,
} from "@/infra/queries/ejecutarConsultaPermitida";

export const runtime = "nodejs";

/** Mapa explicito error de dispatcher -> status HTTP. SIN_DATOS_SUFICIENTES
 * NO esta aca: es un resultado valido y esperado (I5-25), nunca viaja como
 * `error` de este tipo -- se distingue mas abajo por `respuesta.ok`. */
const STATUS_POR_ERROR: Record<
  "CATALOGO_ID_INVALIDO" | "CADENA_INEXISTENTE" | "PERMISO_DENEGADO" | "PERIODO_REQUERIDO" | "PERIODO_INVALIDO" | "PERIODO_DEMASIADO_LARGO",
  number
> = {
  CATALOGO_ID_INVALIDO: 400,
  CADENA_INEXISTENTE: 404,
  PERMISO_DENEGADO: 403,
  PERIODO_REQUERIDO: 400,
  PERIODO_INVALIDO: 400,
  PERIODO_DEMASIADO_LARGO: 400,
};

function aEntradaCruda(payload: unknown): EntradaCrudaEjecutarConsulta | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.catalogoId !== "string" || !p.catalogoId) return null;
  if (typeof p.cadenaId !== "string" || !p.cadenaId) return null;
  // Opcionales -- undefined/null validos (preguntas sin periodo); si
  // vienen, deben ser string (ISO), nunca otro tipo.
  if (p.periodoInicio !== undefined && p.periodoInicio !== null && typeof p.periodoInicio !== "string") return null;
  if (p.periodoFin !== undefined && p.periodoFin !== null && typeof p.periodoFin !== "string") return null;

  return {
    catalogoId: p.catalogoId,
    cadenaId: p.cadenaId,
    periodoInicio: typeof p.periodoInicio === "string" ? p.periodoInicio : null,
    periodoFin: typeof p.periodoFin === "string" ? p.periodoFin : null,
  };
}

export async function POST(request: Request) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const cuerpo = await leerCuerpoJsonLimitado(request, MAX_TAMANO_BODY_CONSULTA_BYTES);
  if (!cuerpo.ok) {
    if (cuerpo.motivo === "CUERPO_DEMASIADO_GRANDE") {
      return NextResponse.json({ ok: false, error: cuerpo.motivo, limiteBytes: MAX_TAMANO_BODY_CONSULTA_BYTES }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: cuerpo.motivo }, { status: 400 });
  }

  const cruda = aEntradaCruda(cuerpo.datos);
  if (!cruda) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const construida = construirConsultaPermitida(cruda);
  if (!construida.ok) {
    return NextResponse.json({ ok: false, error: construida.error }, { status: STATUS_POR_ERROR[construida.error] });
  }

  const resultado = await ejecutarConsultaPermitida(
    { catalogoId: construida.entrada.catalogoId, cadenaId: construida.entrada.cadenaId, periodo: construida.entrada.periodo },
    { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId, rol: sesion.rol },
  );

  if (!resultado.ok) {
    // SIN_DATOS_SUFICIENTES (I5-25) viaja con 200: es una respuesta
    // honesta y esperada del catalogo, nunca una falla de la ruta. El
    // resto de los `error` son fallas de dispatcher (ver STATUS_POR_ERROR).
    if (resultado.error === "SIN_DATOS_SUFICIENTES") {
      return NextResponse.json(resultado, { status: 200 });
    }
    return NextResponse.json(resultado, { status: STATUS_POR_ERROR[resultado.error] });
  }

  return NextResponse.json(resultado, { status: 200 });
}
