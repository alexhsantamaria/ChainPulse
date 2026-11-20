// Pruebas -- cargaConsultasHelpers.ts (Incremento 5 PR4, version
// corregida tras las rondas de revision del 2026-11-19). PURO -- sin
// Prisma; verificarDeploymentUsaRamaTemporal() recibe un `fetch` mock
// inyectado, nunca toca la red real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  construirPayloadCarga,
  construirResumenEscenario,
  exigirUrlDePrueba,
  PRODUCCION_HOSTS_BLOQUEADOS,
  sondarVarianteCookieReconocidaPorDeployment,
  tieneContratoDeConsultaReconocible,
  verificarDeploymentUsaRamaTemporal,
  type ResultadoAutocannonMinimo,
} from "../cargaConsultasHelpers";
import { listarCatalogoConsultas } from "@/infra/queries/catalogo";
import { CATALOGO_CONSULTA_IDS } from "@/domain/queries/tipos";
import { construirClaimsSesionSintetica, ROL_USUARIO_SINTETICO_CARGA } from "../sesionSinteticaHelpers";

const ENV_AUTORIZACION = "AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL";
const ENV_HOST = "CARGA_CONSULTAS_HOST_CONFIRMADO";
const HOST_DE_PRUEBA_LEGITIMO = "chainpulse-pr4-preview-abc123.vercel.app";

let envAutorizacionOriginal: string | undefined;
let envHostOriginal: string | undefined;

beforeEach(() => {
  envAutorizacionOriginal = process.env[ENV_AUTORIZACION];
  envHostOriginal = process.env[ENV_HOST];
  process.env[ENV_AUTORIZACION] = "si";
  process.env[ENV_HOST] = HOST_DE_PRUEBA_LEGITIMO;
});

afterEach(() => {
  if (envAutorizacionOriginal === undefined) delete process.env[ENV_AUTORIZACION];
  else process.env[ENV_AUTORIZACION] = envAutorizacionOriginal;
  if (envHostOriginal === undefined) delete process.env[ENV_HOST];
  else process.env[ENV_HOST] = envHostOriginal;
});

