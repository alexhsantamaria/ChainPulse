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
//
// Incremento 5 PR4 -- POST() es ahora un envoltorio DELGADO alrededor de
// manejarEjecutarConsulta() (toda la logica original, sin cambios de
// comportamiento): mide la LATENCIA TOTAL de la peticion, de punta a
// punta -- desde la primera linea de este handler (antes incluso de
// requireSession()) hasta que la respuesta ya esta construida --, y la
// reporta via registrarEventoLatenciaConsulta() (evento saneado, ver
// eventoLatenciaConsulta.ts). Esto cierra la brecha identificada en el
// diseno de PR4: PRESUPUESTO_COMPUTO_MS (presupuestoComputo.ts) solo
// mide el computo sincronico de un motor puro, nunca el IO -- hasta este
// PR no existia ninguna senal de si una peticion real se acerca al
// objetivo "<5 segundos" de punta a punta. `contexto.catalogoId` se
// llena DENTRO de manejarEjecutarConsulta() en cuanto
// construirConsultaPermitida() lo valida -- permanece `undefined` para
// cualquier peticion que nunca llega a esa validacion (sesion invalida,
// body invalido, etc.), y el evento se registra igual, sin ese campo.
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { leerCuerpoJsonLimitado } from "@/infra/http/leerCuerpoJsonLimitado";
import { MAX_TAMANO_BODY_CONSULTA_BYTES } from "@/domain/limitesConsultas";
import {
  construirConsultaPermitida,
  ejecutarConsultaPermitida,
  type EntradaCrudaEjecutarConsulta,
} from "@/infra/queries/ejecutarConsultaPermitida";
import type { CatalogoConsultaId } from "@/domain/queries/tipos";
import { prisma } from "@/infra/prisma/client";
import {
  registrarIntento,
  hashHuellaOrigen,
  codificarHuellaConsultaAutenticada,
  calcularSegundosHastaProximoIntentoPermitido,
  LIMITE_CONSULTA_EJECUTAR,
  type ResultadoLimiteTasa,
} from "@/infra/rateLimit/limiteTasa";
import { registrarEventoRateLimitConsulta } from "@/infra/rateLimit/eventoConsultaRateLimit";
import { registrarEventoLatenciaConsulta } from "@/infra/queries/eventoLatenciaConsulta";

export const runtime = "nodejs";

/** Mapa explicito error de dispatcher -> status HTTP. SIN_DATOS_SUFICIENTES
 * NO esta aca: es un resultado valido y esperado (I5-25), nunca viaja como
 * `error` de este tipo -- se distingue mas abajo por `respuesta.ok`. */
const STATUS_POR_ERROR: Record<
  | "CATALOGO_ID_INVALIDO"
  | "CADENA_INEXISTENTE"
  | "PERMISO_DENEGADO"
  | "PERIODO_REQUERIDO"
  | "PERIODO_INVALIDO"
  | "PERIODO_DEMASIADO_LARGO"
  | "PRESUPUESTO_COMPUTO_EXCEDIDO",
  number
