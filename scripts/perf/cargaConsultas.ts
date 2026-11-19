// Script INERTE -- prueba de carga de POST /api/consultas/ejecutar con
// `autocannon`, rotando las 6 preguntas del catalogo cerrado, midiendo
// p50/p97.5/p99 contra el objetivo "<5 segundos" (Incremento 5 PR4,
// Alex, 2026-11-19).
//
// INERTE A PROPOSITO -- ver el mismo aviso que semillaSinteticaConsultas.ts
// y explicarConsultas.ts: esta ronda SOLO autoriza crear/corregir este
// script, nunca ejecutarlo. No se corrio ni una sola vez.
//
// REDISEÑO COMPLETO (ronda de revision 1, 2026-11-19) sobre la version
// original -- ver el historial de ese rediseño en versiones previas de
// este archivo/project doc: compuerta positiva de URL, sesiones
// independientes por conexion, tope de solicitudes conservador,
// cobertura real de las 6 preguntas por conexion, invalidacion por
// codigo HTTP.
//
// CORRECCIONES (ronda 2 de revision, 2026-11-19) -- 2 fallas reales mas
// que esa revision encontro sobre el diseno de la ronda 1:
//
//   1. ("la siembra solo crea Empresa y Cadena, pero la carga por
//      defecto necesita 26 cookies independientes... obtenidas a
//      mano, iniciando sesion una vez por cada una en el navegador" --
//      mecanismo manual, no reproducible). Reemplazado por completo:
//      este script ya NUNCA lee CARGA_CONSULTAS_COOKIES_SESION ni pide
//      cookies a mano. En su lugar:
//        a. Lee los usuarios sinteticos que semillaSinteticaConsultas.ts
//           ya creo para la escala pedida (--escala=, con el ROL OWNER
//           de SEED_DATABASE_URL, bypassando RLS -- mismo patron que
//           explicarConsultas.ts usa para resolver ids, nunca para
//           EXPLAIN/carga real).
//        b. Minta sus cookies de sesion EN MEMORIA, con next-auth/jwt
//           encode() (la MISMA funcion que usa Auth.js para emitir una
//           sesion real -- ver mintarCookieSesionSintetica(),
//           sesionSinteticaHelpers.ts), usando CARGA_CONSULTAS_NEXTAUTH_SECRET
//           (debe ser EXACTAMENTE el NEXTAUTH_SECRET de ese deployment
//           -- ver auth.ts, `secret: process.env.NEXTAUTH_SECRET`; sin
//           coincidir, el deployment no podra descifrar el JWT y toda
//           sesion resultara 401, lo cual medicionValida ya detecta).
//        c. NUNCA imprime, persiste ni incluye ninguna cookie en los
//           resultados (ni en consola ni en el JSON escrito a disco) --
//           las cookies viven unicamente en variables locales de esta
//           corrida del proceso, nunca en un archivo ni en
//           ResumenEscenarioCarga (que estructuralmente no tiene forma
//           de contenerlas, ver cargaConsultasHelpers.ts).
//        La conexion owner se cierra (`$disconnect()`) ANTES de
//        arrancar cualquier carga HTTP -- nunca se mantiene abierta
//        durante la corrida.
//
//   2. `maxConnectionRequests` limita UNA conexion FISICA de autocannon;
//      aunque la lectura del codigo fuente de autocannon@9 (run.js/
//      httpClient.js) no muestra que este reemplace una conexion
//      destruida ni vuelva a invocar setupClient (ver comentario en
//      correrUnaConcurrencia() mas abajo), Alex pidio una garantia
//      DEMOSTRABLE, no un argumento de lectura de codigo: "Rediseña la
//      corrida para garantizar un maximo total exacto de solicitudes
//      por cookie, mediante `amount` u otra estrategia demostrablemente
//      acotada." Corregido con `amount` (nunca `maxConnectionRequests`):
//      autocannon reparte `amount` entre las `connections` con
//      distributeNums() (node_modules/autocannon/lib/run.js) --
//      `floor(amount/connections) + 1 extra para los primeros (amount %
//      connections) clientes`. Para que CADA conexion reciba EXACTAMENTE
//      MAX_SOLICITUDES_POR_CONEXION_POR_CORRIDA (nunca una mas, nunca
//      una menos, nunca un reparto desigual), `amount` se fija a
//      MAX_SOLICITUDES_POR_CONEXION_POR_CORRIDA * concurrencia -- al
//      ser multiplo exacto de `connections`, el resto de la division es
//      0 y distributeNums() da el mismo numero a las `concurrencia`
//      conexiones, sin excepcion. Probado contra un servidor HTTP real
//      y el autocannon REAL (nunca mockeado) en
//      __tests__/cargaConsultas.test.ts -- ver ese archivo para las 5
//      propiedades que Alex pidio probar explicitamente: asignacion de
//      cookies, ausencia de reutilizacion, cobertura de las 6
//      preguntas, maximo total EXACTO por cookie, y reconexion
//      (reconnectRate) sin desbordar el arreglo de cookies.
//
//      Efecto colateral de usar `amount`: autocannon DESACTIVA su
//      temporizador interno de `duration` por completo cuando `amount`
//      esta fijado (run.js: `if (!amount) { stopTimer = setTimeout(...) }`
//      -- nunca se crea ese timer si `amount` esta presente). Sin red
//      de seguridad, una corrida que se cuelga (una conexion que nunca
//      cierra, un servidor que nunca responde) no terminaria NUNCA por
//      si sola. Por eso se agrega una red de seguridad de RELOJ DE
//      PARED propia, independiente de `amount`/`duration`: un
//      setTimeout que llama `tracker.stop()` (existe siempre sobre el
//      EventEmitter que autocannon devuelve sin callback -- ver
//      node_modules/autocannon/lib/run.js, se asigna
//      incondicionalmente) pasado `--limiteSeguridadSegundos`. Esto
//      NUNCA sustituye el tope de `amount` (que ya es exacto y
//      demostrado) -- es una segunda capa, solo para el caso
//      patologico de que algo se cuelgue antes de alcanzar ese tope.
//
// A diferencia de los otros 2 scripts de scripts/perf/, este SI abre
// una conexion Postgres (SOLO de lectura, SOLO para leer los usuarios
// sinteticos -- nunca para EXPLAIN ni para la carga HTTP en si) ADEMAS
// de generar trafico HTTP real contra una URL de app ya desplegada (ej.
// un preview deployment de Vercel apuntando a la misma rama temporal de
// Neon ya sembrada).
//
// Este script NUNCA desactiva, modifica ni rodea el rate limiting real
// del servidor -- toda la correccion es del LADO DEL CLIENTE (cuantas
// solicitudes genera, con cuantas sesiones), nunca una cabecera ni
// parametro que le pida al servidor omitir el limite.
//
// Requiere, en el entorno de ESTA sesion de terminal:
//   CARGA_CONSULTAS_BASE_URL          -- URL base del deployment de
//                                         PRUEBA (nunca produccion),
//                                         ej. "https://chainpulse-pr4-xyz.vercel.app".
//   CARGA_CONSULTAS_HOST_CONFIRMADO   -- el hostname EXACTO de esa URL,
//                                         escrito a mano (ver
//                                         cargaConsultasHelpers.ts).
//   CARGA_CONSULTAS_CADENA_ID         -- cadenaId sembrado por
//                                         semillaSinteticaConsultas.ts
//                                         para la escala elegida.
//   CARGA_CONSULTAS_NEXTAUTH_SECRET   -- EXACTAMENTE el NEXTAUTH_SECRET
//                                         configurado en ese deployment
//                                         de prueba (nunca el de
//                                         produccion) -- con el secreto
//                                         equivocado, el deployment no
//                                         puede descifrar las cookies
//                                         sinteticas y toda la corrida
//                                         sera 401 (medicionValida=false,
//                                         codigo de salida distinto de
//                                         cero -- ver construirResumenEscenario()).
//   SEED_DATABASE_URL                 -- rol neondb_owner, mismo
//                                         destino ya sembrado por
//                                         semillaSinteticaConsultas.ts
//                                         para la escala elegida.
//                                         SOLO LECTURA aca (nunca se
//                                         escribe nada): lee los
//                                         usuarios sinteticos de esa
//                                         escala.
//   NEON_RAMA_TEMPORAL_HOST_CONFIRMADO / NEON_PRODUCCION_HOST_BLOQUEADO /
//   ENTORNO_PRUEBA_CONFIRMADO          -- las mismas 2 compuertas de
//                                         guardaRamaTemporalRendimiento.ts,
//                                         ahora exigidas tambien aca
//                                         (este script ya abre una
//                                         conexion Postgres, igual que
//                                         los otros 2 de scripts/perf/).
//   AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL="si"
//
// Uso previsto (solo documentado, nunca ejecutado en esta ronda):
//   npx tsx scripts/perf/cargaConsultas.ts --escala=1000 --concurrencia=5 --limiteSeguridadSegundos=300
//   (escribe scripts/perf/resultados/carga-<timestamp>.json -- ver
//   .gitignore, ese directorio nunca se commitea)
import "../_cargarEnv";
import { writeFileSync, mkdirSync } from "node:fs";
import autocannon from "autocannon";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CATALOGO_CONSULTA_IDS } from "../../src/domain/queries/tipos";
import {
  esEscalaValida,
  type EscalaFilasPorCadena,
} from "../../src/infra/queries/rendimiento/configuracionRendimiento";
import { exigirDestinoRendimientoSeguro } from "../../src/infra/queries/rendimiento/guardaRamaTemporalRendimiento";
import {
  construirClaimsSesionSintetica,
  mintarCookieSesionSintetica,
  ROL_USUARIO_SINTETICO_CARGA,
  sufijoEmailUsuariosSinteticosCarga,
} from "../../src/infra/queries/rendimiento/sesionSinteticaHelpers";
import {
  construirPayloadCarga,
  construirResumenEscenario,
  exigirUrlDePrueba,
  verificarDeploymentUsaRamaTemporal,
  type ResultadoAutocannonMinimo,
  type ResumenEscenarioCarga,
} from "../../src/infra/queries/rendimiento/cargaConsultasHelpers";

