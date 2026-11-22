// Infraestructura (solo para scripts/perf/cargaConsultas.ts, nunca
// usado por la app en runtime) -- las piezas mas sensibles de ese
// script (Incremento 5 PR4, Alex, 2026-11-19), extraidas aqui para
// poder probarlas con vitest sin generar carga real ni tocar red
// (salvo verificarDeploymentUsaRamaTemporal(), que SI necesita red --
// recibe el fetch a usar por parametro para poder inyectar un mock en
// las pruebas, nunca el global real):
//   1. exigirUrlDePrueba() -- compuerta POSITIVA (no solo una lista
//      negativa) contra generar trafico real hacia produccion.
//   2. verificarDeploymentUsaRamaTemporal() -- prueba de que el
//      deployment de PRUEBA efectivamente lee de la rama temporal de
//      Neon ya sembrada, no de produccion ni de una base vacia.
//   3. construirPayloadCarga() -- el body exacto que el script envia
//      por cada una de las 6 preguntas.
//   4. construirResumenEscenario() -- el objeto que se escribe a disco
//      por cada corrida, con el chequeo de invalidez por codigo HTTP.
//
// CORRECCION (ronda de revision, 2026-11-19) sobre la version anterior
// de este archivo: la version previa de exigirUrlDePrueba() dependia
// SOLO de una lista negativa (PRODUCCION_URLS_BLOQUEADAS), que ademas
// tenia los 3 dominios MAL -- "chainpulse.vercel.app"/"chainpulse.com"/
// "app.chainpulse.com" nunca existieron; el proyecto real de Vercel es
// "chain-pulse" (con guion) y el dominio real de produccion es
// "chain-pulse-steel.vercel.app" (ver README.md, seccion de despliegue,
// y _documentos-locales/informes-cierre/cierre-validacion-local-y-evidencia-remota-pr4-2026-10-13.md).
// Con esos nombres, la compuerta anterior NUNCA hubiera bloqueado el
// dominio de produccion real. Ahora la lista de bloqueo es defensa EN
// PROFUNDIDAD (nunca la compuerta principal), con los hosts reales
// confirmados, y la compuerta principal es la combinacion de HTTPS +
// CARGA_CONSULTAS_HOST_CONFIRMADO (match exacto, positivo) +
// verificarDeploymentUsaRamaTemporal() (prueba empirica, no solo de
// nombre de host).
import type { CatalogoConsultaId } from "@/domain/queries/tipos";
import type { JWT } from "next-auth/jwt";
import { mintarCookieSesionSintetica } from "./sesionSinteticaHelpers";

/** Hosts de produccion REALES conocidos (README.md: primer despliegue
 * real en Vercel, proyecto "chain-pulse", equipo "alex-2477"; informe
 * de evidencia remota del 2026-10-13: dominios asociados del mismo
 * deployment). Lista cerrada y chica a proposito (Alex, 2026-11-19:
 * "compuertas estrictas contra produccion") -- defensa en profundidad,
 * NUNCA la unica proteccion: ver exigirUrlDePrueba() y
 * verificarDeploymentUsaRamaTemporal() mas abajo para la compuerta
 * principal (positiva).
 *
 * GAP CONOCIDO, declarado explicitamente en vez de ocultado: el informe
 * de evidencia remota del 2026-10-13 menciona "+1 dominio adicional no
 * detallado en la vista usada" en el listado de dominios de Vercel de
 * ese mismo proyecto -- no se pudo enumerar su valor exacto desde este
 * entorno (sin acceso al dashboard de Vercel). Por eso esta lista NUNCA
 * es la compuerta principal: si ese 4to dominio es justo el que se usa
 * como CARGA_CONSULTAS_BASE_URL por error, esta lista no lo atraparia,
 * pero CARGA_CONSULTAS_HOST_CONFIRMADO exacto + la prueba de rama
 * temporal de abajo si deberian (un deployment de produccion real
 * jamas va a devolver 200 para el cadenaId sintetico). */