describe("exigirUrlDePrueba()", () => {
  it("URL https con host confirmado y autorizacion -- no lanza, devuelve la URL", () => {
    const url = exigirUrlDePrueba(`https://${HOST_DE_PRUEBA_LEGITIMO}`);
    expect(url.hostname).toBe(HOST_DE_PRUEBA_LEGITIMO);
  });

  it("rechaza HTTP (no HTTPS), incluso con host confirmado y autorizacion correctos", () => {
    process.env[ENV_HOST] = "localhost:3000";
    expect(() => exigirUrlDePrueba("http://localhost:3000")).toThrow("PROTOCOLO_INSEGURO_http");
  });

  it.each(PRODUCCION_HOSTS_BLOQUEADOS)("bloquea el host de produccion REAL '%s' incluso si alguien lo confirma por error", (host) => {
    process.env[ENV_HOST] = host;
    expect(() => exigirUrlDePrueba(`https://${host}`)).toThrow(`URL_DE_PRODUCCION_BLOQUEADA_${host}`);
  });

  it("la lista de bloqueo contiene el dominio de produccion real del proyecto ('chain-pulse-steel.vercel.app'), no un nombre inventado", () => {
    // Regresion directa del hallazgo de la ronda de revision: la lista
    // anterior usaba "chainpulse.vercel.app"/"chainpulse.com", que
    // nunca existieron -- el proyecto real de Vercel es "chain-pulse".
    expect(PRODUCCION_HOSTS_BLOQUEADOS).toContain("chain-pulse-steel.vercel.app");
  });

  it("la lista de bloqueo contiene el alias adicional agregado en la ronda 2 de revision ('chain-pulse-qgpvsqoge-alex-2477.vercel.app')", () => {
    expect(PRODUCCION_HOSTS_BLOQUEADOS).toContain("chain-pulse-qgpvsqoge-alex-2477.vercel.app");
  });

  it("bloquea un SUBDOMINIO de un host de produccion bloqueado", () => {
    const host = `preview.${PRODUCCION_HOSTS_BLOQUEADOS[0]}`;
    process.env[ENV_HOST] = host;
    expect(() => exigirUrlDePrueba(`https://${host}`)).toThrow(`URL_DE_PRODUCCION_BLOQUEADA_${host}`);
  });

  it("rechaza cuando CARGA_CONSULTAS_HOST_CONFIRMADO no esta fijado, aunque la URL sea legitima", () => {
    delete process.env[ENV_HOST];
    expect(() => exigirUrlDePrueba(`https://${HOST_DE_PRUEBA_LEGITIMO}`)).toThrow("HOST_DE_CARGA_NO_CONFIRMADO");
  });

  it("rechaza cuando CARGA_CONSULTAS_HOST_CONFIRMADO no coincide EXACTAMENTE con el host de la URL", () => {
    process.env[ENV_HOST] = "otro-deployment-distinto.vercel.app";
    expect(() => exigirUrlDePrueba(`https://${HOST_DE_PRUEBA_LEGITIMO}`)).toThrow("HOST_DE_CARGA_NO_CONFIRMADO");
  });

  it("falta la autorizacion puntual -- AUTORIZACION_PR4_RENDIMIENTO_FALTANTE, incluso con host confirmado correcto", () => {
    delete process.env[ENV_AUTORIZACION];
    expect(() => exigirUrlDePrueba(`https://${HOST_DE_PRUEBA_LEGITIMO}`)).toThrow("AUTORIZACION_PR4_RENDIMIENTO_FALTANTE");
  });

  it("la autorizacion con un valor distinto de 'si' exacto -- tampoco cuenta", () => {
    process.env[ENV_AUTORIZACION] = "SI";
    expect(() => exigirUrlDePrueba(`https://${HOST_DE_PRUEBA_LEGITIMO}`)).toThrow("AUTORIZACION_PR4_RENDIMIENTO_FALTANTE");
  });
});

/** Cuerpo RespuestaConsultaOk reconocible completo, para los mocks de
 * fetch de verificarDeploymentUsaRamaTemporal() -- mismo contrato real
 * que route.ts devuelve en un 200 exitoso. */
function cuerpoOkReconocible(catalogoId = "DEPENDENCIA_CRITICA"): Record<string, unknown> {
  return {
    ok: true,
    catalogoId,
    respuestaDirecta: "respuesta de prueba",
    periodo: { inicio: "2026-01-01", fin: "2026-01-31" },
    filtros: {},
    fuente: "fuente de prueba",
    formula: "formula de prueba",
    numerador: 1,
    denominador: 2,
    calidad: { faltantes: [], cobertura: 1 },
    hecho: "hecho de prueba",
    interpretacion: "interpretacion de prueba",
    accion: "accion de prueba",
    comoComprobar: "como comprobar de prueba",
    ruleVersion: "v1",
  };
}

/** Cuerpo RespuestaConsultaSinDatos reconocible (I5-25) -- el OTRO 200
 * valido posible. */
function cuerpoSinDatosReconocible(catalogoId = "DEPENDENCIA_CRITICA"): Record<string, unknown> {
  return {
    ok: false,
    catalogoId,
    error: "SIN_DATOS_SUFICIENTES",
    mensaje: "No puedo responder todavia",
    camposFaltantes: ["algo"],
    comoIngresarlos: "como ingresarlos de prueba",
  };
}

/** Respuesta `fetch` falsa minima -- status + headers.get("content-type")
 * + .json(), nada mas (lo unico que verificarDeploymentUsaRamaTemporal()
 * usa). */