/** Concurrencias por defecto del diseno de PR4 (Seccion 6.3): 1 (linea
 * base sin contencion), 5 y 20 (concurrencia realista de un piloto).
 * SUMA = 26 -- el numero exacto de usuarios/cookies sinteticas que
 * CANTIDAD_USUARIOS_SINTETICOS_POR_DEFECTO de semillaSinteticaConsultas.ts
 * crea por defecto para esta misma razon. */
const CONCURRENCIAS_POR_DEFECTO = [1, 5, 20] as const;

/** Tope EXACTO de solicitudes por CONEXION (= por cookie, 1:1) en TODA
 * la corrida -- deliberadamente bien por debajo de
 * LIMITE_CONSULTA_EJECUTAR=30/hora (src/infra/rateLimit/huella.ts), con
 * margen para reintentos de red/latencia y para que una corrida mas
 * lenta de lo esperado nunca se acerque al limite real. Alex, ronda de
 * revision 2 2026-11-19, punto 2: "garantizar un maximo total exacto de
 * solicitudes por cookie, mediante `amount`" -- ver correrUnaConcurrencia()
 * para como `amount` convierte este numero en una garantia EXACTA (no
 * un "a lo sumo"), demostrada contra un servidor real en
 * __tests__/cargaConsultas.test.ts. */