export const PRODUCCION_HOSTS_BLOQUEADOS = [
  "chain-pulse-steel.vercel.app",
  "chain-pulse-git-main-alex-2477.vercel.app",
  "chain-pulse-onm04ny1z-alex-2477.vercel.app",
  // Agregado (Alex, ronda de revision 2, 2026-11-19): otro alias de
  // deployment del mismo proyecto real -- mismo criterio que los 3
  // anteriores, defensa en profundidad, nunca la compuerta principal.
  "chain-pulse-qgpvsqoge-alex-2477.vercel.app",
];

/**
 * Compuerta POSITIVA (no solo negativa) contra generar trafico real
 * hacia un destino equivocado. Exige, en este orden, con un codigo de
 * error distinto por motivo (nunca la URL completa en el mensaje, por
 * si alguna vez llevara datos sensibles en query string):
 *   1. HTTPS exclusivamente.
 *   2. Que NO sea (ni subdominio de) ningun host de produccion conocido
 *      (defensa en profundidad -- ver nota de PRODUCCION_HOSTS_BLOQUEADOS).
 *   3. CARGA_CONSULTAS_HOST_CONFIRMADO fijado y EXACTAMENTE igual al
 *      hostname de la URL -- la persona debe escribir a mano el host
 *      exacto que pretende probar, igual que NEON_RAMA_TEMPORAL_HOST_CONFIRMADO
 *      en guardaRamaTemporalRendimiento.ts. Esta es la compuerta
 *      PRINCIPAL (positiva): la lista de bloqueo de arriba es un
 *      respaldo, nunca el unico mecanismo.
 *   4. La autorizacion puntual nombrada de PR4.
 * Nunca valida por si sola que el deployment usa la rama temporal de
 * Neon -- eso es responsabilidad de verificarDeploymentUsaRamaTemporal(),
 * que main() debe llamar ademas de esta funcion, nunca en su lugar.
 */
export function exigirUrlDePrueba(urlBase: string): URL {
  const url = new URL(urlBase);
  if (url.protocol !== "https:") {
    throw new Error(`PROTOCOLO_INSEGURO_${url.protocol.replace(":", "")}`);
  }
  for (const bloqueado of PRODUCCION_HOSTS_BLOQUEADOS) {
    if (url.hostname === bloqueado || url.hostname.endsWith(`.${bloqueado}`)) {
      throw new Error(`URL_DE_PRODUCCION_BLOQUEADA_${url.hostname}`);
    }
  }
  const hostConfirmado = process.env.CARGA_CONSULTAS_HOST_CONFIRMADO;
  if (!hostConfirmado || hostConfirmado !== url.hostname) {
    throw new Error("HOST_DE_CARGA_NO_CONFIRMADO");
  }
  if (process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL !== "si") {
    throw new Error("AUTORIZACION_PR4_RENDIMIENTO_FALTANTE");
  }
  return url;
}

/** Catalogo que NUNCA requiere periodo -- se usa para la prueba de
 * rama temporal porque no necesita construir fechas, solo demostrar
 * que el cadenaId sintetico es visible para esta sesion. Repetido aca
 * (no importado de catalogo.ts) por el mismo motivo de pureza que
 * CATALOGO_IDS_CON_PERIODO mas abajo. */
export const CATALOGO_ID_SIN_PERIODO_PARA_SONDA: CatalogoConsultaId = "DEPENDENCIA_CRITICA";

/**
 * Forma minima reconocible de RespuestaConsultaOk real
 * (src/domain/queries/tipos.ts, I5-15..I5-24) -- nunca el tipo
 * completo (este helper debe seguir siendo puro, sin importar nada de
 * infra/Prisma): basta con un subconjunto de campos de texto que una
 * pagina HTML, una pagina de proteccion/SSO de Vercel, o un mock
 * generico (`{ok:true}`) NUNCA tendrian los 5 a la vez.
 */
function esRespuestaOkReconocible(cuerpo: Record<string, unknown>): boolean {
  return (
    cuerpo.ok === true &&
    typeof cuerpo.respuestaDirecta === "string" &&
    typeof cuerpo.fuente === "string" &&
    typeof cuerpo.ruleVersion === "string" &&
    typeof cuerpo.hecho === "string" &&
    typeof cuerpo.interpretacion === "string"
  );
}

