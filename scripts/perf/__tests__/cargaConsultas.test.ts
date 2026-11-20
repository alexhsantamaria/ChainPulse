// Pruebas del RUNNER REAL (Incremento 5 PR4, ronda de revision 2 de
// Alex, 2026-11-19, punto 2: "Agrega pruebas del runner real -- no
// solamente de los helpers -- que verifiquen: asignacion de cookies;
// ausencia de reutilizacion; cobertura de las seis preguntas; numero
// maximo total por cookie; reconexion sin desbordar el arreglo.").
//
// Corren correrUnaConcurrencia() (scripts/perf/cargaConsultas.ts) CONTRA
// EL AUTOCANNON REAL (nunca mockeado) y un servidor HTTP real en
// 127.0.0.1 (node:http, puerto efimero) -- nunca contra una URL externa
// ni produccion. No depende de env vars de Neon/Vercel ni abre ninguna
// conexion Postgres: solo prueba el runner HTTP en si, con cookies
// sinteticas fijas construidas aca mismo (nunca mintadas de verdad --
// el runner no distingue el contenido de la cookie, solo la reenvia).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";

vi.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClientMock {},
}));

import {
  correrUnaConcurrencia,
  resolverBypassProteccionVercelDesdeEnv,
  resolverUsaCookiesSegurasDesdeEnv,
} from "../cargaConsultas";
import { CATALOGO_CONSULTA_IDS } from "../../../src/domain/queries/tipos";

interface PeticionRecibida {
  cookie: string | undefined;
  catalogoId: string | undefined;
  bypassProteccionVercel: string | undefined;
}

interface ServidorDePrueba {
  server: Server;
  urlBase: URL;
  peticiones: PeticionRecibida[];
}

/** Servidor HTTP real minimo: registra cookie+catalogoId de cada
 * peticion recibida; responde 200 siempre, salvo `nuncaResponder`
 * (nunca llama res.end() -- simula un servidor colgado, para probar la
 * red de seguridad de reloj de pared). */
function iniciarServidorDePrueba(
  opciones: { nuncaResponder?: boolean; dejarDeResponderDespuesDe?: number } = {},
): Promise<ServidorDePrueba> {
  const peticiones: PeticionRecibida[] = [];
  let respondidas = 0;
  const server = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (parte: Buffer) => partes.push(parte));
    req.on("end", () => {
      let cuerpo: Record<string, unknown> = {};
      try {
        cuerpo = JSON.parse(Buffer.concat(partes).toString("utf-8") || "{}") as Record<string, unknown>;
      } catch {
        // Ignorado -- un cuerpo no parseable no deberia pasar en estas
        // pruebas (siempre lo construye construirPayloadCarga()), pero
        // nunca debe tirar el servidor de prueba si pasara.
      }
      peticiones.push({
        cookie: req.headers.cookie,
        catalogoId: typeof cuerpo.catalogoId === "string" ? cuerpo.catalogoId : undefined,
        bypassProteccionVercel:
          typeof req.headers["x-vercel-protection-bypass"] === "string"
            ? req.headers["x-vercel-protection-bypass"]
            : undefined,
      });
      if (opciones.nuncaResponder) return; // nunca responde -- simula un colgado
      // CORRECCION (ronda de revision 3, 2026-11-19, punto 1): simula una
      // corrida PARCIAL -- responde 200 limpio a las primeras N
      // solicitudes totales (contando TODAS las conexiones, no por
      // conexion) y despues se cuelga (nunca responde) en el resto, sin
      // cerrar la conexion ni devolver ningun error -- exactamente el
      // escenario que `construirResumenEscenario()` debe invalidar via
      // `totalEsperado`/`temporizadorSeguridadActivado`, nunca via un
      // codigo HTTP malo (todas las respuestas que SI llegan son 200).
      if (
        opciones.dejarDeResponderDespuesDe !== undefined &&
        respondidas >= opciones.dejarDeResponderDespuesDe
      ) {
        return;
      }
      respondidas += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const direccion = server.address();
      if (direccion === null || typeof direccion === "string") {
        reject(new Error("DIRECCION_DE_SERVIDOR_DE_PRUEBA_INESPERADA"));
        return;
      }
      resolve({ server, urlBase: new URL(`http://127.0.0.1:${direccion.port}/`), peticiones });
    });
  });
}