const MAX_SOLICITUDES_POR_CONEXION_POR_CORRIDA = 24;

/** Techo de reloj de pared para la red de seguridad de
 * correrUnaConcurrencia() -- ver el comentario de cabecera (punto 2)
 * sobre por que `amount` desactiva el `stopTimer` interno de
 * autocannon. Generosamente por encima del peor caso teorico
 * (MAX_SOLICITUDES_POR_CONEXION_POR_CORRIDA=24 solicitudes
 * SECUENCIALES -- una conexion HTTP sin pipelining no puede
 * paralelizarlas dentro de si misma -- x el timeout por solicitud de
 * autocannon, 10s por defecto, nunca cambiado aca = 240s en el peor
 * caso absoluto), con margen: 300s. */
const LIMITE_SEGURIDAD_SEGUNDOS_POR_DEFECTO = 300;

function leerEscalaDeArgv(): EscalaFilasPorCadena {
  const arg = process.argv.find((a) => a.startsWith("--escala="));
  if (!arg) throw new Error("FALTA_ARGUMENTO_ESCALA -- uso: --escala=100|1000|10000|50000");
  const valor = Number(arg.slice("--escala=".length));
  if (!esEscalaValida(valor)) throw new Error(`ESCALA_INVALIDA_${valor}`);
  return valor;
}