/** Forma minima reconocible de RespuestaConsultaSinDatos real (I5-25)
 * -- el OTRO 200 valido posible de la ruta real (ausencia de datos
 * suficientes no es una falla, ver route.ts). */
function esRespuestaSinDatosReconocible(cuerpo: Record<string, unknown>): boolean {
  return (
    cuerpo.ok === false &&
    cuerpo.error === "SIN_DATOS_SUFICIENTES" &&
    typeof cuerpo.mensaje === "string" &&
    Array.isArray(cuerpo.camposFaltantes)
  );
}

/**
 * Verifica que `cuerpo` (ya parseado de JSON) tenga el contrato
 * reconocible de UNA de las 2 respuestas reales posibles de la ruta
 * (RespuestaConsultaOk o RespuestaConsultaSinDatos), Y que
 * `catalogoId` coincida EXACTAMENTE con lo que se pidio -- nunca
 * alcanza con que el cuerpo "se parezca" a JSON valido: tiene que ser
 * estructuralmente el contrato real de I5-08/I5-15..I5-25. Exportada
 * para probarla de forma pura, sin red (Alex, ronda de revision 3,
 * 2026-11-19: "JSON contractual valido" como uno de los casos a
 * probar).
 */
export function tieneContratoDeConsultaReconocible(cuerpo: unknown, catalogoIdEsperado: CatalogoConsultaId): boolean {
  if (typeof cuerpo !== "object" || cuerpo === null) return false;
  const c = cuerpo as Record<string, unknown>;
  if (c.catalogoId !== catalogoIdEsperado) return false;
  return esRespuestaOkReconocible(c) || esRespuestaSinDatosReconocible(c);
}

/**
 * Prueba EMPIRICA (no solo de nombre de host) de que el deployment
 * apuntado por `urlBase` efectivamente lee de la MISMA base que ya
 * sembro semillaSinteticaConsultas.ts para `cadenaId` -- nunca de
 * produccion ni de una base vacia/distinta. Una Vercel preview puede
 * conservar las variables de entorno de produccion (Alex, ronda de
 * revision 2026-11-19: "una preview de Vercel no basta"), asi que
 * ningun chequeo de nombre de host puede demostrar esto por si solo.
 *
 * Mecanismo: una (1) sola peticion de sondeo, antes de cualquier carga
 * real, preguntando DEPENDENCIA_CRITICA (no requiere periodo) para el
 * `cadenaId` sintetico ya sembrado, contra la ruta ABSOLUTA
 * "/api/consultas/ejecutar" (nunca relativa -- inmune a si `urlBase`
 * trae o no una sub-ruta propia). El contrato real de la ruta
 * (src/app/api/consultas/ejecutar/route.ts) devuelve EXACTAMENTE
 * HTTP 404 (CADENA_INEXISTENTE) cuando `cadena.findUnique` no encuentra
 * esa cadena bajo el tenant de la sesion -- y HTTP 200 en cualquier
 * resultado valido, incluido "sin datos suficientes" (I5-25). Como el
 * cadenaId sintetico tiene un cuid propio e irrepetible, un 200 aca
 * CON el contrato real reconocible (ver tieneContratoDeConsultaReconocible())
 * es una prueba practicamente concluyente de que esta sesion/deployment
 * ve la rama temporal sembrada -- produccion real nunca podria
 * devolver ese contrato para un id que nunca sembro.
 *
 * CORRECCION (ronda de revision 3, 2026-11-19): la version anterior
 * solo exigia `status === 200`, con `fetch` siguiendo redirecciones
 * por defecto -- una redireccion hacia una pagina de proteccion/SSO de
 * Vercel (o cualquier otra pagina HTML que termine en 200 despues de
 * seguir el redirect) hubiera pasado ese chequeo como si fuera la API
 * real. Ahora: `redirect: "manual"` (NUNCA se sigue una redireccion
 * automaticamente -- verificado empiricamente: con `redirect:"manual"`,
 * el `fetch` de Node devuelve el 3xx real, en vez de seguirlo, asi que
 * el chequeo `status !== 200` ya lo invalida solo); se exige
 * `content-type` de respuesta que contenga "application/json" (nunca
 * HTML/texto generico); el cuerpo debe parsear como JSON valido; y
 * debe tener el contrato reconocible de la ruta real
 * (tieneContratoDeConsultaReconocible()) -- nunca un `{ok:true}`
 * generico ni cualquier otro JSON casual.
 *
 * Nunca registra ni expone `cookieSesion` en ningun error ni valor de
 * retorno -- los codigos de error de abajo son fijos, nunca incluyen
 * el valor de la cookie ni del cuerpo de la respuesta (que podria,
 * en teoria, reflejar datos de otro tenant si algo saliera mal).
 */
