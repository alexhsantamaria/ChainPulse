// RF24 -- orquestacion real del runbook de rama temporal Neon (v5
// Seccion 19 + autorizacion de PR-A, "crear el runbook bloqueado para
// futura validacion en una rama temporal Neon"). PENDIENTE DE
// AUTORIZACION -- esta sesion NUNCA llamo a esta funcion; ver
// scripts/rf24RamaTemporalNeonRunbook.ts para el envoltorio bloqueado.
//
// Reusa, sin reimplementar, la infraestructura ya existente y ya
// corregida de src/infra/pruebaRevocacion/ (destinoPrueba.ts,
// subproceso.ts, archivoProyecto.ts, clientePrueba.ts) -- el mismo
// patron de "doble autorizacion distinta" (ENTORNO_PRUEBA_CONFIRMADO +
// una segunda variable que autoriza la ACCION puntual, nunca la misma)
// que ya endurecio aplicarMigracionEntornoPrueba.ts en rondas previas.
// NO replica la capa completa de inyeccion de dependencias de
// orquestarAplicarMigracion.ts (esa granularidad de prueba unitaria se
// gano a traves de varias rondas de correccion especificas de Alex
// sobre ESE script) -- este modulo documenta esa diferencia en vez de
// aparentar el mismo nivel de cobertura unitaria que no tiene todavia.
//
// QUE HACE, EN ORDEN (nunca se salta un paso si el anterior no exigio
// abortar):
//   1. Verifica que DATABASE_URL (chainpulse_app) y SEED_DATABASE_URL
//      (neondb_owner) apuntan al MISMO destino (host/puerto/base/
//      esquema) -- mismo chequeo que aplicarMigracionEntornoPrueba.ts.
//   2. Exige ENTORNO_PRUEBA_CONFIRMADO="<destino exacto>" (variable YA
//      existente en el proyecto, nunca una nueva para el mismo
//      proposito) + verifica el rol EFECTIVO de ambas conexiones
//      (chainpulse_app sin BYPASSRLS/superuser; neondb_owner).
//   3. Lee el estado real de _prisma_migrations vs. el repo y decide el
//      modo via decidirModoMigracionesRf24(): "aplicar" (las 3 de RF24
//      son EXACTAMENTE las unicas pendientes), "continuar" (las 3 ya
//      estan aplicadas o son reversiones historicamente resueltas, cero
//      pendientes en total) o "bloqueado" (cualquier otro estado --
//      anomalia activa, reversion sin resolver, mezcla entre aplicada y
//      pendiente, pendientes ajenas a RF24, o un nombre de RF24 ausente
//      del historial -- aborta sin tocar nada).
//   4. Exige AUTORIZO_VALIDAR_RF24_RAMA_TEMPORAL="si" -- SEGUNDA
//      autorizacion, distinta de ENTORNO_PRUEBA_CONFIRMADO, que cubre
//      especificamente "aplicar o continuar con estas 3 migraciones RF24
//      Y correr las verificaciones de catalogo de abajo contra esa
//      rama" -- exigida en AMBOS modos, nunca solo en "aplicar".
//   5. Modo "aplicar": aplica las 3 migraciones (prisma migrate deploy
//      real, via el mismo mecanismo de resolucion de subproceso.ts).
//      Modo "continuar": NUNCA llama a migrate deploy -- imprime
//      MODO_CONTINUACION y sigue directo a la verificacion de abajo.
//      En AMBOS modos, vuelve a leer _prisma_migrations desde cero y
//      exige cero pendientes, cero anomalias activas, cero reversiones
//      sin resolucion y las 3 de RF24 aplicadas o resueltas -- nunca
//      confia en el estado leido ANTES de aplicar/continuar.
//   6. Corre, contra catalogo REAL (nunca simulado), las verificaciones
//      que las Pruebas 3/4/5/6 de la entrega de PR-A dejaron
//      "preparadas, no ejecutadas": privilegios de tabla de
//      chainpulse_app (debe ser cero), EXECUTE de PUBLIC (debe ser
//      cero) en las 12 funciones, EXECUTE de chainpulse_app en las 11
//      publicas (debe existir), propietario de las 12 (debe ser
//      neondb_owner), y la AUSENCIA de politica RLS en las 2 tablas
//      nuevas (decision documentada en la migracion 2 -- se reverifica
//      aca, nunca se asume).
//   7. Devuelve un resumen estructurado -- nunca imprime ni registra
//      ningun valor de conexion (mismo criterio que logError() del
//      resto de este paquete).
import { logError } from "../log";
import {
  ROL_APP_ESPERADO,
  ROL_ADMIN_ESPERADO,
  evaluarEstadoMigraciones,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexion,
  verificarRolConexionAdministrativa,
  type ClienteSoloLecturaRol,
  type EstadoMigraciones,
  type FilaMigracion,
} from "../pruebaRevocacion/destinoPrueba";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "../pruebaRevocacion/clientePrueba";
import { directorioProyecto, rutaEsquemaPrisma, migracionesEnRepo } from "../pruebaRevocacion/archivoProyecto";
import { ejecutarMigrateDeploy } from "../pruebaRevocacion/subproceso";

