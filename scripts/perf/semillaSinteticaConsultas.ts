// Script INERTE -- siembra/limpia filas sinteticas para medir, con
// EXPLAIN (ANALYZE, BUFFERS) real (ver explicarConsultas.ts), si las 6
// consultas determinísticas de Incremento 5 necesitan indices o vistas
// materializadas a escala (Incremento 5 PR4, Alex, 2026-11-19).
//
// INERTE A PROPOSITO: esta ronda SOLO autoriza crear este script, nunca
// ejecutarlo ni conectarse a Neon (ver diseno de PR4, Seccion 6.4 /
// Decision D1 -- pendiente de autorizacion separada). No se corrio ni
// una sola vez contra ninguna base real.
//
// CORRECCIONES (ronda 2 de revision, 2026-11-19):
//   - Punto 5: faltaba por completo la siembra de ObservacionKpi bajo
//     definicionFillRate -- TODAS las filas se sembraban con
//     definicionOtif.id, aun despues de que explicarConsultas.ts (ronda
//     1) ya resolviera y filtrara por definicionFillRateId para
//     FALTANTES_FILL_RATE. Sin esto, ese EXPLAIN mediria un escaneo
//     contra un conjunto VACIO. Corregido: se agrega una segunda
//     siembra, misma escala, bajo definicionFillRate.id (ver
//     sembrar() y PlanSiembraPorTabla en configuracionRendimiento.ts).
//   - Punto 1 ("la siembra solo crea Empresa y Cadena, pero la carga
//     por defecto necesita 26 cookies independientes para las
//     concurrencias 1+5+20"): sembrar() ahora TAMBIEN crea
//     `cantidadUsuarios` (26 por defecto, ver
//     CANTIDAD_USUARIOS_SINTETICOS_POR_DEFECTO) usuarios sinteticos
//     DENTRO del mismo tenant que acaba de crear (empresa.id), via
//     crearUsuariosSinteticosParaCarga() -- nunca una cookie/sesion
//     persistida: cargaConsultas.ts lee estos Usuario por email (ver
//     sesionSinteticaHelpers.ts) y minta sus cookies EN MEMORIA, recien
//     al momento de usarlas, con next-auth/jwt encode() (la MISMA
//     funcion que usa Auth.js para emitir una sesion real) -- nunca un
//     login HTTP de verdad, nunca una cookie en disco. La revocacion
//     tiene DOS caminos, documentados y probados ambos (ver
//     __tests__/semillaSinteticaConsultas.test.ts):
//       a. `--limpiar` (ya existente): borra la Empresa -> cascade
//          (`onDelete: Cascade`, prisma/schema.prisma) borra TAMBIEN
//          sus Usuario, junto con el resto del tenant.
//       b. `--limpiar-usuarios` (nuevo): revoca SOLO los usuarios de
//          una escala (deleteMany por el sufijo EXACTO de email de esa
//          escala, via revocarUsuariosSinteticosDeCarga()), sin tocar
//          Empresa/Cadena/ObservacionKpi -- para rotar credenciales
//          entre corridas de carga sin tener que re-sembrar los datos.
//     `--usuarios=0` siembra datos sin crear ningun usuario (por si
//     algun escenario futuro solo necesita los datos, nunca la carga
//     HTTP).
//
// Requiere, en el entorno de ESTA sesion de terminal (nunca en un
// archivo que termine commiteado), LAS DOS compuertas de
// guardaRamaTemporalRendimiento.ts (host + destino exacto), NUNCA una
// sola:
//   SEED_DATABASE_URL                        -- rol neondb_owner, host
//                                                DIRECTO (nunca pooler),
//                                                ?sslmode=require o
//                                                verify-full.
//   NEON_RAMA_TEMPORAL_HOST_CONFIRMADO       -- el host EXACTO de esa
//                                                URL, confirmado a mano.
//   NEON_PRODUCCION_HOST_BLOQUEADO           -- el host de produccion,
//                                                declarado explicitamente.
//   AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL="si"
//   ENTORNO_PRUEBA_CONFIRMADO                -- destinoConfirmado() del
//                                                mismo destino (ver
//                                                destinoPrueba.ts).
//
// Uso previsto (solo documentado, nunca ejecutado en esta ronda):
//   npx tsx scripts/perf/semillaSinteticaConsultas.ts --escala=1000
//   npx tsx scripts/perf/semillaSinteticaConsultas.ts --escala=1000 --dry-run
//   npx tsx scripts/perf/semillaSinteticaConsultas.ts --escala=1000 --usuarios=40
//   npx tsx scripts/perf/semillaSinteticaConsultas.ts --escala=1000 --usuarios=0
//   npx tsx scripts/perf/semillaSinteticaConsultas.ts --escala=1000 --limpiar
//   npx tsx scripts/perf/semillaSinteticaConsultas.ts --escala=1000 --limpiar-usuarios
//
// Limpieza RECUPERABLE (Alex, 2026-11-19: "limpieza recuperable"): nunca
// un DELETE sin filtro. `--limpiar` borra EXCLUSIVAMENTE la Empresa cuyo
// nombre es nombreEmpresaSinteticaParaEscala(escala) (mismo criterio que
// la MARCA de scripts/limpiarTenantsPrueba.ts) -- el cascade de
// `onDelete: Cascade` ya declarado en schema.prisma para Empresa ->
// Cadena/Nodo/ConexionCadena/ObservacionKpi/ObservacionOtifProveedor/
// HallazgoCadena/Usuario se encarga del resto en una sola transaccion.
// `--limpiar-usuarios` borra EXCLUSIVAMENTE los Usuario cuyo email
// termina en sufijoEmailUsuariosSinteticosCarga(escala) -- nunca toca
// Empresa/Cadena/datos. Ninguno de los dos toca ninguna otra empresa ni
// usuario, con o sin la marca.
import "../_cargarEnv";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  esEscalaValida,
  nombreEmpresaSinteticaParaEscala,
  planSiembraParaEscala,
  type EscalaFilasPorCadena,
} from "../../src/infra/queries/rendimiento/configuracionRendimiento";
import { exigirDestinoRendimientoSeguro } from "../../src/infra/queries/rendimiento/guardaRamaTemporalRendimiento";
import {
  construirFilasUsuariosSinteticosCarga,
  sufijoEmailUsuariosSinteticosCarga,
  type FilaUsuarioSinteticoCarga,
} from "../../src/infra/queries/rendimiento/sesionSinteticaHelpers";
import { hashPassword } from "../../src/infra/auth/password";