export async function verificarDeploymentUsaRamaTemporal(
  fetchImpl: typeof fetch,
  urlBase: URL,
  cookieSesion: string,
  cadenaId: string,
  bypassProteccionVercel?: string,
): Promise<void> {
  let respuesta: Response;
  try {
    respuesta = await fetchImpl(new URL("/api/consultas/ejecutar", urlBase).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieSesion,
        ...(bypassProteccionVercel
          ? { "x-vercel-protection-bypass": bypassProteccionVercel }
          : {}),
      },
      body: JSON.stringify({ catalogoId: CATALOGO_ID_SIN_PERIODO_PARA_SONDA, cadenaId }),
      redirect: "manual",
    });
  } catch {
    // Nunca el mensaje crudo del error de red (podria incluir la URL
    // completa con query string, aunque hoy no lleve ninguno sensible).
    throw new Error("SONDA_RAMA_TEMPORAL_FALLO_DE_RED");
  }
  if (respuesta.status !== 200) {
    // Cubre tanto una falla real de la ruta como una redireccion (3xx)
    // que `redirect:"manual"` ya impidio seguir -- ambas invalidan la
    // sonda por igual, sin necesidad de distinguir el motivo exacto.
    throw new Error(`SONDA_RAMA_TEMPORAL_STATUS_INESPERADO_${respuesta.status}`);
  }

  const contentType = respuesta.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("SONDA_RAMA_TEMPORAL_CONTENT_TYPE_NO_JSON");
  }

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new Error("SONDA_RAMA_TEMPORAL_JSON_MALFORMADO");
  }

  if (!tieneContratoDeConsultaReconocible(cuerpo, CATALOGO_ID_SIN_PERIODO_PARA_SONDA)) {
    throw new Error("SONDA_RAMA_TEMPORAL_CONTRATO_NO_RECONOCIBLE");
  }
}

/** Resultado de UNA variante de cookie en sondarVarianteCookieReconocidaPorDeployment()
 * -- nunca incluye el valor de la cookie ni del cuerpo de la respuesta,
 * mismo criterio que verificarDeploymentUsaRamaTemporal(). */
export interface ResultadoSondaVarianteCookie {
  /** true si ESA variante especifica (ese nombre/salt de cookie) fue
   * RECONOCIDA por el deployment -- EL MISMO criterio exigente que
   * verificarDeploymentUsaRamaTemporal() (200 + content-type JSON +
   * contrato real reconocible via tieneContratoDeConsultaReconocible()),
   * nunca el chequeo mas debil de "status !== 401" (una pagina de
   * proteccion/SSO de Vercel, un 500, o cualquier otro codigo distinto
   * de 401 NUNCA deben contarse como "reconocida"). */
  reconocida: boolean;
  statusHttp: number;
}