const MIGRACIONES_RF24_ESPERADAS_EN_ORDEN = [
  "20261022080000_rf24_enum_bucket_limite_tasa",
  "20261022090000_rf24_tabla_solicitud_derechos",
  "20261022100000_rf24_funciones_controladas",
];

const FUNCIONES_PUBLICAS_RF24 = [
  "crear_solicitud_derechos",
  "procesar_solicitud_derechos",
  "resolver_solicitud_por_soporte",
  "reclamar_solicitudes_derechos_para_envio",
  "asignar_token_pendiente",
  "confirmar_envio_token",
  "registrar_fallo_envio_solicitud_derechos",
  "cancelar_solicitud_derechos_por_envio_fallido",
  "reconciliar_solicitudes_derechos_agotadas",
  "expirar_solicitudes_derechos_vencidas",
  "purgar_solicitudes_derechos_segun_retencion",
];

const FUNCION_INTERNA_RF24 = "aplicar_efecto_solicitud_derechos";
const TABLAS_RF24 = ["solicitudes_derechos", "intentos_solicitud_derechos_descartados"];

export type ModoMigracionesRf24 = "aplicar" | "continuar" | "bloqueado";

export interface DecisionMigracionesRf24 {
  modo: ModoMigracionesRf24;
  motivo?: string;
}

type ClasificacionMigracionRf24 =
  | "aplicada"
  | "resuelta"
  | "pendiente"
  | "anomalia"
  | "reversion-sin-resolucion"
  | "ausente";

function clasificarNombreRf24(nombre: string, estado: EstadoMigraciones): ClasificacionMigracionRf24 {
  if (estado.anomaliasActivas.includes(nombre)) return "anomalia";
  if (estado.reversionesSinResolucion.includes(nombre)) return "reversion-sin-resolucion";
  if (estado.aplicadas.includes(nombre)) return "aplicada";
  if (estado.reversionesResueltas.includes(nombre)) return "resuelta";
  if (estado.pendientes.includes(nombre)) return "pendiente";
  return "ausente";
}

/**
 * Decision pura "aplicar / continuar / bloqueado" para las 3 migraciones de
 * RF24 -- flujo resumible exigido por Alex antes de volver a ejecutar el
 * runbook. No lee nada, no escribe nada, no depende de Prisma ni de la red:
 * solo clasifica el EstadoMigraciones ya calculado por evaluarEstadoMigraciones().
 *
 * Modo "aplicar": las 3 de RF24 son EXACTAMENTE las unicas pendientes, en su
 * orden exacto, y no hay ninguna otra migracion pendiente, con anomalia activa
 * o con reversion sin resolver en todo el repo.
 *
 * Modo "continuar": las 3 de RF24 estan todas en "aplicada" o "resuelta"
 * (reversion historicamente resuelta), y no queda NINGUNA migracion pendiente
 * en todo el repo (ni de RF24 ni de otra funcionalidad).
 *
 * Modo "bloqueado": cualquier otro estado -- mezcla entre aplicada/resuelta y
 * pendiente dentro de las 3 de RF24; una de las 3 con anomalia activa o
 * reversion sin resolver; una de las 3 ausente de todas las categorias;
 * pendientes ajenas a RF24 mientras las 3 de RF24 estan todas pendientes;
 * pendientes ajenas a RF24 mientras las 3 de RF24 ya estan aplicadas/resueltas;
 * o cualquier anomalia activa/reversion sin resolver fuera del conjunto RF24,
 * aunque las 3 de RF24 por si solas estuvieran bien.
 */