function respuestaFalsa(opciones: { status: number; contentType?: string; cuerpo?: unknown; jsonLanza?: boolean }): Response {
  const { status, contentType = "application/json", cuerpo, jsonLanza = false } = opciones;
  return {
    status,
    headers: { get: (nombre: string) => (nombre.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => {
      if (jsonLanza) throw new SyntaxError("JSON malformado de prueba");
      return cuerpo;
    },
  } as unknown as Response;
}

describe("verificarDeploymentUsaRamaTemporal()", () => {
  const urlBase = new URL("https://chainpulse-pr4-preview-abc123.vercel.app/");
  const cookieSecreta = "next-auth.session-token=valor-secreto-que-nunca-debe-aparecer-en-un-error";

  it("HTTP 200 con contrato RespuestaConsultaOk reconocible -- resuelve sin lanzar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, cuerpo: cuerpoOkReconocible() }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).resolves.toBeUndefined();
  });

  it("HTTP 200 con contrato RespuestaConsultaSinDatos (I5-25) reconocible -- tambien resuelve sin lanzar (es un 200 real valido)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, cuerpo: cuerpoSinDatosReconocible() }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).resolves.toBeUndefined();
  });

  it("pide la ruta ABSOLUTA /api/consultas/ejecutar (nunca relativa), con redirect:'manual', y envia la cookie en el header -- pero nunca la expone en ningun valor de retorno", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, cuerpo: cuerpoOkReconocible() }));
    await verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chainpulse-pr4-preview-abc123.vercel.app/api/consultas/ejecutar");
    expect(opciones.redirect).toBe("manual");
    expect((opciones.headers as Record<string, string>).cookie).toBe(cookieSecreta);
  });

  it("envia el bypass temporal de Vercel cuando se proporciona, sin exponerlo en retornos", async () => {
    const bypass = "v".repeat(32);
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, cuerpo: cuerpoOkReconocible() }));
    await expect(
      verificarDeploymentUsaRamaTemporal(
        fetchMock,
        urlBase,
        cookieSecreta,
        "cadena-sintetica-1",
        bypass,
      ),
    ).resolves.toBeUndefined();
    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((opciones.headers as Record<string, string>)["x-vercel-protection-bypass"]).toBe(bypass);
  });

  it("HTTP 404 (CADENA_INEXISTENTE -- el deployment NO ve la rama temporal sembrada) -- lanza sin incluir la cookie en el mensaje", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 404 }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_STATUS_INESPERADO_404",
    );
  });

  it("cualquier otro status inesperado (ej. 500) tambien invalida la prueba de rama temporal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 500 }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_STATUS_INESPERADO_500",
    );
  });

  // CORRECCION (ronda de revision 3, 2026-11-19, punto 2): con
  // redirect:"manual" (fijado por esta funcion), el `fetch` real nunca
  // sigue una redireccion -- devuelve el 3xx tal cual. Simula aca
  // exactamente ese comportamiento (el mock jamas sigue nada por si
  // mismo, con o sin la opcion): una pagina de proteccion/SSO de Vercel
  // respondiendo 302 queda invalidada por el MISMO chequeo de status
  // que un 404/500, sin necesitar un codigo de error dedicado.
  it("una redireccion (3xx, nunca seguida por redirect:'manual') invalida la sonda igual que cualquier otro status distinto de 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 302 }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_STATUS_INESPERADO_302",
    );
  });

  // CORRECCION (ronda de revision 3, 2026-11-19, punto 2): HTTP 200 con
  // HTML (ej. una pagina de proteccion que por algun motivo respondiera
  // 200 en vez de redirigir) ya NO pasa -- se exige content-type JSON.
  it("HTTP 200 con content-type text/html (pagina generica, nunca la API real) invalida la sonda por content-type, no por status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, contentType: "text/html; charset=utf-8", cuerpo: "<html></html>" }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_CONTENT_TYPE_NO_JSON",
    );
  });

  it("HTTP 200 con content-type JSON pero cuerpo JSON malformado (falla al parsear) invalida la sonda", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, jsonLanza: true }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_JSON_MALFORMADO",
    );
  });

  it("HTTP 200 con JSON valido pero SIN el contrato reconocible de la API real (ej. un mock generico '{ok:true}') invalida la sonda", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, cuerpo: { ok: true } }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_CONTRATO_NO_RECONOCIBLE",
    );
  });

  it("HTTP 200 con JSON de contrato reconocible pero catalogoId distinto del pedido invalida la sonda", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, cuerpo: cuerpoOkReconocible("OTIF_CAIDA") }));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_CONTRATO_NO_RECONOCIBLE",
    );
  });

  it("una falla de red (fetch rechaza) se traduce a un error fijo, nunca el error crudo (que podria filtrar detalles de la URL/cookie)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error inesperado con detalle sensible"));
    await expect(verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1")).rejects.toThrow(
      "SONDA_RAMA_TEMPORAL_FALLO_DE_RED",
    );
  });

  it("ningun mensaje de error producido por esta funcion contiene la cookie, en ningun escenario", async () => {
    const escenarios = [
      vi.fn().mockResolvedValue(respuestaFalsa({ status: 404 })),
      vi.fn().mockResolvedValue(respuestaFalsa({ status: 500 })),
      vi.fn().mockResolvedValue(respuestaFalsa({ status: 302 })),
      vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, contentType: "text/html" })),
      vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, jsonLanza: true })),
      vi.fn().mockResolvedValue(respuestaFalsa({ status: 200, cuerpo: { ok: true } })),
      vi.fn().mockRejectedValue(new Error(cookieSecreta)), // intento adversarial: el error de red "lleva" la cookie
    ];
    for (const fetchMock of escenarios) {
      try {
        await verificarDeploymentUsaRamaTemporal(fetchMock, urlBase, cookieSecreta, "cadena-sintetica-1");
        expect.unreachable("deberia haber lanzado");
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        expect(mensaje).not.toContain(cookieSecreta);
        expect(mensaje).not.toContain("secreto");
      }
    }
  });
});