/**
 * Sonda DIAGNOSTICA, acotada a EXACTAMENTE 2 peticiones (una por cada
 * variante de nombre/salt de cookie), para uso MANUAL del operador --
 * NUNCA invocada por main() ni por ninguna corrida de carga real, y
 * NUNCA un sustituto de verificarDeploymentUsaRamaTemporal() (que sigue
 * siendo la unica sonda que main() llama antes de cargar, SIN NINGUN
 * CAMBIO en este archivo).
 *
 * Responde la pregunta empirica que CARGA_CONSULTAS_USA_COOKIES_SEGURAS
 * por si solo no puede responder sin probarlo contra el deployment real
 * (Alex, 2026-11-20, ronda de seguimiento: "Considera una sonda acotada
 * que emita ambas variantes de cookie, cada una cifrada con su propio
 * nombre como salt, para identificar empiricamente cual reconoce el
 * Preview sin debilitar la compuerta"): ¿cual de las DOS variantes
 * (`__Secure-authjs.session-token` o `authjs.session-token`, ver
 * calcularNombreCookieSesion()/sesionSinteticaHelpers.ts) reconoce el
 * SERVIDOR de ESE deployment especifico?
 *
 * Reutiliza, SIN MODIFICAR NI RELAJAR NINGUNA:
 *   - exigirUrlDePrueba() -- la MISMA compuerta positiva (HTTPS + host
 *     no bloqueado + CARGA_CONSULTAS_HOST_CONFIRMADO exacto +
 *     autorizacion puntual) que main() ya exige antes de cualquier
 *     trafico real. Esta sonda la llama ella misma, al principio, con
 *     el mismo efecto que tendria en main() -- jamas la bypasea.
 *   - El mismo criterio de "reconocible" que verificarDeploymentUsaRamaTemporal()
 *     (status===200, content-type JSON, `redirect:"manual"`, contrato
 *     real via tieneContratoDeConsultaReconocible()).
 *   - mintarCookieSesionSintetica() (sesionSinteticaHelpers.ts) para
 *     generar AMBAS variantes con el secreto real provisto por el
 *     operador -- nunca un secreto hardcodeado ni distinto del real.
 *
 * NUNCA registra ni expone el valor de ninguna cookie ni del cuerpo de
 * ninguna respuesta -- los resultados son solo booleano + codigo HTTP
 * por variante, igual que verificarDeploymentUsaRamaTemporal().
 *
 * Posible resultado con AMBAS variantes `reconocida:false`: significa
 * que el problema NO es (!solo) el salt/nombre de cookie -- hay que
 * descartar primero un secreto incorrecto o un problema de
 * sessionVersion/conexion a base antes de asumir que esta es la causa
 * (Alex: "no uses esto para ocultar un posible fallo de sessionVersion
 * o conexion a base detras del mismo 401" -- esta sonda NUNCA colapsa
 * ambos resultados en uno solo, siempre devuelve los 2 por separado,
 * precisamente para que ese otro escenario quede visible y distinguible).
 */
export async function sondarVarianteCookieReconocidaPorDeployment(
  fetchImpl: typeof fetch,
  urlBaseCruda: string,
  secret: string,
  claims: JWT,
  cadenaId: string,
  bypassProteccionVercel?: string,
): Promise<{ https: ResultadoSondaVarianteCookie; http: ResultadoSondaVarianteCookie }> {
  const urlBase = exigirUrlDePrueba(urlBaseCruda);

  const [cookieHttps, cookieHttp] = await Promise.all([
    mintarCookieSesionSintetica(secret, claims, true),
    mintarCookieSesionSintetica(secret, claims, false),
  ]);

  const probarVariante = async (cookieSesion: string): Promise<ResultadoSondaVarianteCookie> => {
    let respuesta: Response;
    try {
      respuesta = await fetchImpl(new URL("/api/consultas/ejecutar", urlBase).toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieSesion,
          ...(bypassProteccionVercel
            ? { "x-vercel-protection-bypass": bypassProteccionVercel }
            : {}),
        },
        body: JSON.stringify({ catalogoId: CATALOGO_ID_SIN_PERIODO_PARA_SONDA, cadenaId }),
        redirect: "manual",
      });
    } catch {
      return { reconocida: false, statusHttp: -1 };
    }
    if (respuesta.status !== 200) {
      return { reconocida: false, statusHttp: respuesta.status };
    }
    const contentType = respuesta.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return { reconocida: false, statusHttp: respuesta.status };
    }
    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch {
      return { reconocida: false, statusHttp: respuesta.status };
    }
    return {
      reconocida: tieneContratoDeConsultaReconocible(cuerpo, CATALOGO_ID_SIN_PERIODO_PARA_SONDA),
      statusHttp: respuesta.status,
    };
  };

  const [https, http] = await Promise.all([probarVariante(cookieHttps), probarVariante(cookieHttp)]);
  return { https, http };
}