/** Version de regla OBVIAMENTE sintetica -- nunca "kpis-v1"/"consultas-v1"
 * reales, para que una fila de esta siembra nunca pueda confundirse con
 * un dato real en ningun reporte ni auditoria. */
const RULE_VERSION_SINTETICA = "rendimiento-pr4-sintetico";
const TAMANO_LOTE_INSERCION = 1_000;

/** 1 + 5 + 20 = la SUMA de CONCURRENCIAS_POR_DEFECTO de cargaConsultas.ts
 * -- exactamente tantas cookies/sesiones independientes como necesita
 * una corrida completa con las 3 concurrencias por defecto, SIN
 * reutilizar ninguna entre escenarios (ver cargaConsultas.ts,
 * totalConexionesNecesarias). Si cargaConsultas.ts cambia sus
 * concurrencias por defecto, este numero debe revisarse junto (no hay
 * un import compartido porque este script nunca debe depender de
 * autocannon ni de nada HTTP). */
const CANTIDAD_USUARIOS_SINTETICOS_POR_DEFECTO = 26;

/** Subconjunto minimo de la API de Prisma que crearUsuariosSinteticosParaCarga()/
 * revocarUsuariosSinteticosDeCarga() necesitan -- permite probarlas con
 * un cliente FALSO en memoria (mismo patron que ClienteSqlExplain en
 * explicarConsultas.ts), sin tocar Postgres ni mockear `@prisma/client`
 * entero. */
export interface ClienteUsuariosSinteticos {
  usuario: {
    createMany(args: { data: FilaUsuarioSinteticoCarga[] }): Promise<{ count: number }>;
    deleteMany(args: { where: { email: { endsWith: string } } }): Promise<{ count: number }>;
  };
}

function leerEscalaDeArgv(): EscalaFilasPorCadena {
  const arg = process.argv.find((a) => a.startsWith("--escala="));
  if (!arg) {
    throw new Error("FALTA_ARGUMENTO_ESCALA -- uso: --escala=100|1000|10000|50000");
  }
  const valor = Number(arg.slice("--escala=".length));
  if (!esEscalaValida(valor)) {
    throw new Error(`ESCALA_INVALIDA_${valor} -- debe ser una de las 4 escalas de configuracionRendimiento.ts`);
  }
  return valor;
}