function leerConcurrenciasDeArgv(): readonly number[] {
  const arg = process.argv.find((a) => a.startsWith("--concurrencia="));
  if (!arg) return CONCURRENCIAS_POR_DEFECTO;
  const valor = Number(arg.slice("--concurrencia=".length));
  if (!Number.isInteger(valor) || valor <= 0) throw new Error(`CONCURRENCIA_INVALIDA_${valor}`);
  return [valor];
}

function leerLimiteSeguridadSegundosDeArgv(): number {
  const arg = process.argv.find((a) => a.startsWith("--limiteSeguridadSegundos="));
  const valor = arg ? Number(arg.slice("--limiteSeguridadSegundos=".length)) : LIMITE_SEGURIDAD_SEGUNDOS_POR_DEFECTO;
  if (!Number.isFinite(valor) || valor <= 0) throw new Error(`LIMITE_SEGURIDAD_INVALIDO_${valor}`);
  return valor;
}

function construirClienteOwnerSoloLectura(): PrismaClient {
  const connectionString = process.env.SEED_DATABASE_URL;
  // exigirDestinoRendimientoSeguro ya valida formato/host/destino antes
  // de llegar aca -- esta linea solo satisface el tipo (string, no
  // string|undefined) para PrismaPg.
  if (!connectionString) throw new Error("FALTA_VARIABLE_SEED_DATABASE_URL");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/** Forma exacta de un Usuario sintetico tal como esta funcion lo
 * necesita -- deliberadamente angosta (nunca el modelo Prisma
 * completo, que trae passwordHash/mfaSecret/etc. que esta corrida
 * jamas necesita ni debe tocar). */
interface UsuarioSinteticoLeido {
  id: string;
  email: string;
  nombre: string;
  empresaId: string;
  rol: string;
  eslabonId: string | null;
  mfaHabilitado: boolean;
  sessionVersion: number;
}

/**
 * Lee, con el ROL OWNER (bypassa RLS -- mismo motivo que
 * explicarConsultas.ts: no hay forma de fijar app.tenant_id sin saber
 * antes a que empresa pertenecen estos usuarios), los usuarios
 * sinteticos de carga de `escala`, ordenados por email ASC (los emails
 * de emailUsuarioSinteticoCarga() llevan el indice con padStart(4,"0"),
 * asi que el orden alfabetico coincide con el orden numerico de
 * indice, 0000..9999) -- y devuelve EXACTAMENTE los primeros `cantidad`.
 * Lanza si no hay suficientes, con el comando exacto para corregirlo
 * (nunca intenta crear usuarios aca -- esa es responsabilidad exclusiva
 * de semillaSinteticaConsultas.ts, nunca de un script que genera carga
 * HTTP real).
 */
export async function leerUsuariosSinteticosParaCarga(
  cliente: PrismaClient,
  escala: EscalaFilasPorCadena,
  cantidad: number,
): Promise<UsuarioSinteticoLeido[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003), mismo patron que semillaSinteticaConsultas.ts
  const clienteAny = cliente as any;
  const sufijo = sufijoEmailUsuariosSinteticosCarga(escala);
  const filas = await clienteAny.usuario.findMany({
    where: { email: { endsWith: sufijo } },
    orderBy: { email: "asc" },
    select: { id: true, email: true, nombre: true, empresaId: true, rol: true, eslabonId: true, mfaHabilitado: true, sessionVersion: true },
  });

  if (filas.length < cantidad) {
    throw new Error(
      `USUARIOS_SINTETICOS_INSUFICIENTES_SE_NECESITAN_${cantidad}_SE_ENCONTRARON_${filas.length} -- correr ` +
        `"npx tsx scripts/perf/semillaSinteticaConsultas.ts --escala=${escala} --usuarios=${cantidad}" primero`,
    );
  }

  const seleccionados = filas.slice(0, cantidad) as UsuarioSinteticoLeido[];
  for (const fila of seleccionados) {
    // Defensa en profundidad -- estas filas las crea EXCLUSIVAMENTE
    // crearUsuariosSinteticosParaCarga() con este rol fijo; si alguna
    // vez no coincidiera (fila corrupta, o el email coincidio con un
    // usuario real por error), fallar aca es mas seguro que mintar una
    // cookie con un rol que nunca se valido para este proposito.
    if (fila.rol !== ROL_USUARIO_SINTETICO_CARGA) {
      throw new Error(`USUARIO_SINTETICO_CON_ROL_INESPERADO_${fila.rol}`);
    }
  }
  return seleccionados;
}