export function decidirModoMigracionesRf24(
  estado: EstadoMigraciones,
  migracionesRf24EnOrden: string[],
): DecisionMigracionesRf24 {
  const nombresRf24 = new Set(migracionesRf24EnOrden);

  const anomaliasFueraDeRf24 = estado.anomaliasActivas.filter((nombre) => !nombresRf24.has(nombre));
  const reversionesSinResolucionFueraDeRf24 = estado.reversionesSinResolucion.filter(
    (nombre) => !nombresRf24.has(nombre),
  );
  if (anomaliasFueraDeRf24.length > 0 || reversionesSinResolucionFueraDeRf24.length > 0) {
    return {
      modo: "bloqueado",
      motivo:
        "hay migraciones con anomalia activa o reversion sin resolucion fuera del conjunto RF24: " +
        `${[...anomaliasFueraDeRf24, ...reversionesSinResolucionFueraDeRf24].join(", ")}.`,
    };
  }

  const clasificaciones = migracionesRf24EnOrden.map((nombre) => ({
    nombre,
    clasificacion: clasificarNombreRf24(nombre, estado),
  }));

  const conProblema = clasificaciones.filter(
    (c) => c.clasificacion === "anomalia" || c.clasificacion === "reversion-sin-resolucion",
  );
  if (conProblema.length > 0) {
    return {
      modo: "bloqueado",
      motivo: `migraciones RF24 con anomalia activa o reversion sin resolucion: ${conProblema.map((c) => c.nombre).join(", ")}.`,
    };
  }

  const todasPendientes = clasificaciones.every((c) => c.clasificacion === "pendiente");
  const todasAplicadasOResueltas = clasificaciones.every(
    (c) => c.clasificacion === "aplicada" || c.clasificacion === "resuelta",
  );
  const pendientesFueraDeRf24 = estado.pendientes.filter((nombre) => !nombresRf24.has(nombre));

  if (todasPendientes) {
    if (pendientesFueraDeRf24.length > 0) {
      return {
        modo: "bloqueado",
        motivo: `hay migraciones pendientes fuera de RF24, ademas de las 3 esperadas: ${pendientesFueraDeRf24.join(", ")}.`,
      };
    }
    if (
      estado.pendientes.length !== migracionesRf24EnOrden.length ||
      !estado.pendientes.every((nombre, indice) => nombre === migracionesRf24EnOrden[indice])
    ) {
      return {
        modo: "bloqueado",
        motivo: `las migraciones pendientes no son EXACTAMENTE las 3 de RF24 en su orden exacto: ${estado.pendientes.join(", ")}.`,
      };
    }
    return { modo: "aplicar" };
  }

  if (todasAplicadasOResueltas) {
    if (estado.pendientes.length > 0) {
      return {
        modo: "bloqueado",
        motivo: `las 3 migraciones de RF24 ya estan aplicadas o resueltas, pero hay otras migraciones pendientes: ${estado.pendientes.join(", ")}.`,
      };
    }
    return { modo: "continuar" };
  }

  const detalle = clasificaciones.map((c) => `${c.nombre}=${c.clasificacion}`).join(", ");
  return {
    modo: "bloqueado",
    motivo: `estado mixto entre las 3 migraciones de RF24, ni todas pendientes ni todas aplicadas/resueltas: ${detalle}.`,
  };
}

export interface ResumenValidacionRamaTemporalRf24 {
  modoMigraciones: "aplicar" | "continuar";
  migracionesAplicadas: string[];
  tablasSinPrivilegiosDeChainpulseApp: boolean;
  funcionesSinExecuteParaPublic: boolean;
  funcionesPublicasConExecuteParaChainpulseApp: boolean;
  funcionInternaSinGrant: boolean;
  todasLasFuncionesSonDeNeondbOwner: boolean;
  tablasSinPoliticaRls: boolean;
}

export interface DependenciasValidacionRamaTemporalRf24 {
  databaseUrl: string | undefined;
  seedDatabaseUrl: string | undefined;
  autorizoValidarRamaTemporal: string | undefined;
}

function dependenciasReales(): DependenciasValidacionRamaTemporalRf24 {
  return {
    databaseUrl: process.env.DATABASE_URL,
    seedDatabaseUrl: process.env.SEED_DATABASE_URL,
    autorizoValidarRamaTemporal: process.env.AUTORIZO_VALIDAR_RF24_RAMA_TEMPORAL,
  };
}