/** Las 4 preguntas que EXIGEN periodo (metadatos.requierePeriodo en
 * catalogo.ts) -- repetido aca como lista cerrada, a proposito, en vez
 * de importar catalogo.ts (que importa Prisma indirectamente via otros
 * modulos de infra/queries -- este helper debe seguir siendo PURO,
 * cero dependencia de Prisma, para poder probarse sin el mock que el
 * resto de las pruebas de infra/queries/ ya necesitan). Las pruebas de
 * configuracionRendimiento.test.ts / catalogo.test.ts verifican por
 * separado que esta lista sigue coincidiendo con la real. */
const CATALOGO_IDS_CON_PERIODO: ReadonlySet<CatalogoConsultaId> = new Set([
  "OTIF_CAIDA",
  "OTIF_PROVEEDOR_RETRASOS",
  "FALTANTES_FILL_RATE",
  "CAMBIOS_ULTIMO_PULSO",
]);

/** Payload por catalogoId -- las 4 preguntas con periodo usan el mismo
 * periodo fijo que semillaSinteticaConsultas.ts sembro; las 2 sin
 * periodo (DEPENDENCIA_CRITICA/ACCION_PRIORITARIA) lo omiten, igual que
 * un cliente real. */
export function construirPayloadCarga(catalogoId: CatalogoConsultaId, cadenaId: string): Record<string, unknown> {
  const base: Record<string, unknown> = { catalogoId, cadenaId };
  if (CATALOGO_IDS_CON_PERIODO.has(catalogoId)) {
    base.periodoInicio = "2026-01-01";
    base.periodoFin = "2026-01-31";
  }
  return base;
}

/**
 * CORRECCION (ronda 2 de revision, 2026-11-19, punto 3): la version
 * anterior solo invalidaba la medicion ante una lista FIJA de codigos
 * (401/403/429/500/503) -- dejaba pasar como "valida" una corrida con
 * 400 o 404 (CADENA_INEXISTENTE real, no la sonda previa), o una donde
 * la suma de statusCodeStats no coincidiera con requests.total (p.ej.
 * si autocannon no llego a clasificar algunas respuestas). Alex: "Una
 * corrida invalida debe conservar el diagnostico, pero el script debe
 * terminar con codigo distinto de cero y nunca presentar sus
 * percentiles como evidencia aprobada. La sonda de la primera cookie
 * no sustituye la validacion de todas las sesiones."
 *
 * Ahora medicionValida exige, LAS condiciones a la vez (4 de la ronda 2
 * + 2 mas agregadas en la ronda 3, ver mas abajo en esta misma
 * funcion -- totalEsperado/temporizadorSeguridadActivado):
 *   1. TODAS las respuestas son HTTP 200 (ningun otro codigo, ni uno).
 *   2. La suma de todos los conteos de statusCodeStats coincide
 *      EXACTAMENTE con requests.total (si no coincidiera, algo no se
 *      clasifico -- no se puede afirmar "todo fue 200" con un hueco sin
 *      explicar).
 *   3. errors === 0 (sin fallas de transporte/conexion).
 *   4. timeouts === 0.
 *   5. requests.total === totalEsperado (la corrida no quedo cortada a
 *      mitad de camino -- ver el comentario junto a `corridaCompleta`
 *      mas abajo).
 *   6. El temporizador de seguridad de reloj de pared nunca se activo.
 * Esto reemplaza la lista fija anterior (401/403/429/500/503): ahora
 * CUALQUIER codigo distinto de 200 -- incluidos 400 y 404, que antes NO
 * invalidaban -- hace que medicionValida sea false. La sonda previa
 * (verificarDeploymentUsaRamaTemporal(), una sola peticion con una sola
 * cookie) prueba que el deployment ve la rama temporal ANTES de cargar
 * -- nunca prueba que las demas N-1 sesiones vayan a autenticar
 * correctamente durante la carga real; esta validacion por escenario,
 * sobre el trafico real de TODAS las cookies, es la que de verdad cubre
 * eso.
 */