/**
 * Minta, EN MEMORIA y en el mismo orden que `usuarios`, una cookie de
 * sesion por usuario -- usa mintarCookieSesionSintetica()
 * (sesionSinteticaHelpers.ts), nunca un login HTTP real. NUNCA imprime
 * ni devuelve nada que contenga el `secret` -- solo las cookies en si,
 * que viven unicamente en la variable local del caller, jamas en un
 * `console.log` ni en el JSON escrito a disco (ver comentario de
 * cabecera, punto 1.c).
 */
export async function mintarCookiesParaUsuarios(secret: string, usuarios: readonly UsuarioSinteticoLeido[]): Promise<string[]> {
  return Promise.all(
    usuarios.map((usuario) =>
      mintarCookieSesionSintetica(
        secret,
        construirClaimsSesionSintetica({
          id: usuario.id,
          email: usuario.email,
          nombre: usuario.nombre,
          empresaId: usuario.empresaId,
          rol: ROL_USUARIO_SINTETICO_CARGA,
          eslabonId: usuario.eslabonId,
          mfaHabilitado: usuario.mfaHabilitado,
          sessionVersion: usuario.sessionVersion,
        }),
      ),
    ),
  );
}

/**
 * Corre UN escenario de concurrencia -- exportada y probada
 * directamente contra un servidor HTTP real y el autocannon REAL (ver
 * __tests__/cargaConsultas.test.ts), no solo contra los helpers puros
 * de cargaConsultasHelpers.ts (Alex, ronda 2, punto 2: "pruebas del
 * runner real -- no solamente de los helpers").
 *
 * `opcionesAdicionalesSoloPrueba` existe EXCLUSIVAMENTE para que esas
 * pruebas puedan forzar `reconnectRate` (nunca se pasa desde main() en
 * una corrida real) y asi demostrar, contra el autocannon real, que un
 * reconnect (_resetConnection() en node_modules/autocannon/lib/httpClient.js,
 * que reutiliza la MISMA conexion y por lo tanto la MISMA cookie ya
 * capturada en su clausura, sin volver a llamar setupClient) nunca
 * desborda ni reindexa el arreglo `cookies`.
 */