function cerrarServidor(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("correrUnaConcurrencia (runner real, servidor HTTP real, autocannon real)", () => {
  let servidorActual: Server | undefined;

  afterEach(async () => {
    if (servidorActual) {
      await cerrarServidor(servidorActual);
      servidorActual = undefined;
    }
  });

  it("asigna una cookie DISTINTA por conexion, sin reutilizar ninguna, con el maximo EXACTO de solicitudes por cookie (via `amount`) y cobertura real de las 6 preguntas por cookie", async () => {
    const { server, urlBase, peticiones } = await iniciarServidorDePrueba();
    servidorActual = server;

    const cookies = ["cookie-conexion-A", "cookie-conexion-B", "cookie-conexion-C"];
    const maxPorConexion = 6; // exactamente 1 ciclo de las 6 preguntas

    const resumen = await correrUnaConcurrencia(urlBase, cookies, "cadena-de-prueba", cookies.length, maxPorConexion, 30);

    // Maximo total EXACTO por cookie -- ni una mas, ni una menos.
    const conteosPorCookie = new Map<string, number>();
    for (const peticion of peticiones) {
      if (peticion.cookie === undefined) continue;
      conteosPorCookie.set(peticion.cookie, (conteosPorCookie.get(peticion.cookie) ?? 0) + 1);
    }

    // Asignacion de cookies + ausencia de reutilizacion: exactamente las
    // 3 cookies dadas aparecen, ninguna otra, cada una EXACTAMENTE
    // maxPorConexion veces (si alguna se hubiera reutilizado en 2
    // conexiones, su conteo excederia maxPorConexion; si alguna se
    // hubiera saltado, su conteo seria 0 -- ninguno de los 2 casos pasa
    // este assert).
    expect(new Set(conteosPorCookie.keys())).toEqual(new Set(cookies));
    for (const cookie of cookies) {
      expect(conteosPorCookie.get(cookie)).toBe(maxPorConexion);
    }
    expect(peticiones).toHaveLength(cookies.length * maxPorConexion);

    // Cobertura real de las 6 preguntas -- POR CADA cookie, no solo en
    // total (Alex, ronda 1: "incluso concurrencia=1 ejercita las 6").
    for (const cookie of cookies) {
      const catalogoIdsDeEstaCookie = new Set(
        peticiones.filter((p) => p.cookie === cookie).map((p) => p.catalogoId),
      );
      expect(catalogoIdsDeEstaCookie).toEqual(new Set(CATALOGO_CONSULTA_IDS));
    }

    // Con el servidor respondiendo 200 a todo, la medicion debe ser
    // valida (ver construirResumenEscenario()).
    expect(resumen.medicionValida).toBe(true);
    expect(resumen.totalSolicitudes).toBe(cookies.length * maxPorConexion);
    expect(resumen.codigosInvalidantesEncontrados).toEqual([]);
  }, 20_000);

  it("`amount` = maxPorConexion * concurrencia reparte el mismo numero EXACTO a cada conexion sin importar la concurrencia (probado con una concurrencia distinta, no multiplo de la anterior)", async () => {
    const { server, urlBase, peticiones } = await iniciarServidorDePrueba();
    servidorActual = server;

    const cookies = ["cookie-1", "cookie-2", "cookie-3", "cookie-4", "cookie-5"];
    const maxPorConexion = 12; // 2 ciclos completos de las 6 preguntas

    await correrUnaConcurrencia(urlBase, cookies, "cadena-de-prueba", cookies.length, maxPorConexion, 30);

    const conteosPorCookie = new Map<string, number>();
    for (const peticion of peticiones) {
      if (peticion.cookie === undefined) continue;
      conteosPorCookie.set(peticion.cookie, (conteosPorCookie.get(peticion.cookie) ?? 0) + 1);
    }
    expect(conteosPorCookie.size).toBe(5);
    for (const cookie of cookies) {
      expect(conteosPorCookie.get(cookie)).toBe(maxPorConexion);
    }
  }, 20_000);

  it("reconexion (reconnectRate) nunca desborda ni reindexa el arreglo de cookies -- el mismo numero EXACTO de conexiones/cookies se usa, cada una sigue recibiendo su propio tope exacto (aunque las stats del propio autocannon subcuenten bajo reconexion -- ver hallazgo mas abajo)", async () => {
    const { server, urlBase, peticiones } = await iniciarServidorDePrueba();
    servidorActual = server;

    const cookies = ["cookie-reconexion-X", "cookie-reconexion-Y"];
    const maxPorConexion = 6;

    // reconnectRate=2: cada conexion resetea su conexion TCP cada 2
    // solicitudes (_resetConnection() en autocannon/lib/httpClient.js)
    // -- NUNCA vuelve a llamar setupClient (confirmado leyendo esa
    // funcion: solo _destroyConnection() + _connect(), el mismo Client
    // y el mismo cookie ya capturado en su clausura). Si
    // indiceConexion pudiera avanzar en un reconnect, este test lo
    // detectaria: aparecerian mas de 2 cookies distintas, o alguna de
    // las 2 con un conteo distinto de maxPorConexion.
    const resumen = await correrUnaConcurrencia(
      urlBase,
      cookies,
      "cadena-de-prueba",
      cookies.length,
      maxPorConexion,
      30,
      { reconnectRate: 2 },
    );

    const conteosPorCookie = new Map<string, number>();
    for (const peticion of peticiones) {
      if (peticion.cookie === undefined) continue;
      conteosPorCookie.set(peticion.cookie, (conteosPorCookie.get(peticion.cookie) ?? 0) + 1);
    }

    expect(new Set(conteosPorCookie.keys())).toEqual(new Set(cookies));
    for (const cookie of cookies) {
      expect(conteosPorCookie.get(cookie)).toBe(maxPorConexion);
    }
    // Lo que este test verifica de verdad (asignacion de cookies / sin
    // desborde / sin reindexado con reconexiones) queda probado arriba
    // por el log del SERVIDOR (`peticiones`, nunca por las stats de
    // autocannon) -- las 12 solicitudes reales (2 cookies x 6) llegaron
    // y cada una a la cookie correcta.
    expect(peticiones).toHaveLength(cookies.length * maxPorConexion);

    // HALLAZGO EMPIRICO (ronda de revision 3, 2026-11-19, al corregir el
    // punto 1 -- "corrida parcial marcada como valida"): con
    // `reconnectRate` activo, autocannon pierde sus PROPIAS estadisticas
    // (`requests.total`/`statusCodeStats`) de la respuesta que dispara
    // cada reconexion -- `kOnMessageComplete` en
    // node_modules/autocannon/lib/httpClient.js retorna temprano
    // (`return this._resetConnection()`) ANTES de llamar
    // `requestIterator.recordBody()` y de emitir `'response'` cuando
    // `reqsMade % reconnectRate === 0`, para ESA respuesta puntual --
    // aunque el servidor SI la recibio y SI respondio 200 (confirmado
    // aca: el servidor registro las 12 solicitudes reales en
    // `peticiones`, pero autocannon solo contabilizo 6 en sus propias
    // stats, exactamente la mitad, consistente con reconnectRate=2
    // descartando el conteo de 1 de cada 2). Es un comportamiento del
    // AUTOCANNON REAL, no de nuestro codigo -- y nunca afecta la corrida
    // real de PR4 (`reconnectRate` es `opcionesAdicionalesSoloPrueba`,
    // SOLO para pruebas; `main()` nunca lo fija). Por eso la correccion
    // del punto 1 (exigir `requests.total === totalEsperado`) hace que
    // ESTA medicion quede, correctamente, invalida por incompleta --
    // la version anterior (ronda 2) la declaraba valida por pura
    // coincidencia (statusCodeStats sumaba lo mismo que requests.total,
    // aunque ambos ya venian subcontados por igual).
    expect(resumen.totalSolicitudes).toBe(6); // autocannon subcuenta -- nunca el conteo real (12) del servidor
    expect(resumen.totalSolicitudesEsperadas).toBe(cookies.length * maxPorConexion); // 12
    expect(resumen.temporizadorSeguridadActivado).toBe(false); // no fue la red de seguridad -- termino sola, solo que subcontada
    expect(resumen.codigosInvalidantesEncontrados).toEqual([]); // ningun codigo malo -- todo lo contado fue 200
    expect(resumen.medicionValida).toBe(false);
  }, 20_000);

  it("la red de seguridad de reloj de pared (`limiteSeguridadSegundos`) termina la corrida aunque el servidor nunca responda -- nunca se queda colgada para siempre, y la medicion resultante queda invalida", async () => {
    const { server, urlBase } = await iniciarServidorDePrueba({ nuncaResponder: true });
    servidorActual = server;

    const inicio = Date.now();
    const resumen = await correrUnaConcurrencia(urlBase, ["cookie-colgada"], "cadena-de-prueba", 1, 6, 1);
    const duracionMs = Date.now() - inicio;

    // Debe resolver (nunca colgarse) cerca del limite de seguridad
    // (1s), nunca esperar a los 6 timeouts individuales de autocannon
    // (10s cada uno por defecto = podria tardar mucho mas sin esta red
    // de seguridad).
    expect(duracionMs).toBeLessThan(8_000);

    // Ninguna respuesta llego nunca -- requests.total (= completadas,
    // ver aggregateResult.js de autocannon) queda en 0, por lo que
    // construirResumenEscenario() invalida la medicion por la misma
    // regla que una corrida sin ninguna respuesta contada (sumaConteos>0
    // exigido) -- nunca se presentan percentiles de una corrida que
    // nunca completo ni una sola solicitud.
    expect(resumen.medicionValida).toBe(false);
    expect(resumen.totalSolicitudes).toBe(0);
    // CORRECCION (ronda de revision 3, 2026-11-19, punto 1): el
    // temporizador de seguridad SI se activo -- registrado
    // explicitamente, nunca inferido a partir de totalSolicitudes.
    expect(resumen.temporizadorSeguridadActivado).toBe(true);
    expect(resumen.totalSolicitudesEsperadas).toBe(6); // maxPorConexion(6) * concurrencia(1)
  }, 15_000);

  // CORRECCION (ronda de revision 3, 2026-11-19, punto 1 -- bloqueo
  // funcional explicito de Alex): "corrida parcial marcada como
  // valida". Antes de esta ronda, construirResumenEscenario() validaba
  // una corrida basandose UNICAMENTE en lo que se llego a contar (todo
  // 200, suma completa, sin errores/timeouts) -- sin ninguna forma de
  // detectar que el temporizador de seguridad la corto ANTES de llegar
  // al `amount` esperado. Este test reproduce exactamente ese
  // escenario contra un servidor real: responde 200 limpio a una
  // fraccion de las solicitudes y despues se cuelga silenciosamente en
  // el resto (nunca un error, nunca un codigo distinto de 200) -- la
  // medicion debe terminar (gracias a la red de seguridad) y quedar
  // invalida por INCOMPLETA, nunca por un codigo HTTP malo.
  it("corrida parcial (el servidor responde 200 a una parte y luego se cuelga en el resto) termina por la red de seguridad y queda invalida por incompleta, NUNCA marcada como valida", async () => {
    const maxPorConexion = 6; // amount = 6 * 1 = 6 solicitudes esperadas
    const respondidasAntesDeColgarse = 3; // menos de la mitad
    const { server, urlBase, peticiones } = await iniciarServidorDePrueba({
      dejarDeResponderDespuesDe: respondidasAntesDeColgarse,
    });
    servidorActual = server;

    const inicio = Date.now();
    const resumen = await correrUnaConcurrencia(urlBase, ["cookie-parcial"], "cadena-de-prueba", 1, maxPorConexion, 1);
    const duracionMs = Date.now() - inicio;

    // Termina por la red de seguridad (limiteSeguridadSegundos=1s),
    // nunca se queda colgada esperando las solicitudes restantes.
    expect(duracionMs).toBeLessThan(8_000);

    // Las primeras `respondidasAntesDeColgarse` solicitudes SI llegaron
    // y recibieron 200 limpio -- esto es exactamente lo que hacia que
    // la version anterior (ronda 2) declarara la medicion valida.
    expect(peticiones.length).toBeGreaterThanOrEqual(respondidasAntesDeColgarse);
    expect(resumen.conteosPorCodigoHttp).toEqual({ "200": respondidasAntesDeColgarse });
    expect(resumen.codigosInvalidantesEncontrados).toEqual([]); // ningun codigo malo -- el problema es la corrida incompleta

    // El nucleo de la correccion: incompleta + temporizador activado =>
    // SIEMPRE invalida, sin importar que todo lo contado fuera 200.
    expect(resumen.totalSolicitudes).toBe(respondidasAntesDeColgarse);
    expect(resumen.totalSolicitudesEsperadas).toBe(maxPorConexion);
    expect(resumen.totalSolicitudes).toBeLessThan(resumen.totalSolicitudesEsperadas);
    expect(resumen.temporizadorSeguridadActivado).toBe(true);
    expect(resumen.medicionValida).toBe(false);
  }, 15_000);

  it("lanza ASIGNACION_DE_COOKIES_INCONSISTENTE_CON_CONCURRENCIA si la cantidad de cookies no coincide con la concurrencia -- nunca arranca autocannon con un reparto incoherente", async () => {
    const urlBase = new URL("http://127.0.0.1:1/"); // nunca se usa -- falla antes de conectar
    await expect(
      correrUnaConcurrencia(urlBase, ["solo-una-cookie"], "cadena-de-prueba", 3, 6, 30),
    ).rejects.toThrow("ASIGNACION_DE_COOKIES_INCONSISTENTE_CON_CONCURRENCIA");
  });

  it("envia el bypass temporal de Vercel en TODAS las solicitudes sin incluirlo en el resumen", async () => {
    const { server, urlBase, peticiones } = await iniciarServidorDePrueba();
    servidorActual = server;
    const bypass = "b".repeat(32);

    const resumen = await correrUnaConcurrencia(
      urlBase,
      ["cookie-bypass"],
      "cadena-de-prueba",
      1,
      6,
      30,
      { bypassProteccionVercel: bypass },
    );

    expect(peticiones).toHaveLength(6);
    expect(peticiones.every((peticion) => peticion.bypassProteccionVercel === bypass)).toBe(true);
    expect(JSON.stringify(resumen)).not.toContain(bypass);
  }, 20_000);
});


// Investigacion (Alex, 2026-11-20, ronda de seguimiento, punto 3):
// "Agrega una prueba del comportamiento del runner con
// CARGA_CONSULTAS_USA_COOKIES_SEGURAS=true y false, incluyendo
// validacion estricta de la variable." Extraida de main() a
// resolverUsaCookiesSegurasDesdeEnv() (cargaConsultas.ts) para poder
// probarla sin invocar main() completo (que abre una conexion real a
// Postgres) -- pura, sincrona, sin red ni DB.
describe("resolverUsaCookiesSegurasDesdeEnv()", () => {
  it("sin la variable (undefined) -- asume true (comportamiento previo a esta correccion, preservado por defecto)", () => {
    expect(resolverUsaCookiesSegurasDesdeEnv(undefined)).toBe(true);
  });

  it('"true" explicito -- true', () => {
    expect(resolverUsaCookiesSegurasDesdeEnv("true")).toBe(true);
  });

  it('"false" explicito -- false', () => {
    expect(resolverUsaCookiesSegurasDesdeEnv("false")).toBe(false);
  });

  it.each(["TRUE", "False", "1", "0", "si", "no", "", " true", "true "])(
    "valor no reconocido %j -- lanza VALOR_INVALIDO_CARGA_CONSULTAS_USA_COOKIES_SEGURAS_<valor>, NUNCA asume un valor por defecto en silencio",
    (valorCrudo) => {
      expect(() => resolverUsaCookiesSegurasDesdeEnv(valorCrudo)).toThrow(
        `VALOR_INVALIDO_CARGA_CONSULTAS_USA_COOKIES_SEGURAS_${valorCrudo}`,
      );
    },
  );
});

describe("resolverBypassProteccionVercelDesdeEnv()", () => {
  it("sin variable conserva compatibilidad con previews no protegidos", () => {
    expect(resolverBypassProteccionVercelDesdeEnv(undefined)).toBeUndefined();
  });

  it("acepta exactamente 32 caracteres sin transformarlos", () => {
    const bypass = "a".repeat(32);
    expect(resolverBypassProteccionVercelDesdeEnv(bypass)).toBe(bypass);
  });

  it.each(["", " ".repeat(32), "corto", "x".repeat(31), "x".repeat(33)])(
    "rechaza %j con un error fijo que nunca refleja el valor",
    (valor) => {
      expect(() => resolverBypassProteccionVercelDesdeEnv(valor)).toThrow(
        "VALOR_INVALIDO_CARGA_CONSULTAS_VERCEL_BYPASS",
      );
      try {
        resolverBypassProteccionVercelDesdeEnv(valor);
      } catch (error) {
        expect(String(error)).not.toContain(valor || "valor-imposible");
      }
    },
  );
});