describe("tieneContratoDeConsultaReconocible()", () => {
  it("acepta el contrato RespuestaConsultaOk completo, con el catalogoId correcto", () => {
    expect(tieneContratoDeConsultaReconocible(cuerpoOkReconocible("DEPENDENCIA_CRITICA"), "DEPENDENCIA_CRITICA")).toBe(true);
  });

  it("acepta el contrato RespuestaConsultaSinDatos (I5-25) completo, con el catalogoId correcto", () => {
    expect(tieneContratoDeConsultaReconocible(cuerpoSinDatosReconocible("DEPENDENCIA_CRITICA"), "DEPENDENCIA_CRITICA")).toBe(true);
  });

  it("rechaza si catalogoId no coincide, aunque el resto del contrato sea correcto", () => {
    expect(tieneContratoDeConsultaReconocible(cuerpoOkReconocible("OTIF_CAIDA"), "DEPENDENCIA_CRITICA")).toBe(false);
  });

  it("rechaza un objeto generico '{ok:true}' sin los campos reales del contrato", () => {
    expect(tieneContratoDeConsultaReconocible({ ok: true, catalogoId: "DEPENDENCIA_CRITICA" }, "DEPENDENCIA_CRITICA")).toBe(false);
  });

  it("rechaza si falta CUALQUIER campo requerido del contrato OK (ej. falta ruleVersion)", () => {
    const cuerpo = cuerpoOkReconocible("DEPENDENCIA_CRITICA");
    delete cuerpo.ruleVersion;
    expect(tieneContratoDeConsultaReconocible(cuerpo, "DEPENDENCIA_CRITICA")).toBe(false);
  });

  it("rechaza null, undefined, un arreglo o un string -- nunca lanza", () => {
    for (const valor of [null, undefined, [1, 2, 3], "no es un objeto", 42]) {
      expect(tieneContratoDeConsultaReconocible(valor, "DEPENDENCIA_CRITICA")).toBe(false);
    }
  });
});