export async function correrUnaConcurrencia(
  urlBase: URL,
  cookiesDeEstaCorrida: readonly string[],
  cadenaId: string,
  concurrencia: number,
  maxSolicitudesPorConexion: number,
  limiteSeguridadSegundos: number,
  opcionesAdicionalesSoloPrueba?: { reconnectRate?: number },
): Promise<ResumenEscenarioCarga> {
  if (cookiesDeEstaCorrida.length !== concurrencia) {
    // Invariante interna -- si esto lanza, es un bug de main() (el
    // reparto de cookies por escenario), nunca una condicion que el
    // operador pueda corregir cambiando una variable de entorno.
    throw new Error("ASIGNACION_DE_COOKIES_INCONSISTENTE_CON_CONCURRENCIA");
  }

  // CORRECCION (ronda 2 de revision, 2026-11-19, punto 2): `amount`
  // (nunca `maxConnectionRequests`) -- ver el comentario de cabecera de
  // este archivo para la derivacion completa. Al ser multiplo exacto de
  // `concurrencia` (= connections), distributeNums() (autocannon
  // run.js) le da el MISMO numero, EXACTO, a cada una de las
  // `concurrencia` conexiones -- nunca un reparto desigual, nunca mas
  // ni menos que maxSolicitudesPorConexion por conexion.
  const amount = maxSolicitudesPorConexion * concurrencia;

  // Cada conexion de autocannon recibe, en setupClient (llamado UNA
  // vez por conexion -- confirmado leyendo httpClient.js: se invoca en
  // el constructor del Client, nunca de nuevo en un reconnect/reset),
  // un arreglo de requests PROPIO (client.setRequests(), nunca el
  // arreglo compartido a nivel de opts) con las 6 preguntas y SU cookie
  // ya incluida en cada una de las 6 entradas -- evitar por completo el
  // mecanismo de setHeaders()/this.headers de autocannon, que solo
  // actualiza de forma confiable la entrada "actual" del iterador, no
  // las otras 5 (verificado leyendo lib/requestIterator.js: una
  // reasignacion de referencia en setHeaders() no alcanza a las
  // entradas ya construidas de este mismo arreglo). Con un arreglo
  // propio por conexion, construido aca, no hay ambiguedad posible.
  //
  // `indiceConexion` solo avanza DENTRO de setupClient -- como
  // setupClient nunca se vuelve a llamar en un reconnect/reset (ver
  // arriba), este contador NUNCA puede superar `concurrencia`, sin
  // importar cuantas veces se reconecte cada conexion individual --
  // estructuralmente no hay forma de desbordar `cookiesDeEstaCorrida`.
  // HALLAZGO EMPIRICO (no solo de lectura de codigo) al escribir
  // __tests__/cargaConsultas.test.ts contra un servidor HTTP real: un
  // `path` SIN slash inicial ("api/consultas/ejecutar", el valor
  // original de la ronda 1) hace que autocannon NUNCA envie ninguna
  // solicitud -- cero bytes en el socket, sin ningun error/evento
  // reportado ( demostrado con `connections:3, amount:18` Y con
  // `duration` clasico: ambos en 0 solicitudes recibidas por un
  // servidor real). Con el slash inicial ("/api/consultas/ejecutar"),
  // autocannon envia todo con normalidad. El codigo de la ronda 1
  // (`path: "api/consultas/ejecutar"`, sin slash) NUNCA habia sido
  // probado contra un servidor real -- construirResumenEscenario()
  // hubiera reportado medicionValida=false (sumaConteos=0), pero sin
  // ningun diagnostico de la causa real. Corregido aca; ver la 1ra
  // prueba de __tests__/cargaConsultas.test.ts, que fallaria de
  // inmediato si alguien volviera a quitar el slash.
  let indiceConexion = 0;
  const tracker = autocannon({
    url: urlBase.toString(),
    connections: concurrencia,
    amount,
    method: "POST",
    ...(opcionesAdicionalesSoloPrueba?.reconnectRate !== undefined
      ? { reconnectRate: opcionesAdicionalesSoloPrueba.reconnectRate }
      : {}),
    setupClient: (cliente) => {
      const cookie = cookiesDeEstaCorrida[indiceConexion];
      indiceConexion += 1;
      if (cookie === undefined) {
        throw new Error("COOKIE_NO_ASIGNADA_PARA_ESTA_CONEXION");
      }
      const solicitudesDeEstaConexion = CATALOGO_CONSULTA_IDS.map((catalogoId) => ({
        method: "POST" as const,
        path: "/api/consultas/ejecutar",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(construirPayloadCarga(catalogoId, cadenaId)),
      }));
      cliente.setRequests(solicitudesDeEstaConexion);
    },
  // Cast documentado -- @types/autocannon tipa la sobrecarga SIN
  // callback como `Promise<Result>` puro, sin `.on()`/`.stop()`. En
  // RUNTIME, esa misma sobrecarga devuelve el EventEmitter completo
  // (ver node_modules/autocannon/lib/init.js: `tracker.then =
  // promise.then.bind(promise)` -- el mismo objeto es a la vez
  // EventEmitter/Instance Y thenable), confirmado empiricamente por
  // __tests__/cargaConsultas.test.ts (tracker.stop()/.on() funcionan
  // de verdad ahi, contra el autocannon real). Esta interseccion de
  // tipos documenta esa realidad en vez de silenciarla con `any`.
  }) as unknown as autocannon.Instance & Promise<ResultadoAutocannonMinimo>;

  // Red de seguridad de RELOJ DE PARED -- ver el comentario de cabecera
  // (punto 2) sobre por que `amount` desactiva el `stopTimer` interno
  // de autocannon. `tracker.stop()` existe siempre (se asigna
  // incondicionalmente sobre el EventEmitter que autocannon devuelve
  // sin callback, node_modules/autocannon/lib/run.js) y hace efecto en
  // el siguiente tick de muestreo (<=1s, ver tickInterval() en ese
  // mismo archivo) -- nunca sustituye el tope EXACTO de `amount`, es
  // solo la segunda capa para el caso patologico de que algo se cuelgue
  // antes de alcanzarlo.
  // CORRECCION (ronda de revision 3, 2026-11-19, punto 1): se registra
  // explicitamente si la red de seguridad llego a activarse -- nunca se
  // infiere a partir de requests.total (ver el comentario de cabecera
  // de construirResumenEscenario() en cargaConsultasHelpers.ts: una
  // corrida puede recibir solo 200s y aun asi estar incompleta porque
  // el temporizador la corto antes de alcanzar `amount`).
  let temporizadorSeguridadActivado = false;
  const temporizadorSeguridad = setTimeout(() => {
    temporizadorSeguridadActivado = true;
    tracker.stop();
  }, limiteSeguridadSegundos * 1000);
  tracker.on("done", () => clearTimeout(temporizadorSeguridad));

  let resultado: ResultadoAutocannonMinimo;
  try {
    resultado = await tracker;
  } finally {
    clearTimeout(temporizadorSeguridad);
  }
  return construirResumenEscenario(concurrencia, resultado, amount, temporizadorSeguridadActivado);
}