/** `--usuarios=N` -- 0 es valido a proposito (sembrar datos sin crear
 * ningun usuario); por eso la validacion es `< 0`, nunca `<= 0` como en
 * leerEscalaDeArgv()/leerCantidadUsuariosDeArgv() de cargaConsultas.ts. */
function leerCantidadUsuariosDeArgv(): number {
  const arg = process.argv.find((a) => a.startsWith("--usuarios="));
  if (!arg) return CANTIDAD_USUARIOS_SINTETICOS_POR_DEFECTO;
  const valor = Number(arg.slice("--usuarios=".length));
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`CANTIDAD_USUARIOS_INVALIDA_${valor}`);
  }
  return valor;
}

function construirClienteOwner(): PrismaClient {
  const connectionString = process.env.SEED_DATABASE_URL;
  // exigirDestinoRendimientoSeguro ya valida formato/host/destino antes
  // de llegar aca -- esta linea solo satisface el tipo (string, no
  // string|undefined) para PrismaPg.
  if (!connectionString) throw new Error("FALTA_VARIABLE_SEED_DATABASE_URL");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/**
 * Crea `cantidad` usuarios sinteticos bajo `empresaId` (el tenant de
 * rendimiento recien sembrado, o uno ya existente) -- un passwordHash
 * Argon2id DISTINTO por usuario, derivado de una contraseña aleatoria
 * generada y descartada en el acto (nunca se imprime, persiste ni
 * reutiliza: ningun flujo de login real la necesita, ver
 * sesionSinteticaHelpers.ts). Las filas en si (email, rol, etc.) son
 * PURAS -- las construye construirFilasUsuariosSinteticosCarga(); esta
 * funcion solo agrega el hash y hace el createMany.
 */
export async function crearUsuariosSinteticosParaCarga(
  cliente: ClienteUsuariosSinteticos,
  empresaId: string,
  escala: EscalaFilasPorCadena,
  cantidad: number,
): Promise<{ cantidadCreada: number }> {
  if (cantidad === 0) {
    console.log("--usuarios=0: no se crea ningun usuario sintetico.");
    return { cantidadCreada: 0 };
  }
  const passwordHashes = await Promise.all(
    Array.from({ length: cantidad }, () => hashPassword(randomBytes(32).toString("hex"))),
  );
  const filas = construirFilasUsuariosSinteticosCarga(empresaId, escala, passwordHashes);
  const resultado = await cliente.usuario.createMany({ data: filas });
  console.log(`Usuarios sinteticos creados -- ${resultado.count} fila(s) bajo empresaId=${empresaId}.`);
  return { cantidadCreada: resultado.count };
}

/**
 * Revoca (borra) EXCLUSIVAMENTE los usuarios sinteticos de carga de una
 * escala -- filtra por el sufijo EXACTO de email de esa escala
 * (sufijoEmailUsuariosSinteticosCarga(), el MISMO que
 * construirFilasUsuariosSinteticosCarga() garantiza en todo email que
 * produce -- ver la prueba dedicada en sesionSinteticaHelpers.test.ts
 * que lo demuestra). Nunca toca Empresa/Cadena/datos ni usuarios de
 * otra escala.
 */
export async function revocarUsuariosSinteticosDeCarga(
  cliente: ClienteUsuariosSinteticos,
  escala: EscalaFilasPorCadena,
): Promise<{ cantidadRevocada: number }> {
  const sufijo = sufijoEmailUsuariosSinteticosCarga(escala);
  const resultado = await cliente.usuario.deleteMany({ where: { email: { endsWith: sufijo } } });
  console.log(`Usuarios sinteticos revocados -- ${resultado.count} fila(s) con email que termina en "${sufijo}" borrada(s).`);
  return { cantidadRevocada: resultado.count };
}

/** Las 6 dimensiones reales de DimensionComparacionCadena
 * (prisma/schema.prisma) -- declaradas aca como tupla literal, NUNCA
 * importadas de `@prisma/client`, por el mismo motivo que el resto de
 * este script trata a PrismaClient como `any` (ADR-0003, engineType=
 * "client"): mantiene construirFilasHallazgoCadenaSintetico() PURA y
 * testeable sin generar el cliente Prisma ni tocar Postgres. */
export const DIMENSIONES_HALLAZGO_CADENA = [
  "PRIORIDAD_ELEGIDA",
  "CONOCIMIENTO_ENTRADAS_SALIDAS",
  "MOMENTO_INFORMACION",
  "FUENTE_DATOS",
  "NODO_CRITICO",
  "ALTERNATIVA_DISPONIBLE",
] as const;

/** Cuantas filas HallazgoCadena admite, como maximo, UN SOLO alcance (ya
 * sea una ConexionCadena puntual, o la cadena completa) -- el limite
 * real que imponen los 2 indices unicos PARCIALES de la migracion
 * 20260924010000_hallazgos_cadena_unique: "una fila DIFERENCIA activa
 * por dimension y por alcance" (RF38/RF39, ver el comentario de
 * HallazgoCadena en schema.prisma). Es, exactamente, el numero de
 * dimensiones -- nunca un numero elegido a mano. */
export const MAX_HALLAZGOS_POR_ALCANCE = DIMENSIONES_HALLAZGO_CADENA.length;

export interface FilaHallazgoCadenaSintetico {
  empresaId: string;
  cadenaId: string;
  conexionCadenaId: string | null;
  dimension: (typeof DIMENSIONES_HALLAZGO_CADENA)[number];
  resultado: "DIFERENCIA";
  createdAt: Date;
}

export interface OpcionesHallazgoCadenaSintetico {
  empresaId: string;
  cadenaId: string;
  /** Ids de ConexionCadena YA creadas para esta cadena -- el seeding real
   * (sembrar()) las pasa en el orden en que las creo; esta funcion nunca
   * las crea ni las lee, es PURA. */
  idsConexionesDisponibles: readonly string[];
  cantidad: number;
  /** Inyectable para pruebas deterministas -- nunca `Date.now()`
   * implicito dentro de la funcion. */
  ahoraMs: number;
}

/**
 * BLOQUEO CORREGIDO (Alex, 2026-11-19): la version anterior ponia TODAS
 * las filas en el alcance "cadena completa" (conexionCadenaId=null) y
 * ciclaba las 6 dimensiones (`dimensiones[n % 6]`) -- a partir de la
 * septima fila, cualquier escala (1.000/10.000/50.000) repetia una
 * combinacion (cadenaId, dimension) ya insertada, violando el indice
 * unico parcial `hallazgos_cadena_cadena_dimension_key` (ver migracion
 * 20260924010000_hallazgos_cadena_unique). Esta funcion construye
 * `cantidad` filas que NUNCA repiten una combinacion (alcance,
 * dimension) ya usada, respetando los 2 indices unicos parciales reales
 * tal cual existen hoy -- no los debilita ni los reinterpreta.
 *
 * Representacion elegida (realista dentro de lo que RF38/RF39 permite --
 * ver tambien el comentario de planSiembraParaEscala() en
 * configuracionRendimiento.ts: un volumen de miles de hallazgos
 * SIMULTANEOS en una sola cadena sigue siendo, en si mismo, un escenario
 * hipotetico de estres que nunca ocurre en la app real; esta correccion
 * no cambia eso, solo lo hace EJECUTABLE sin violar ninguna restriccion):
 *   - Hasta `MAX_HALLAZGOS_POR_ALCANCE` (6) filas en el alcance "cadena
 *     completa" (conexionCadenaId=null), una por dimension, sin repetir
 *     -- el maximo real que ESE alcance admite.
 *   - El resto, agrupado de 6 en 6 (una por dimension, sin repetir) bajo
 *     CADA ConexionCadena de `idsConexionesDisponibles` -- el mismo
 *     patron real (una conexion puntual puede tener hasta 6 hallazgos
 *     activos, uno por dimension), repetido sobre tantas conexiones
 *     como haga falta para alcanzar `cantidad`. Nunca reutiliza una
 *     conexion para una dimension ya usada en ella.
 *
 * `createdAt` se distribuye en los ultimos 400 dias (igual que antes de
 * esta correccion) -- necesario para que el candidato de indice
 * (cadenaId, createdAt) de CAMBIOS_ULTIMO_PULSO (I5-06) tenga algo real
 * que medir; todas con el mismo createdAt no probarian nada del rango.
 *
 * Lanza explicitamente (nunca trunca en silencio) si
 * `idsConexionesDisponibles` no alcanza para `cantidad` sin colisionar
 * -- `sembrar()` siempre le pasa `plan.conexionCadena` conexiones (ver
 * configuracionRendimiento.ts), que a las 3 escalas pedidas
 * (1.000/10.000/50.000) sobra por un margen amplio (capacidad =
 * conexiones*6 >> escala), pero esta funcion no lo asume: lo verifica.
 *
 * NUNCA via persistirHallazgosCadena.ts (ese modulo rechazaria este
 * volumen por diseno) -- este script escribe directo, a proposito, solo
 * para medir el planificador de Postgres contra un volumen hipotetico.
 */
export function construirFilasHallazgoCadenaSintetico(
  opciones: OpcionesHallazgoCadenaSintetico,
): FilaHallazgoCadenaSintetico[] {
  const { empresaId, cadenaId, idsConexionesDisponibles, cantidad, ahoraMs } = opciones;
  if (!Number.isInteger(cantidad) || cantidad < 0) {
    throw new Error(`CANTIDAD_HALLAZGOS_INVALIDA_${cantidad}`);
  }
  const dims = DIMENSIONES_HALLAZGO_CADENA;
  const cantidadCadenaCompleta = Math.min(dims.length, cantidad);
  const cantidadPorConexion = cantidad - cantidadCadenaCompleta;
  const capacidadConexiones = idsConexionesDisponibles.length * dims.length;
  if (cantidadPorConexion > capacidadConexiones) {
    throw new Error(
      `HALLAZGOS_SINTETICOS_EXCEDEN_CAPACIDAD_SIN_COLISION -- se pidieron ${cantidad} ` +
        `(${cantidadCadenaCompleta} en alcance cadena completa + ${cantidadPorConexion} en alcance conexion), ` +
        `pero solo hay ${idsConexionesDisponibles.length} conexion(es) disponibles ` +
        `(capacidad maxima ${capacidadConexiones} fila(s) en alcance conexion sin colisionar).`,
    );
  }

  const rangoMs = 400 * 24 * 60 * 60 * 1000;
  const filas: FilaHallazgoCadenaSintetico[] = [];
  for (let n = 0; n < cantidad; n += 1) {
    const fraccion = cantidad <= 1 ? 0 : n / (cantidad - 1);
    const createdAt = new Date(ahoraMs - rangoMs + Math.round(fraccion * rangoMs));
    if (n < cantidadCadenaCompleta) {
      filas.push({
        empresaId,
        cadenaId,
        conexionCadenaId: null,
        dimension: dims[n] as (typeof dims)[number],
        resultado: "DIFERENCIA",
        createdAt,
      });
    } else {
      const posicion = n - cantidadCadenaCompleta;
      const indiceConexion = Math.floor(posicion / dims.length);
      const indiceDimension = posicion % dims.length;
      filas.push({
        empresaId,
        cadenaId,
        conexionCadenaId: idsConexionesDisponibles[indiceConexion] as string,
        dimension: dims[indiceDimension] as (typeof dims)[number],
        resultado: "DIFERENCIA",
        createdAt,
      });
    }
  }
  return filas;
}

async function sembrar(
  cliente: PrismaClient,
  escala: EscalaFilasPorCadena,
  dryRun: boolean,
  cantidadUsuarios: number,
): Promise<void> {
  const plan = planSiembraParaEscala(escala);
  const nombreEmpresa = nombreEmpresaSinteticaParaEscala(escala);

  console.log(`Plan de siembra para escala=${escala}:`, JSON.stringify({ ...plan, usuariosSinteticos: cantidadUsuarios }));
  if (dryRun) {
    console.log("--dry-run: no se escribe nada.");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003), mismo patron que limpiarTenantsPrueba.ts
  const clienteAny = cliente as any;

  // CORRECCION (ronda 2 de revision, 2026-11-19, punto 5): se agrega
  // definicionFillRate (antes faltaba por completo -- ver el comentario
  // de PlanSiembraPorTabla en configuracionRendimiento.ts). Mismo orden
  // (numero DESC) que resolverIdsConRolOwner() de explicarConsultas.ts,
  // para resolver siempre la MISMA fila si alguna vez hubiera mas de una
  // version PUBLICADA de FILL_RATE.
  const [definicionOtif, definicionOtifProveedor, definicionFillRate] = await Promise.all([
    clienteAny.definicionKpi.findFirst({ where: { codigo: "OTIF", estado: "PUBLICADA" } }),
    clienteAny.definicionKpi.findFirst({ where: { codigo: "OTIF_PROVEEDOR", estado: "PUBLICADA" } }),
    clienteAny.definicionKpi.findFirst({ where: { codigo: "FILL_RATE", estado: "PUBLICADA" }, orderBy: { numero: "desc" } }),
  ]);
  if (!definicionOtif || !definicionOtifProveedor || !definicionFillRate) {
    throw new Error("DEFINICIONES_KPI_NO_PUBLICADAS -- correr prisma/seedDefinicionesKpi.ts primero en este destino");
  }

  const empresa = await clienteAny.empresa.create({ data: { nombre: nombreEmpresa } });
  const cadena = await clienteAny.cadena.create({
    data: {
      empresaId: empresa.id,
      nombre: nombreEmpresa,
      productoServicio: "sintetico",
      periodoInicio: new Date("2026-01-01T00:00:00.000Z"),
      periodoFin: new Date("2026-12-31T00:00:00.000Z"),
      tipoOperacion: "manufactura",
    },
  });

  // CORRECCION (ronda 2 de revision, 2026-11-19, punto 1): usuarios
  // sinteticos DENTRO de este mismo tenant (empresa.id), para las
  // sesiones que cargaConsultas.ts necesita -- ver
  // crearUsuariosSinteticosParaCarga() arriba. Se hace apenas se conoce
  // empresa.id (nunca una busqueda posterior por nombre).
  await crearUsuariosSinteticosParaCarga(clienteAny, empresa.id, escala, cantidadUsuarios);

  // --- ObservacionKpi (OTIF_CAIDA): `plan.observacionKpiOtif` filas,
  // MISMO periodo, una sola fuente distinta por fila (ver el comentario
  // de planSiembraParaEscala() en configuracionRendimiento.ts). ---
  const periodoInicioKpi = new Date("2026-01-01T00:00:00.000Z");
  const periodoFinKpi = new Date("2026-01-31T00:00:00.000Z");
  for (let inicio = 0; inicio < plan.observacionKpiOtif; inicio += TAMANO_LOTE_INSERCION) {
    const lote = Array.from({ length: Math.min(TAMANO_LOTE_INSERCION, plan.observacionKpiOtif - inicio) }, (_, i) => {
      const n = inicio + i;
      return {
        empresaId: empresa.id,
        cadenaId: cadena.id,
        definicionKpiId: definicionOtif.id,
        periodoInicio: periodoInicioKpi,
        periodoFin: periodoFinKpi,
        valor: 0.9,
        numerador: 90,
        denominador: 100,
        fuente: `sintetico-rendimiento-${String(n).padStart(6, "0")}`,
        ruleVersion: RULE_VERSION_SINTETICA,
      };
    });
    await clienteAny.observacionKpi.createMany({ data: lote });
  }

  // --- ObservacionKpi (FALTANTES_FILL_RATE) -- CORRECCION (ronda 2 de
  // revision, 2026-11-19, punto 5): esta siembra faltaba por completo.
  // explicarConsultas.ts ya resuelve y filtra por definicionFillRateId
  // en el caso FALTANTES_FILL_RATE_periodo_exacto desde la ronda 1 de
  // revision, pero sin estas filas el EXPLAIN mediria un escaneo contra
  // un conjunto VACIO -- nunca el volumen real a la escala pedida.
  // MISMA escala, mismo periodo, misma secuencia de nombres de `fuente`
  // que el bloque de OTIF_CAIDA de arriba (no colisiona: el `@@unique`
  // de ObservacionKpi incluye definicionKpiId, y aca es
  // definicionFillRate.id, distinto de definicionOtif.id). ---
  for (let inicio = 0; inicio < plan.observacionKpiFillRate; inicio += TAMANO_LOTE_INSERCION) {
    const lote = Array.from({ length: Math.min(TAMANO_LOTE_INSERCION, plan.observacionKpiFillRate - inicio) }, (_, i) => {
      const n = inicio + i;
      return {
        empresaId: empresa.id,
        cadenaId: cadena.id,
        definicionKpiId: definicionFillRate.id,
        periodoInicio: periodoInicioKpi,
        periodoFin: periodoFinKpi,
        valor: 0.88,
        numerador: 88,
        denominador: 100,
        fuente: `sintetico-rendimiento-${String(n).padStart(6, "0")}`,
        ruleVersion: RULE_VERSION_SINTETICA,
      };
    });
    await clienteAny.observacionKpi.createMany({ data: lote });
  }

  // --- ObservacionOtifProveedor: `plan.observacionOtifProveedor`
  // proveedores DISTINTOS, MISMO periodo (escenario real de I5-02). ---
  for (let inicio = 0; inicio < plan.observacionOtifProveedor; inicio += TAMANO_LOTE_INSERCION) {
    const lote = Array.from({ length: Math.min(TAMANO_LOTE_INSERCION, plan.observacionOtifProveedor - inicio) }, (_, i) => {
      const n = inicio + i;
      const clave = `proveedor-sintetico-${String(n).padStart(6, "0")}`;
      return {
        empresaId: empresa.id,
        cadenaId: cadena.id,
        definicionKpiId: definicionOtifProveedor.id,
        periodoInicio: periodoInicioKpi,
        periodoFin: periodoFinKpi,
        proveedorAlias: clave,
        proveedorAliasClave: clave,
        valor: 0.85,
        numerador: 85,
        denominador: 100,
        fuente: "sintetico-rendimiento",
        ruleVersion: RULE_VERSION_SINTETICA,
      };
    });
    await clienteAny.observacionOtifProveedor.createMany({ data: lote });
  }

  // --- Nodo + ConexionCadena: `plan.conexionCadena` conexiones, cada
  // una entre un par de nodos DISTINTO (cadena de nodos consecutivos,
  // nodo[i] -> nodo[i+1]) -- respeta @@unique([origenNodoId, destinoNodoId]). ---
  const totalNodos = plan.conexionCadena + 1;
  const idsNodos: string[] = [];
  for (let inicio = 0; inicio < totalNodos; inicio += TAMANO_LOTE_INSERCION) {
    const cantidadLote = Math.min(TAMANO_LOTE_INSERCION, totalNodos - inicio);
    const lote = Array.from({ length: cantidadLote }, (_, i) => ({
      empresaId: empresa.id,
      cadenaId: cadena.id,
      nombre: `nodo-sintetico-${String(inicio + i).padStart(6, "0")}`,
      tipo: "PROCESO" as const,
    }));
    await clienteAny.nodo.createMany({ data: lote });
  }
  // createMany no devuelve los ids creados -- se recuperan con un
  // findMany ordenado por createdAt, unico momento en que esta cadena
  // sintetica tiene nodos (recien creada arriba), asi que el orden es
  // estable para este proposito puntual.
  const nodosCreados = await clienteAny.nodo.findMany({ where: { cadenaId: cadena.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
  for (const n of nodosCreados) idsNodos.push(n.id as string);

  for (let inicio = 0; inicio < plan.conexionCadena; inicio += TAMANO_LOTE_INSERCION) {
    const cantidadLote = Math.min(TAMANO_LOTE_INSERCION, plan.conexionCadena - inicio);
    const lote = Array.from({ length: cantidadLote }, (_, i) => {
      const n = inicio + i;
      return {
        empresaId: empresa.id,
        cadenaId: cadena.id,
        origenNodoId: idsNodos[n],
        destinoNodoId: idsNodos[n + 1],
      };
    });
    await clienteAny.conexionCadena.createMany({ data: lote });
  }
  // Mismo patron/justificacion que nodosCreados arriba -- createMany no
  // devuelve ids; se recuperan con un findMany ordenado por createdAt,
  // unico momento en que esta cadena sintetica tiene conexiones.
  // CORRECCION (Alex, 2026-11-19): estos ids son los que
  // construirFilasHallazgoCadenaSintetico() usa como "alcance conexion"
  // -- antes de esta correccion no se recuperaban porque HallazgoCadena
  // nunca los usaba.
  const conexionesCreadas = await clienteAny.conexionCadena.findMany({ where: { cadenaId: cadena.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const idsConexiones: string[] = conexionesCreadas.map((c: { id: string }) => c.id);

  // --- HallazgoCadena: `plan.hallazgoCadena` filas. BLOQUEO CORREGIDO
  // (Alex, 2026-11-19): la version anterior ponia TODAS las filas en el
  // alcance "cadena completa" (conexionCadenaId=null) ciclando las 6
  // dimensiones -- colisionaba con el indice unico parcial
  // hallazgos_cadena_cadena_dimension_key desde la septima fila en
  // adelante, en CUALQUIER escala >6 (ver migracion
  // 20260924010000_hallazgos_cadena_unique). Corregido distribuyendo las
  // filas entre el alcance "cadena completa" (hasta 6) y el alcance de
  // CADA ConexionCadena ya sembrada (hasta 6 por conexion) -- ver el
  // comentario completo en construirFilasHallazgoCadenaSintetico(),
  // arriba, que es quien decide la asignacion exacta (PURA, probada en
  // __tests__/semillaSinteticaConsultas.test.ts sin tocar Postgres). ---
  const filasHallazgoCadena = construirFilasHallazgoCadenaSintetico({
    empresaId: empresa.id,
    cadenaId: cadena.id,
    idsConexionesDisponibles: idsConexiones,
    cantidad: plan.hallazgoCadena,
    ahoraMs: Date.now(),
  });
  for (let inicio = 0; inicio < filasHallazgoCadena.length; inicio += TAMANO_LOTE_INSERCION) {
    const lote = filasHallazgoCadena.slice(inicio, inicio + TAMANO_LOTE_INSERCION);
    await clienteAny.hallazgoCadena.createMany({ data: lote });
  }

  console.log(`Sembrado OK -- empresaId=${empresa.id} cadenaId=${cadena.id} (nombre="${nombreEmpresa}").`);
}

async function limpiar(cliente: PrismaClient, escala: EscalaFilasPorCadena): Promise<void> {
  const nombreEmpresa = nombreEmpresaSinteticaParaEscala(escala);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
  const clienteAny = cliente as any;
  // Filtro EXACTO por nombre (nunca `contains` aca: nombreEmpresaSinteticaParaEscala
  // ya incluye la marca Y la escala -- un match exacto es mas estricto
  // que lo minimo necesario, a proposito) -- deleteMany({}) sin este
  // where estaria prohibido por el mismo motivo que en
  // limpiarTenantsPrueba.ts. El cascade (`onDelete: Cascade`) se encarga
  // de Cadena/Nodo/ConexionCadena/ObservacionKpi/ObservacionOtifProveedor/
  // HallazgoCadena/Usuario -- nunca hace falta un deleteMany aparte para
  // los usuarios de esta escala cuando se usa esta via.
  const resultado = await clienteAny.empresa.deleteMany({ where: { nombre: nombreEmpresa } });
  console.log(`Limpieza OK -- ${resultado.count} empresa(s) con nombre="${nombreEmpresa}" borrada(s) (cascade se encargo del resto, incluidos los usuarios sinteticos).`);
}

async function main(): Promise<void> {
  const escala = leerEscalaDeArgv();
  const dryRun = process.argv.includes("--dry-run");
  const soloLimpiar = process.argv.includes("--limpiar");
  const soloLimpiarUsuarios = process.argv.includes("--limpiar-usuarios");
  const cantidadUsuarios = leerCantidadUsuariosDeArgv();

  // Las DOS compuertas (host + destino exacto) -- nunca se omiten, ni
  // siquiera para --dry-run (--dry-run evita ESCRIBIR, no evita
  // confirmar el destino: una conexion de solo-verificacion igual
  // merece la misma disciplina).
  const destino = exigirDestinoRendimientoSeguro("SEED_DATABASE_URL", process.env.SEED_DATABASE_URL);
  console.log("Destino verificado:", JSON.stringify({ host: destino.host, base: destino.base, esquema: destino.esquema }));

  const cliente = construirClienteOwner();
  try {
    if (soloLimpiar) {
      await limpiar(cliente, escala);
    } else if (soloLimpiarUsuarios) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de construirClienteOwner()/sembrar()
      await revocarUsuariosSinteticosDeCarga(cliente as any, escala);
    } else {
      await sembrar(cliente, escala, dryRun, cantidadUsuarios);
    }
  } finally {
    await cliente.$disconnect();
  }
}

// Guard -- mismo patron ya establecido en scripts/rf20/ y
// scripts/rf19/ (ver explicarConsultas.ts para el comentario completo):
// evita que importar este archivo desde una prueba dispare main().
if (process.env.VITEST !== "true") {
  main().catch((error) => {
    // Nunca se imprime el error crudo si pudiera contener el connection
    // string (mismo criterio que verificacionSoloLecturaEntornoPrueba.ts)
    // -- solo su `.message`, que para los errores de este archivo son
    // siempre codigos fijos declarados arriba, nunca un valor de URL.
    console.error("SIEMBRA_ABORTADA:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