describe("construirResumenEscenario()", () => {
  function resultadoBase(overrides: Partial<ResultadoAutocannonMinimo> = {}): ResultadoAutocannonMinimo {
    return {
      requests: { total: 100 },
      latency: { p50: 120, p97_5: 300, p99: 450, max: 900 },
      errors: 0,
      timeouts: 0,
      statusCodeStats: { "200": { count: 100 } },
      ...overrides,
    };
  }

  it("exito total (100% HTTP 200, suma=total=esperado, sin errores/timeouts, sin temporizador activado) -- medicion valida, sin codigos invalidantes", () => {
    const resumen = construirResumenEscenario(5, resultadoBase(), 100, false);
    expect(resumen.medicionValida).toBe(true);
    expect(resumen.codigosInvalidantesEncontrados).toEqual([]);
    expect(resumen.conteosPorCodigoHttp).toEqual({ "200": 100 });
    expect(resumen.totalSolicitudesEsperadas).toBe(100);
    expect(resumen.temporizadorSeguridadActivado).toBe(false);
  });

  // CORRECCION (ronda 2 de revision, 2026-11-19, punto 3): la lista fija
  // anterior (401/403/429/500/503) NO invalidaba ante 400 ni 404 -- ahora
  // CUALQUIER codigo distinto de 200 invalida, sin excepcion. Se prueba
  // con una muestra amplia que incluye los 2 codigos que la version
  // anterior dejaba pasar (400, 404) ademas de los 5 ya cubiertos.
  it.each([400, 401, 403, 404, 429, 500, 502, 503])("CUALQUIER aparicion de %i invalida la medicion, incluso una sola -- incluye 400/404, que la version anterior NO invalidaba", (codigo) => {
    const resumen = construirResumenEscenario(
      5,
      resultadoBase({ statusCodeStats: { "200": { count: 99 }, [String(codigo)]: { count: 1 } } }),
      100,
      false,
    );
    expect(resumen.medicionValida).toBe(false);
    expect(resumen.codigosInvalidantesEncontrados).toContain(codigo);
  });

  it("cuenta TODOS los codigos HTTP vistos, no solo 200 ni solo los invalidantes", () => {
    const resumen = construirResumenEscenario(
      5,
      resultadoBase({ statusCodeStats: { "200": { count: 80 }, "404": { count: 5 }, "429": { count: 15 } } }),
      100,
      false,
    );
    expect(resumen.conteosPorCodigoHttp).toEqual({ "200": 80, "404": 5, "429": 15 });
    expect(resumen.totalSolicitudes).toBe(100);
  });

  it("la SUMA de statusCodeStats que no coincide con requests.total invalida la medicion, aunque todo lo contado sea 200 (respuestas sin clasificar)", () => {
    const resumen = construirResumenEscenario(
      5,
      resultadoBase({ requests: { total: 100 }, statusCodeStats: { "200": { count: 90 } } }), // faltan 10 sin contar en statusCodeStats
      100,
      false,
    );
    expect(resumen.medicionValida).toBe(false);
    expect(resumen.codigosInvalidantesEncontrados).toEqual([]); // ningun codigo invalidante -- el problema es el hueco, no un codigo malo
  });

  it("errors > 0 invalida la medicion aunque todas las respuestas CONTADAS sean 200", () => {
    const resumen = construirResumenEscenario(5, resultadoBase({ errors: 2 }), 100, false);
    expect(resumen.medicionValida).toBe(false);
  });

  it("timeouts > 0 invalida la medicion aunque todas las respuestas CONTADAS sean 200", () => {
    const resumen = construirResumenEscenario(5, resultadoBase({ timeouts: 1 }), 100, false);
    expect(resumen.medicionValida).toBe(false);
  });

  it("sin ninguna respuesta contada (statusCodeStats vacio) -- nunca medicion valida", () => {
    const resumen = construirResumenEscenario(5, resultadoBase({ requests: { total: 0 }, statusCodeStats: {} }), 100, false);
    expect(resumen.medicionValida).toBe(false);
  });

  // CORRECCION (ronda de revision 3, 2026-11-19, punto 1): "corrida
  // parcial marcada como valida" -- requests.total menor que lo
  // esperado invalida la medicion AUNQUE todo lo contado haya sido 200,
  // suma completa, sin errores ni timeouts (las 4 condiciones de la
  // ronda 2, por si solas, la hubieran declarado valida).
  it("requests.total menor que totalEsperado invalida la medicion -- corrida incompleta, aunque TODO lo contado haya sido 200", () => {
    const resumen = construirResumenEscenario(
      5,
      resultadoBase({ requests: { total: 80 }, statusCodeStats: { "200": { count: 80 } } }),
      100, // se esperaban 100, solo se completaron 80
      false,
    );
    expect(resumen.medicionValida).toBe(false);
    expect(resumen.totalSolicitudes).toBe(80);
    expect(resumen.totalSolicitudesEsperadas).toBe(100);
    // El diagnostico se conserva -- nunca se pierde la info de cuanto
    // se complete realmente, aunque la medicion sea invalida.
    expect(resumen.codigosInvalidantesEncontrados).toEqual([]); // ningun codigo malo -- el problema es que faltaron solicitudes
  });

  it("temporizadorSeguridadActivado=true invalida la medicion aunque requests.total YA haya alcanzado totalEsperado y todo sea 200", () => {
    const resumen = construirResumenEscenario(5, resultadoBase(), 100, true);
    expect(resumen.medicionValida).toBe(false);
    expect(resumen.temporizadorSeguridadActivado).toBe(true);
  });

  it("nunca incluye ningun campo relacionado a cookie/sesion (el objeto de autocannon no las expone, y esta funcion tampoco las agrega)", () => {
    const resumen = construirResumenEscenario(5, resultadoBase(), 100, false);
    const claves = Object.keys(resumen);
    expect(claves).toEqual([
      "concurrencia",
      "totalSolicitudes",
      "p50Ms",
      "p97_5Ms",
      "p99Ms",
      "maxMs",
      "conteosPorCodigoHttp",
      "erroresTransporte",
      "timeouts",
      "medicionValida",
      "codigosInvalidantesEncontrados",
      "totalSolicitudesEsperadas",
      "temporizadorSeguridadActivado",
    ]);
    expect(JSON.stringify(resumen).toLowerCase()).not.toContain("cookie");
  });

  it("p97_5Ms nunca se llama p95Ms (regresion directa del hallazgo de la ronda 2: autocannon no entrega p95 real)", () => {
    const resumen = construirResumenEscenario(5, resultadoBase(), 100, false);
    expect(resumen).not.toHaveProperty("p95Ms");
    expect(resumen.p97_5Ms).toBe(300); // el p97_5 de resultadoBase()
  });
});