export async function orquestarValidacionRamaTemporalRf24(
  deps: DependenciasValidacionRamaTemporalRf24 = dependenciasReales(),
): Promise<ResumenValidacionRamaTemporalRf24> {
  const contexto = "rf24-validacion-rama-temporal";

  const destinoApp = resumenUrl("DATABASE_URL", deps.databaseUrl);
  const destinoAdmin = resumenUrl("SEED_DATABASE_URL", deps.seedDatabaseUrl);
  if (
    destinoApp.host !== destinoAdmin.host ||
    destinoApp.puerto !== destinoAdmin.puerto ||
    destinoApp.base !== destinoAdmin.base ||
    destinoApp.esquema !== destinoAdmin.esquema
  ) {
    logError(contexto, "DESTINO_INESPERADO");
    throw new Error("DESTINO_INESPERADO -- DATABASE_URL y SEED_DATABASE_URL apuntan a destinos distintos.");
  }
  exigirEntornoConfirmado(destinoApp);

  const prismaApp: ClientePrueba = construirClientePrueba(deps.databaseUrl as string, `${contexto}:app`);
  const prismaAdmin: ClientePrueba = construirClientePrueba(deps.seedDatabaseUrl as string, `${contexto}:admin`);

  try {
    const rolApp = await verificarRolConexion(prismaApp as ClienteSoloLecturaRol, `${contexto}:app`, ROL_APP_ESPERADO);
    verificarDestinoEfectivo(rolApp, destinoApp, `${contexto}:app`);
    const rolAdmin = await verificarRolConexionAdministrativa(prismaAdmin as ClienteSoloLecturaRol, `${contexto}:admin`, ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(rolAdmin, destinoAdmin, `${contexto}:admin`);

    let filas: FilaMigracion[];
    try {
      filas = await prismaAdmin.$queryRaw<FilaMigracion[]>`
        SELECT migration_name, started_at, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `;
    } catch {
      logError(`${contexto}:migraciones`, "ERROR_CONSULTA_MIGRACIONES");
      throw new Error("ERROR_CONSULTA_MIGRACIONES");
    }

    const estado = evaluarEstadoMigraciones(filas, migracionesEnRepo(`${contexto}:migraciones`));
    const decision = decidirModoMigracionesRf24(estado, MIGRACIONES_RF24_ESPERADAS_EN_ORDEN);
    if (decision.modo === "bloqueado") {
      logError(`${contexto}:migraciones`, "ESTADO_MIGRACIONES_RF24_BLOQUEADO");
      throw new Error(`ESTADO_MIGRACIONES_RF24_BLOQUEADO -- ${decision.motivo}`);
    }

    if (deps.autorizoValidarRamaTemporal !== "si") {
      logError(contexto, "AUTORIZACION_DE_VALIDACION_FALTANTE");
      throw new Error(
        'AUTORIZACION_DE_VALIDACION_FALTANTE -- fija AUTORIZO_VALIDAR_RF24_RAMA_TEMPORAL="si" (distinto de ' +
          "ENTORNO_PRUEBA_CONFIRMADO) para aplicar y validar, despues de revisar lo de arriba.",
      );
    }

    if (decision.modo === "aplicar") {
      ejecutarMigrateDeploy(
        { directorioProyecto: directorioProyecto(), rutaEsquema: rutaEsquemaPrisma() },
        `${contexto}:subproceso`,
      );
    } else {
      // Modo B -- continuar: las 3 de RF24 ya estan aplicadas o son reversiones
      // historicamente resueltas, y no queda ninguna migracion pendiente. NUNCA se
      // llama a ejecutarMigrateDeploy() en este modo.
      console.log("MODO_CONTINUACION");
    }

    // Verificacion obligatoria POST, en AMBOS modos (requisito 2 de Alex): vuelve a leer
    // _prisma_migrations desde cero -- nunca reusa `estado`, que es anterior a aplicar o
    // continuar -- y exige cero pendientes, cero anomalias activas, cero reversiones sin
    // resolucion, y las 3 de RF24 en aplicadas o reversionesResueltas.
    let filasPost: FilaMigracion[];
    try {
      filasPost = await prismaAdmin.$queryRaw<FilaMigracion[]>`
        SELECT migration_name, started_at, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `;
    } catch {
      logError(`${contexto}:migraciones-post`, "ERROR_CONSULTA_MIGRACIONES_POST");
      throw new Error("ERROR_CONSULTA_MIGRACIONES_POST");
    }
    const estadoPost = evaluarEstadoMigraciones(filasPost, migracionesEnRepo(`${contexto}:migraciones-post`));
    const rf24AplicadasOResueltasPost = new Set([...estadoPost.aplicadas, ...estadoPost.reversionesResueltas]);
    const faltanRf24Post = MIGRACIONES_RF24_ESPERADAS_EN_ORDEN.filter(
      (nombre) => !rf24AplicadasOResueltasPost.has(nombre),
    );
    if (
      estadoPost.pendientes.length > 0 ||
      estadoPost.anomaliasActivas.length > 0 ||
      estadoPost.reversionesSinResolucion.length > 0 ||
      faltanRf24Post.length > 0
    ) {
      logError(`${contexto}:migraciones-post`, "ESTADO_MIGRACIONES_RF24_INCOMPLETO_TRAS_VALIDAR");
      throw new Error(
        "ESTADO_MIGRACIONES_RF24_INCOMPLETO_TRAS_VALIDAR -- tras aplicar/continuar, _prisma_migrations no quedo " +
          "en el estado exigido (cero pendientes, cero anomalias activas, cero reversiones sin resolucion, las " +
          "3 de RF24 aplicadas o resueltas). " +
          `Pendientes: ${estadoPost.pendientes.join(", ") || "(ninguna)"}; ` +
          `anomalias activas: ${estadoPost.anomaliasActivas.join(", ") || "(ninguna)"}; ` +
          `reversiones sin resolucion: ${estadoPost.reversionesSinResolucion.join(", ") || "(ninguna)"}; ` +
          `RF24 faltantes: ${faltanRf24Post.join(", ") || "(ninguna)"}.`,
      );
    }

    // --- Verificaciones de catalogo real, post-aplicacion (Pruebas 3/4/5/6) ---
    const privilegiosTabla = await prismaAdmin.$queryRaw<Array<{ privilege_type: string }>>`
      SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = ANY(${TABLAS_RF24}) AND grantee = ${ROL_APP_ESPERADO}`;
    const tablasSinPrivilegiosDeChainpulseApp = privilegiosTabla.length === 0;

    const todasLasFunciones = [...FUNCIONES_PUBLICAS_RF24, FUNCION_INTERNA_RF24];
    const grantsExecutePublic = await prismaAdmin.$queryRaw<Array<{ routine_name: string }>>`
      SELECT routine_name FROM information_schema.routine_privileges
        WHERE routine_schema = 'public' AND routine_name = ANY(${todasLasFunciones})
          AND privilege_type = 'EXECUTE' AND grantee = 'PUBLIC'`;
    const funcionesSinExecuteParaPublic = grantsExecutePublic.length === 0;

    const grantsExecuteChainpulseApp = await prismaAdmin.$queryRaw<Array<{ routine_name: string }>>`
      SELECT routine_name FROM information_schema.routine_privileges
        WHERE routine_schema = 'public' AND routine_name = ANY(${FUNCIONES_PUBLICAS_RF24})
          AND privilege_type = 'EXECUTE' AND grantee = ${ROL_APP_ESPERADO}`;
    const funcionesPublicasConExecuteParaChainpulseApp =
      new Set(grantsExecuteChainpulseApp.map((f: { routine_name: string }) => f.routine_name)).size === FUNCIONES_PUBLICAS_RF24.length;

    const grantInternaChainpulseApp = await prismaAdmin.$queryRaw<Array<{ routine_name: string }>>`
      SELECT routine_name FROM information_schema.routine_privileges
        WHERE routine_schema = 'public' AND routine_name = ${FUNCION_INTERNA_RF24} AND grantee = ${ROL_APP_ESPERADO}`;
    const funcionInternaSinGrant = grantInternaChainpulseApp.length === 0;

    const propietarios = await prismaAdmin.$queryRaw<Array<{ proname: string; rolname: string }>>`
      SELECT p.proname, r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = ANY(${todasLasFunciones}) AND p.pronamespace = 'public'::regnamespace`;
    const todasLasFuncionesSonDeNeondbOwner =
      propietarios.length === todasLasFunciones.length &&
      propietarios.every((p: { rolname: string }) => p.rolname === ROL_ADMIN_ESPERADO);

    const politicasRls = await prismaAdmin.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(${TABLAS_RF24})`;
    const tablasSinPoliticaRls = politicasRls.length === 0;

    return {
      modoMigraciones: decision.modo,
      migracionesAplicadas: MIGRACIONES_RF24_ESPERADAS_EN_ORDEN,
      tablasSinPrivilegiosDeChainpulseApp,
      funcionesSinExecuteParaPublic,
      funcionesPublicasConExecuteParaChainpulseApp,
      funcionInternaSinGrant,
      todasLasFuncionesSonDeNeondbOwner,
      tablasSinPoliticaRls,
    };
  } finally {
    await desconectarClientePrueba(prismaApp, `${contexto}:desconexion-app`);
    await desconectarClientePrueba(prismaAdmin, `${contexto}:desconexion-admin`);
  }
}