async function main(): Promise<void> {
  const urlBaseCruda = process.env.CARGA_CONSULTAS_BASE_URL;
  const cadenaId = process.env.CARGA_CONSULTAS_CADENA_ID;
  const nextAuthSecret = process.env.CARGA_CONSULTAS_NEXTAUTH_SECRET;
  if (!urlBaseCruda) throw new Error("FALTA_VARIABLE_CARGA_CONSULTAS_BASE_URL");
  if (!cadenaId) throw new Error("FALTA_VARIABLE_CARGA_CONSULTAS_CADENA_ID");
  if (!nextAuthSecret) throw new Error("FALTA_VARIABLE_CARGA_CONSULTAS_NEXTAUTH_SECRET");

  const urlBase = exigirUrlDePrueba(urlBaseCruda);
  const escala = leerEscalaDeArgv();
  const concurrencias = leerConcurrenciasDeArgv();
  const limiteSeguridadSegundos = leerLimiteSeguridadSegundosDeArgv();

  const totalConexionesNecesarias = concurrencias.reduce((suma, c) => suma + c, 0);

  // Las DOS compuertas (host + destino exacto) de la conexion Postgres
  // de SOLO LECTURA -- mismo criterio que explicarConsultas.ts (este
  // script tambien abre una conexion real a Neon, aunque sea solo para
  // leer usuarios sinteticos, nunca para la carga HTTP en si).
  const destino = exigirDestinoRendimientoSeguro("SEED_DATABASE_URL", process.env.SEED_DATABASE_URL);
  console.log("Destino de lectura de usuarios verificado:", JSON.stringify({ host: destino.host, base: destino.base, esquema: destino.esquema }));

  const clienteOwner = construirClienteOwnerSoloLectura();
  let cookies: string[];
  try {
    const usuarios = await leerUsuariosSinteticosParaCarga(clienteOwner, escala, totalConexionesNecesarias);
    cookies = await mintarCookiesParaUsuarios(nextAuthSecret, usuarios);
  } finally {
    // La conexion a Postgres se cierra ANTES de arrancar cualquier
    // carga HTTP -- nunca se mantiene abierta durante la corrida (que
    // puede tardar varios minutos).
    await clienteOwner.$disconnect();
  }
  console.log(`Cookies de sesion mintadas en memoria: ${cookies.length} (nunca se imprimen ni se persisten; nunca se reutiliza ninguna entre conexiones ni escenarios).`);

  console.log(`Destino de carga verificado (host confirmado, no es produccion): ${urlBase.hostname}`);

  // Prueba de rama temporal (Alex, ronda de revision 1, 2026-11-19:
  // "una preview de Vercel no basta, porque podria conservar las
  // variables de produccion") -- UNA sola peticion de sondeo, antes de
  // cualquier carga real, con la PRIMERA cookie del pool (alcanza para
  // probar que ESTE deployment ve la rama temporal; cada cookie
  // individual se prueba a si misma en cuanto autenticacion al recibir
  // sus propias respuestas durante la carga real -- Alex, ronda 2:
  // "La sonda de la primera cookie no sustituye la validacion de todas
  // las sesiones", ver construirResumenEscenario()).
  await verificarDeploymentUsaRamaTemporal(fetch, urlBase, cookies[0] as string, cadenaId);
  console.log("Prueba de rama temporal OK -- el deployment ve el cadenaId sintetico sembrado.");

  const resumenes: ResumenEscenarioCarga[] = [];
  let cookieOffset = 0;
  for (const concurrencia of concurrencias) {
    const cookiesDeEsteEscenario = cookies.slice(cookieOffset, cookieOffset + concurrencia);
    cookieOffset += concurrencia;

    console.log(
      `Corriendo concurrencia=${concurrencia} (tope EXACTO ${MAX_SOLICITUDES_POR_CONEXION_POR_CORRIDA} solicitudes/conexion via amount, limite de seguridad ${limiteSeguridadSegundos}s)...`,
    );
    const resumen = await correrUnaConcurrencia(
      urlBase,
      cookiesDeEsteEscenario,
      cadenaId,
      concurrencia,
      MAX_SOLICITUDES_POR_CONEXION_POR_CORRIDA,
      limiteSeguridadSegundos,
    );
    resumenes.push(resumen);

    if (!resumen.medicionValida) {
      console.warn(
        `MEDICION INVALIDA para concurrencia=${concurrencia} -- codigos HTTP invalidantes encontrados: ${resumen.codigosInvalidantesEncontrados.join(", ")}. ` +
          "Esta corrida no tuvo exito total (ver construirResumenEscenario()) -- no usar estos numeros de latencia como evidencia de PR4.",
      );
    } else {
      console.log(`OK -- concurrencia=${concurrencia}: p50=${resumen.p50Ms}ms p97.5=${resumen.p97_5Ms}ms p99=${resumen.p99Ms}ms (${resumen.totalSolicitudes} solicitudes).`);
    }
  }

  // scripts/perf/resultados/ esta en .gitignore -- nunca se commitea.
  mkdirSync("scripts/perf/resultados", { recursive: true });
  const ruta = `scripts/perf/resultados/carga-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(ruta, JSON.stringify(resumenes, null, 2), "utf-8");
  console.log(`Resultados escritos en ${ruta}`);
  console.log(JSON.stringify(resumenes, null, 2));

  // Alex, ronda 2, punto 3: "el script debe terminar con codigo
  // distinto de cero" si alguna medicion no fue valida -- nunca se
  // enmascara una corrida fallida con un exit code 0.
  if (resumenes.some((r) => !r.medicionValida)) {
    process.exitCode = 1;
  }
}

// Guard -- mismo patron ya establecido en scripts/rf20/ y
// scripts/rf19/ (ver explicarConsultas.ts para el comentario completo):
// evita que importar este archivo desde una prueba dispare main().
if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error("CARGA_ABORTADA:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