describe("construirPayloadCarga()", () => {
  it("las 4 preguntas que SI requieren periodo (coincide EXACTAMENTE con metadatos.requierePeriodo del catalogo real, catalogo.ts -- cross-check contra drift) incluyen periodoInicio/periodoFin", () => {
    const catalogoReal = listarCatalogoConsultas();
    for (const entrada of catalogoReal) {
      const payload = construirPayloadCarga(entrada.id, "cadena-1");
      if (entrada.requierePeriodo) {
        expect(payload).toHaveProperty("periodoInicio", "2026-01-01");
        expect(payload).toHaveProperty("periodoFin", "2026-01-31");
      } else {
        expect(payload).not.toHaveProperty("periodoInicio");
        expect(payload).not.toHaveProperty("periodoFin");
      }
    }
  });

  it("cubre las 6 preguntas reales (ninguna falta, ninguna sobra -- mismo universo que CATALOGO_CONSULTA_IDS)", () => {
    expect(CATALOGO_CONSULTA_IDS).toHaveLength(6);
    for (const catalogoId of CATALOGO_CONSULTA_IDS) {
      expect(() => construirPayloadCarga(catalogoId, "cadena-1")).not.toThrow();
    }
  });

  it("siempre incluye catalogoId y cadenaId tal cual se le pasaron", () => {
    const payload = construirPayloadCarga("DEPENDENCIA_CRITICA", "cadena-xyz");
    expect(payload.catalogoId).toBe("DEPENDENCIA_CRITICA");
    expect(payload.cadenaId).toBe("cadena-xyz");
  });
});