export interface ResumenEscenarioCarga {
  concurrencia: number;
  totalSolicitudes: number;
  p50Ms: number;
  // CORRECCION (ronda 2, punto 4): autocannon nunca entrega un p95
  // real -- su lista de percentiles (node_modules/autocannon/lib/
  // histUtil.js via hdr-histogram-percentiles-obj) salta de 90 a 97.5,
  // sin 95. Guardar ese valor bajo la clave "p95Ms" (como hacia la
  // version anterior) era incorrecto: un lector del resultado podria
  // tomarlo como el p95 real y subestimar cuanto mas alto es en
  // realidad. Renombrado a p97_5Ms, con el nombre exacto de autocannon,
  // documentado como aproximacion CONSERVADORA (el p97.5 de cualquier
  // distribucion es siempre >= su p95 real, nunca lo subestima) --
  // opcion elegida sobre calcular un p95 real decodificando el
  // histograma HDR interno (hdr-histogram-js), que exigiria pasar
  // `skipAggregateResult` y reimplementar la decodificacion aca: mas
  // superficie/dependencia nueva por un numero que, para esta auditoria
  // puntual, el p97_5 ya acota de forma segura (nunca lo contrario).
  p97_5Ms: number;
  p99Ms: number;
  maxMs: number;
  conteosPorCodigoHttp: Record<string, number>;
  erroresTransporte: number;
  timeouts: number;
  medicionValida: boolean;
  /** TODOS los codigos HTTP distintos de 200 vistos en la corrida (no
   * una lista fija) -- vacio si y solo si medicionValida podria ser
   * true por esta condicion especifica (las otras condiciones de
   * arriba/abajo se verifican por separado, ver construirResumenEscenario()). */
  codigosInvalidantesEncontrados: number[];
  /** CORRECCION (ronda de revision 3, 2026-11-19, punto 1): cuantas
   * solicitudes se ESPERABAN en total para este escenario (= `amount`
   * que correrUnaConcurrencia() le paso a autocannon, EXACTO por
   * diseno -- ver cargaConsultas.ts). Se conserva aca para que una
   * corrida INCOMPLETA (menos respuestas que las esperadas, porque la
   * red de seguridad de reloj de pared la corto a mitad de camino) se
   * pueda diagnosticar comparando este campo contra `totalSolicitudes`
   * -- nunca se descarta el diagnostico solo porque la medicion sea
   * invalida. */
  totalSolicitudesEsperadas: number;
  /** CORRECCION (ronda de revision 3, 2026-11-19, punto 1): true si la
   * red de seguridad de reloj de pared de correrUnaConcurrencia()
   * efectivamente se disparo durante esta corrida (nunca solo si
   * estaba programada -- un timer que nunca llega a ejecutarse porque
   * la corrida termino antes no cuenta). Alex: "la corrida parcial
   * marcada como valida" -- si TODAS las respuestas recibidas hasta
   * ahi fueran 200, la version anterior de esta funcion no tenia forma
   * de distinguir una corrida COMPLETA de una CORTADA a mitad de
   * camino por el temporizador. Una corrida cortada por el
   * temporizador de seguridad NUNCA es valida, sin importar que todas
   * las respuestas recibidas hasta ese punto fueran 200 -- ver
   * medicionValida en construirResumenEscenario(). */
  temporizadorSeguridadActivado: boolean;
}

/** Forma minima de lo que esta funcion necesita del resultado agregado
 * de autocannon -- un subconjunto deliberadamente angosto (no `any`,
 * nunca el objeto completo de autocannon) para que esta funcion sea
 * pura y testeable sin importar la libreria real. NUNCA incluye
 * headers/cookies -- autocannon no los expone en su resultado
 * agregado, y esta interfaz tampoco los declara, asi que no hay forma
 * estructural de que terminen en ResumenEscenarioCarga. */
export interface ResultadoAutocannonMinimo {
  requests: { total: number };
  latency: { p50: number; p97_5: number; p99: number; max: number };
  errors: number;
  timeouts: number;
  statusCodeStats?: Record<string, { count: number } | undefined>;
}