> = {
  CATALOGO_ID_INVALIDO: 400,
  CADENA_INEXISTENTE: 404,
  PERMISO_DENEGADO: 403,
  PERIODO_REQUERIDO: 400,
  PERIODO_INVALIDO: 400,
  PERIODO_DEMASIADO_LARGO: 400,
  // Incremento 5 PR2 -- mismo status que SERVICIO_NO_DISPONIBLE (PR1):
  // no es un error de los datos enviados (no 400), no es falta de
  // permisos (no 403/404), y no es "falta de cupo" con semantica de
  // "esperá N segundos" (no 429 -- por eso nunca lleva Retry-After,
  // ver presupuestoComputo.ts: reintentar el mismo pedido sin cambiar
  // nada tardaria lo mismo otra vez). El cuerpo nunca incluye
  // duracionMs -- ese detalle solo viaja al log saneado de servidor
  // (eventoPresupuestoComputo.ts), nunca al cliente.
  PRESUPUESTO_COMPUTO_EXCEDIDO: 503,
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

/** Contexto mutable, de UN SOLO campo, que manejarEjecutarConsulta()
 * llena para que el envoltorio POST() (que no tiene, ni deberia tener,
 * ninguna otra visibilidad sobre el payload ya validado) pueda incluir
 * catalogoId en el evento de latencia -- mismo campo, mismo tipo
 * cerrado y misma guardia en runtime que ya usan
 * eventoPresupuestoComputo.ts/eventoConsultaRateLimit.ts. Nunca lleva
 * cadenaId/empresaId/usuarioId: no hay ningun campo aca por el que
 * colarlos. */
interface ContextoLatenciaEjecutar {
  catalogoId?: CatalogoConsultaId;
}

export async function POST(request: Request): Promise<NextResponse> {
  const inicioMs = performance.now();
  const contexto: ContextoLatenciaEjecutar = {};
  let respuesta: NextResponse | undefined;
  try {
    respuesta = await manejarEjecutarConsulta(request, contexto);
    return respuesta;
  } finally {
    const duracionMs = performance.now() - inicioMs;
    registrarEventoLatenciaConsulta("CONSULTA_LATENCIA_TOTAL", {
      duracionMs,
      statusHttp: respuesta?.status,
      catalogoId: contexto.catalogoId,
    });
  }
}

async function manejarEjecutarConsulta(request: Request, contexto: ContextoLatenciaEjecutar): Promise<NextResponse> {
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
  // PR4 -- catalogoId recien se conoce aca (ya validado contra el
  // catalogo cerrado de 6 literales); se lo entrega al envoltorio de
  // latencia de POST() para que el evento pueda incluirlo. Nunca se
  // llena antes de este punto (sesion invalida/body invalido/payload
  // sin catalogoId valido quedan sin este campo en el evento, a
  // proposito).
  contexto.catalogoId = construida.entrada.catalogoId;

  // Incremento 5 PR1 -- limite de tasa POR USUARIO autenticado (nunca
  // por IP cruda, a diferencia de INICIO_EVALUACION/DESBLOQUEO_DETALLE:
  // esta ruta siempre tiene sesion, ver requireSession() arriba). Se
  // evalua DESPUES de validar el payload (construirConsultaPermitida,
  // pura, sin IO) pero ANTES de ejecutarConsultaPermitida() (el
  // dispatcher real, que toca la base y crea ConsultaLog) -- un payload
  // invalido nunca gasta cupo de limite de tasa, y ningun camino de
  // limite de tasa llega jamas al dispatcher ni a ConsultaLog.
  //
  // Fail-CLOSED a proposito (correccion explicita de Alex, 2026-11-17
  // sobre la entrega inicial, que proponia fail-open): esta consulta
  // depende de la misma base que el resto de la ruta -- fallar abierto
  // durante una degradacion de Postgres no mejora la disponibilidad
  // (la consulta real fallaria igual mas abajo), podria enmascarar una
  // migracion faltante o una mala configuracion, podria aumentar la
  // carga sobre una base ya degradada, y el limite de tasa es un
  // control de proteccion que no debe poder saltearse en silencio.
  const ahora = new Date();
  let resultadoLimite: ResultadoLimiteTasa;
  try {
    const huellaHash = hashHuellaOrigen(codificarHuellaConsultaAutenticada(sesion.empresaId, sesion.usuarioId));
    resultadoLimite = await registrarIntento(huellaHash, "CONSULTA_EJECUTAR", LIMITE_CONSULTA_EJECUTAR, ahora, prisma);
  } catch {
    // Nunca se pasa el error crudo a registrarEventoRateLimitConsulta
    // (ver eventoConsultaRateLimit.ts) -- un fallo de infraestructura
    // aca no debe filtrar SQL, connection string, ni ningun dato de
    // tenant/usuario a los logs.
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_INFRAESTRUCTURA");
    return NextResponse.json({ ok: false, error: "SERVICIO_NO_DISPONIBLE" }, { status: 503 });
  }

  if (!resultadoLimite.permitido) {
    const retryAfterSegundos = calcularSegundosHastaProximoIntentoPermitido(resultadoLimite.buckets, LIMITE_CONSULTA_EJECUTAR, ahora);
    registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_RECHAZADA", {
      contador: resultadoLimite.contador,
      catalogoId: construida.entrada.catalogoId,
    });
    // retryAfterSegundos viaja en el BODY (no solo en el header
    // Retry-After) porque fetchJsonSeguro() (http/fetchJsonSeguro.ts),
    // usado por ConsultasPanel.tsx y el resto de los componentes
    // cliente, descarta el objeto Response completo (solo usa
    // .json()) -- leer el header ahi exigiria volver al patron
    // fetch() crudo que fetchJsonSeguro() existe para eliminar (ver su
    // propio comentario, R5-8). El header se mantiene ademas para
    // cualquier cliente HTTP que si lo lea (correctitud HTTP).
    return NextResponse.json(
      { ok: false, error: "LIMITE_TASA_EXCEDIDO", retryAfterSegundos },
      { status: 429, headers: { "Retry-After": String(retryAfterSegundos) } },
    );
  }

  registrarEventoRateLimitConsulta("CONSULTA_RATE_LIMIT_PERMITIDA", {
    contador: resultadoLimite.contador,
    catalogoId: construida.entrada.catalogoId,
  });

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