// Investigacion (Alex, 2026-11-20, ronda de seguimiento): "Considera
// una sonda acotada que emita ambas variantes de cookie, cada una
// cifrada con su propio nombre como salt, para identificar
// empiricamente cual reconoce el Preview sin debilitar la compuerta."
// Estas pruebas NUNCA tocan red real -- fetchImpl se inyecta mockeado,
// mismo patron que verificarDeploymentUsaRamaTemporal() arriba.
describe("sondarVarianteCookieReconocidaPorDeployment()", () => {
  const SECRETO_DE_PRUEBA_SONDA = "secreto-descartable-unicamente-para-la-sonda-de-variante-de-cookie";
  const claims = construirClaimsSesionSintetica({
    id: "usuario-sonda-variante",
    email: "usuario-sonda-variante@chainpulse-pr4-rendimiento-sintetico.invalid",
    nombre: "Usuario sintetico de la sonda de variante de cookie",
    empresaId: "empresa-sonda",
    rol: ROL_USUARIO_SINTETICO_CARGA,
    eslabonId: null,
    mfaHabilitado: false,
    sessionVersion: 1,
  });

  /** fetchMock que decide la respuesta SEGUN el nombre de cookie
   * recibido -- nunca inspecciona el valor del JWT, solo que nombre de
   * cookie llego en el header `cookie` (igual que un servidor real de
   * Auth.js: lo que importa es el NOMBRE, el servidor ni intenta
   * descifrar si el nombre ya no coincide con lo que espera). */
  function construirFetchMockQueReconoce(nombreCookieQueReconoce: string | null): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation(async (_url: string, opciones: RequestInit) => {
      const cookieEnviada = (opciones.headers as Record<string, string>).cookie ?? "";
      const reconocida = nombreCookieQueReconoce !== null && cookieEnviada.startsWith(`${nombreCookieQueReconoce}=`);
      return reconocida
        ? respuestaFalsa({ status: 200, cuerpo: cuerpoOkReconocible() })
        : respuestaFalsa({ status: 401 });
    });
  }

  it("variante HTTPS reconocida, HTTP no -- exactamente el caso de un deployment que resuelve useSecureCookies=true", async () => {
    const fetchMock = construirFetchMockQueReconoce("__Secure-authjs.session-token");
    const resultado = await sondarVarianteCookieReconocidaPorDeployment(
      fetchMock,
      `https://${HOST_DE_PRUEBA_LEGITIMO}`,
      SECRETO_DE_PRUEBA_SONDA,
      claims,
      "cadena-sintetica-sonda",
    );
    expect(resultado.https.reconocida).toBe(true);
    expect(resultado.https.statusHttp).toBe(200);
    expect(resultado.http.reconocida).toBe(false);
    expect(resultado.http.statusHttp).toBe(401);
  });

  it("variante HTTP reconocida, HTTPS no -- simetrico: un deployment que resuelve useSecureCookies=false", async () => {
    const fetchMock = construirFetchMockQueReconoce("authjs.session-token");
    const resultado = await sondarVarianteCookieReconocidaPorDeployment(
      fetchMock,
      `https://${HOST_DE_PRUEBA_LEGITIMO}`,
      SECRETO_DE_PRUEBA_SONDA,
      claims,
      "cadena-sintetica-sonda",
    );
    expect(resultado.https.reconocida).toBe(false);
    expect(resultado.https.statusHttp).toBe(401);
    expect(resultado.http.reconocida).toBe(true);
    expect(resultado.http.statusHttp).toBe(200);
  });

  it("NINGUNA variante reconocida (ambas 401) -- nunca se declara 'reconocida' por descarte; esto es la senal de que la causa NO es (solo) el salt, sino otra cosa (secreto incorrecto, sessionVersion, conexion a base) que esta sonda NUNCA debe ocultar colapsando ambos resultados en uno", async () => {
    const fetchMock = construirFetchMockQueReconoce(null);
    const resultado = await sondarVarianteCookieReconocidaPorDeployment(
      fetchMock,
      `https://${HOST_DE_PRUEBA_LEGITIMO}`,
      SECRETO_DE_PRUEBA_SONDA,
      claims,
      "cadena-sintetica-sonda",
    );
    expect(resultado.https.reconocida).toBe(false);
    expect(resultado.http.reconocida).toBe(false);
  });

  it("hace EXACTAMENTE 2 peticiones en total -- nunca mas, nunca reintenta, nunca escala: es diagnostico puntual, nunca carga", async () => {
    const fetchMock = construirFetchMockQueReconoce("__Secure-authjs.session-token");
    await sondarVarianteCookieReconocidaPorDeployment(
      fetchMock,
      `https://${HOST_DE_PRUEBA_LEGITIMO}`,
      SECRETO_DE_PRUEBA_SONDA,
      claims,
      "cadena-sintetica-sonda",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propaga el bypass temporal a las DOS variantes y nunca lo incluye en el resultado", async () => {
    const bypass = "p".repeat(32);
    const fetchMock = construirFetchMockQueReconoce("__Secure-authjs.session-token");
    const resultado = await sondarVarianteCookieReconocidaPorDeployment(
      fetchMock,
      `https://${HOST_DE_PRUEBA_LEGITIMO}`,
      SECRETO_DE_PRUEBA_SONDA,
      claims,
      "cadena-sintetica-sonda",
      bypass,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, opciones] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect((opciones.headers as Record<string, string>)["x-vercel-protection-bypass"]).toBe(bypass);
    }
    expect(JSON.stringify(resultado)).not.toContain(bypass);
  });

  it("reutiliza la MISMA compuerta exigirUrlDePrueba() -- un host de produccion bloqueado lanza ANTES de hacer ninguna peticion, nunca la bypasea ni la relaja", async () => {
    const fetchMock = vi.fn();
    const hostBloqueado = PRODUCCION_HOSTS_BLOQUEADOS[0]!;
    process.env[ENV_HOST] = hostBloqueado;
    await expect(
      sondarVarianteCookieReconocidaPorDeployment(
        fetchMock,
        `https://${hostBloqueado}`,
        SECRETO_DE_PRUEBA_SONDA,
        claims,
        "cadena-sintetica-sonda",
      ),
    ).rejects.toThrow(`URL_DE_PRODUCCION_BLOQUEADA_${hostBloqueado}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el resultado nunca incluye el valor de ninguna cookie ni del cuerpo de la respuesta -- solo booleano + codigo HTTP por variante", async () => {
    const fetchMock = construirFetchMockQueReconoce("__Secure-authjs.session-token");
    const resultado = await sondarVarianteCookieReconocidaPorDeployment(
      fetchMock,
      `https://${HOST_DE_PRUEBA_LEGITIMO}`,
      SECRETO_DE_PRUEBA_SONDA,
      claims,
      "cadena-sintetica-sonda",
    );
    expect(Object.keys(resultado.https).sort()).toEqual(["reconocida", "statusHttp"]);
    expect(Object.keys(resultado.http).sort()).toEqual(["reconocida", "statusHttp"]);
  });
});