/**
 * Construye el objeto exacto que se escribe a disco/consola por cada
 * escenario de concurrencia -- deliberadamente sin ningun campo que
 * pueda contener la cookie de sesion (ver ResultadoAutocannonMinimo).
 * Cuenta TODOS los codigos HTTP vistos y declara la medicion invalida
 * salvo exito total -- ver el comentario de ResumenEscenarioCarga
 * arriba para las condiciones exigidas (Alex, rondas 2 y 3 de revision,
 * punto 3).
 */
export function construirResumenEscenario(
  concurrencia: number,
  resultado: ResultadoAutocannonMinimo,
  totalEsperado: number,
  temporizadorSeguridadActivado: boolean,
): ResumenEscenarioCarga {
  const conteosPorCodigoHttp: Record<string, number> = {};
  let sumaConteos = 0;
  for (const [codigo, entrada] of Object.entries(resultado.statusCodeStats ?? {})) {
    const conteo = entrada?.count ?? 0;
    conteosPorCodigoHttp[codigo] = conteo;
    sumaConteos += conteo;
  }

  const codigosInvalidantesEncontrados = Object.keys(conteosPorCodigoHttp)
    .filter((codigo) => codigo !== "200" && (conteosPorCodigoHttp[codigo] ?? 0) > 0)
    .map(Number)
    .sort((a, b) => a - b);

  // Condicion 1+2: TODAS las respuestas contadas son 200, Y la suma de
  // todos los conteos coincide exactamente con requests.total (si no
  // coincidiera, hay respuestas sin clasificar -- no se puede afirmar
  // "todo fue 200" con ese hueco sin explicar). sumaConteos === 0 nunca
  // es "valida" (una corrida sin ninguna respuesta contada no prueba
  // nada): exigir sumaConteos > 0 explicitamente.
  const todoHttp200ySumaCompleta =
    sumaConteos > 0 && sumaConteos === resultado.requests.total && (conteosPorCodigoHttp["200"] ?? 0) === sumaConteos;

  // CORRECCION (ronda de revision 3, 2026-11-19, punto 1): "Corrida
  // parcial marcada como valida" -- si la red de seguridad de reloj de
  // pared de correrUnaConcurrencia() corta la corrida a mitad de
  // camino, `resultado.requests.total` (completadas) puede ser MENOR
  // que `totalEsperado` (= amount) aunque TODAS las respuestas
  // recibidas hasta ese punto hayan sido 200 -- las 4 condiciones
  // anteriores (todas 200, suma completa, sin errores, sin timeouts)
  // NUNCA detectan esto por si solas, porque se calculan solo sobre lo
  // que SI se conto. Ahora medicionValida exige, ADEMAS de las 4
  // condiciones anteriores:
  //   5. resultado.requests.total === totalEsperado (la corrida
  //      efectivamente completo TODAS las solicitudes esperadas, no
  //      solo las que alcanzo a contar antes de cortar).
  //   6. !temporizadorSeguridadActivado (la red de seguridad nunca se
  //      disparo -- si se disparo, la corrida es sospechosa de estar
  //      incompleta aunque, por coincidencia, requests.total ya
  //      hubiera llegado a totalEsperado antes de que el temporizador
  //      alcanzara a actuar).
  const corridaCompleta = resultado.requests.total === totalEsperado && !temporizadorSeguridadActivado;
  const medicionValida = todoHttp200ySumaCompleta && resultado.errors === 0 && resultado.timeouts === 0 && corridaCompleta;

  return {
    concurrencia,
    totalSolicitudes: resultado.requests.total,
    p50Ms: resultado.latency.p50,
    p97_5Ms: resultado.latency.p97_5,
    p99Ms: resultado.latency.p99,
    maxMs: resultado.latency.max,
    conteosPorCodigoHttp,
    erroresTransporte: resultado.errors,
    timeouts: resultado.timeouts,
    medicionValida,
    codigosInvalidantesEncontrados,
    totalSolicitudesEsperadas: totalEsperado,
    temporizadorSeguridadActivado,
  };
}
