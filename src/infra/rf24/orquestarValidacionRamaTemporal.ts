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
import { diagnosticoErrorConsultaCruda } from "../prisma/errores";
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
  // Ronda 8 (Alex): 4a migracion, correctiva -- revoca los 8 privilegios
  // directos inesperados (SELECT/INSERT/UPDATE/DELETE de chainpulse_app)
  // confirmados por Alex sobre las 2 tablas de RF24. Ver el header de esa
  // migracion para el detalle completo de la auditoria que la precede.
  "20261023053758_rf24_revocar_privilegios_directos_tablas_derechos",
  // Ronda 9 (Alex): 5a migracion, correctiva -- CREATE OR REPLACE sobre
  // las 2 funciones con defectos PRODUCTIVOS confirmados por la
  // auditoria consolidada de los 24 fallos reales de v10.1 (A1:
  // SQLSTATE 42702 en crear_solicitud_derechos; A2: id NOT NULL sin
  // poblar en el INSERT de aplicar_efecto_solicitud_derechos sobre
  // consentimientos_expres). Ver el header de esa migracion para el
  // detalle completo.
  "20261023160000_rf24_correccion_ambiguedad_id_y_consentimiento_sin_id",
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

  const pendientesFueraDeRf24 = estado.pendientes.filter((nombre) => !nombresRf24.has(nombre));

  const todasPendientes = clasificaciones.every((c) => c.clasificacion === "pendiente");
  const todasAplicadasOResueltas = clasificaciones.every(
    (c) => c.clasificacion === "aplicada" || c.clasificacion === "resuelta",
  );

  if (todasPendientes) {
    if (pendientesFueraDeRf24.length > 0) {
      return {
        modo: "bloqueado",
        motivo: `hay migraciones pendientes fuera de RF24, ademas de las esperadas: ${pendientesFueraDeRf24.join(", ")}.`,
      };
    }
    if (
      estado.pendientes.length !== migracionesRf24EnOrden.length ||
      !estado.pendientes.every((nombre, indice) => nombre === migracionesRf24EnOrden[indice])
    ) {
      return {
        modo: "bloqueado",
        motivo: `las migraciones pendientes no son EXACTAMENTE las de RF24 en su orden exacto: ${estado.pendientes.join(", ")}.`,
      };
    }
    return { modo: "aplicar" };
  }

  if (todasAplicadasOResueltas) {
    if (estado.pendientes.length > 0) {
      return {
        modo: "bloqueado",
        motivo: `las migraciones de RF24 ya estan aplicadas o resueltas, pero hay otras migraciones pendientes: ${estado.pendientes.join(", ")}.`,
      };
    }
    return { modo: "continuar" };
  }

  // Ronda 8 (Alex): generalizacion para reconocer un PREFIJO continuo
  // aplicado/resuelto seguido de un SUFIJO continuo pendiente dentro del
  // propio conjunto RF24 -- escenario real una vez que existe una 4a
  // migracion (la correctiva de privilegios) mientras las primeras 3 ya
  // estan aplicadas. Antes de esta generalizacion CUALQUIER mezcla caia
  // en el catch-all "estado mixto" y bloqueaba sin necesidad -- ahora se
  // distingue explicitamente este unico patron adicional de cualquier
  // otra mezcla real (aplicada DESPUES de pendiente, huecos, una
  // migracion "ausente", etc., que siguen bloqueando exactamente igual
  // que antes, via el catch-all de abajo).
  const primerIndicePendiente = clasificaciones.findIndex((c) => c.clasificacion === "pendiente");
  const esPrefijoAplicadoSufijoPendiente =
    primerIndicePendiente > 0 &&
    clasificaciones
      .slice(0, primerIndicePendiente)
      .every((c) => c.clasificacion === "aplicada" || c.clasificacion === "resuelta") &&
    clasificaciones.slice(primerIndicePendiente).every((c) => c.clasificacion === "pendiente");

  if (esPrefijoAplicadoSufijoPendiente) {
    const colaEsperada = migracionesRf24EnOrden.slice(primerIndicePendiente);
    if (pendientesFueraDeRf24.length > 0) {
      return {
        modo: "bloqueado",
        motivo:
          "hay un prefijo de RF24 ya aplicado/resuelto y un sufijo pendiente, pero ademas hay migraciones " +
          `pendientes fuera de RF24: ${pendientesFueraDeRf24.join(", ")}.`,
      };
    }
    if (
      estado.pendientes.length !== colaEsperada.length ||
      !estado.pendientes.every((nombre, indice) => nombre === colaEsperada[indice])
    ) {
      return {
        modo: "bloqueado",
        motivo:
          "el prefijo aplicado/resuelto de RF24 es valido, pero las migraciones pendientes globales no " +
          `coinciden EXACTAMENTE con el sufijo pendiente esperado de RF24: pendientes=${estado.pendientes.join(", ") || "(ninguna)"}, ` +
          `sufijo esperado=${colaEsperada.join(", ")}.`,
      };
    }
    return { modo: "aplicar" };
  }

  const detalle = clasificaciones.map((c) => `${c.nombre}=${c.clasificacion}`).join(", ");
  return {
    modo: "bloqueado",
    motivo: `estado mixto entre las migraciones de RF24, no es "todas pendientes", "todas aplicadas/resueltas" ni un prefijo aplicado/resuelto + sufijo pendiente valido: ${detalle}.`,
  };
}

// Ronda 7 (Alex, punto 1): fila completa de information_schema.role_table_grants
// -- esquema (siempre 'public' en este chequeo, no se repite por fila),
// tabla, grantee, privilege_type, grantor e is_grantable. table_name,
// grantee y grantor son sql_identifier (dominio sobre "name", mismo
// defecto de adaptador ya corregido en ronda 6 para las funciones) --
// casteados a ::text en la consulta misma.
export interface FilaPrivilegioTablaRf24 {
  table_name: string;
  privilege_type: string;
  grantee: string;
  grantor: string;
  is_grantable: string;
}

// Ronda 8 (Alex): diagnostico de pg_default_acl/aclexplode para el ORIGEN
// de los 8 privilegios directos inesperados que la ronda 7 confirmo sobre
// las 2 tablas de RF24. grantee ya viene resuelto a 'PUBLIC' cuando el oid
// de aclexplode() es 0 (mismo patron ya establecido en la migracion
// 20261005120000_reconstruccion_rls_auth_grants, Seccion E) o al nombre de
// rol real en cualquier otro caso. esquema es '(todos los esquemas)' para
// defaclnamespace = 0 (el default aplica a CUALQUIER esquema donde
// neondb_owner cree una tabla) o el nombre real del esquema en otro caso.
export interface FilaDefaultAclTablaRf24 {
  esquema: string;
  privilege_type: string | null;
  grantee: string | null;
  is_grantable: boolean | null;
}

// Ronda 9 (Alex): verificacion POST-aplicacion, BLOQUEANTE (a diferencia
// del diagnostico de pg_default_acl de arriba, que es informativo), de
// que las 2 funciones de la migracion 5 quedaron exactamente como
// autorizo Alex -- firma (via pg_get_function_identity_arguments, que
// SI conserva los nombres de parametro declarados, nunca los omite),
// SECURITY DEFINER (asimetria deliberada: presente en
// crear_solicitud_derechos, ausente en aplicar_efecto_solicitud_derechos),
// propietario (debe seguir siendo neondb_owner) y search_path (debe
// seguir siendo exactamente "public, pg_temp"). proname/propietario son
// tipo nativo "name" (OID 19) -- mismo cast ::text ya usado en el resto
// de este modulo. search_path se extrae de pg_proc.proconfig (arreglo de
// texto "clave=valor") buscando la entrada "search_path=..." y recortando
// el prefijo fijo "search_path=" (12 caracteres, substring desde la
// posicion 13) -- NULL si la funcion no tuviera ninguna entrada
// search_path en proconfig (no deberia ocurrir; nunca se asume, se
// reporta como discrepancia si pasara).
export interface FilaDefinicionFuncionMigracion5 {
  proname: string;
  identidad_argumentos: string;
  prosecdef: boolean;
  propietario: string;
  search_path: string | null;
}

export interface DiscrepanciaDefinicionMigracion5 {
  proname: string;
  motivo: string;
}

const DEFINICIONES_ESPERADAS_MIGRACION_5: ReadonlyArray<{
  proname: string;
  identidadArgumentosEsperada: string;
  securityDefinerEsperado: boolean;
}> = [
  {
    proname: "crear_solicitud_derechos",
    identidadArgumentosEsperada:
      "p_evaluacion_id text, p_correo_hash_entrante text, p_tipo text, p_alcance_retiro text, p_huella_hash text",
    securityDefinerEsperado: true,
  },
  {
    proname: "aplicar_efecto_solicitud_derechos",
    identidadArgumentosEsperada: "p_evaluacion_id text, p_tipo text, p_alcance_retiro text, p_metodo_retiro text",
    securityDefinerEsperado: false,
  },
];

const FUNCIONES_MIGRACION_5_ESPERADAS = DEFINICIONES_ESPERADAS_MIGRACION_5.map((d) => d.proname);

/**
 * Funcion PURA (sin tocar la base) -- compara las filas reales de
 * catalogo contra DEFINICIONES_ESPERADAS_MIGRACION_5. Nunca solo un
 * booleano (mismo criterio ya establecido en todo este modulo, puntos 4
 * de rondas 6/7): cada discrepancia trae el proname afectado y el valor
 * esperado vs. el real, nunca se corrige aqui.
 */
export function evaluarDefinicionesMigracion5(
  filas: FilaDefinicionFuncionMigracion5[],
): { coincide: boolean; discrepancias: DiscrepanciaDefinicionMigracion5[] } {
  const porNombre = new Map(filas.map((f) => [f.proname, f]));
  const discrepancias: DiscrepanciaDefinicionMigracion5[] = [];
  for (const esperada of DEFINICIONES_ESPERADAS_MIGRACION_5) {
    const real = porNombre.get(esperada.proname);
    if (!real) {
      discrepancias.push({ proname: esperada.proname, motivo: "funcion ausente en pg_proc (esquema public)" });
      continue;
    }
    if (real.identidad_argumentos !== esperada.identidadArgumentosEsperada) {
      discrepancias.push({
        proname: esperada.proname,
        motivo: `firma inesperada: esperada="${esperada.identidadArgumentosEsperada}" real="${real.identidad_argumentos}"`,
      });
    }
    if (real.prosecdef !== esperada.securityDefinerEsperado) {
      discrepancias.push({
        proname: esperada.proname,
        motivo: `SECURITY DEFINER inesperado: esperado=${esperada.securityDefinerEsperado} real=${real.prosecdef}`,
      });
    }
    if (real.propietario !== ROL_ADMIN_ESPERADO) {
      discrepancias.push({
        proname: esperada.proname,
        motivo: `propietario inesperado: esperado=${ROL_ADMIN_ESPERADO} real=${real.propietario}`,
      });
    }
    if (real.search_path !== "public, pg_temp") {
      discrepancias.push({
        proname: esperada.proname,
        motivo: `search_path inesperado: esperado="public, pg_temp" real=${real.search_path ?? "NULL"}`,
      });
    }
  }
  return { coincide: discrepancias.length === 0, discrepancias };
}

export interface ResumenValidacionRamaTemporalRf24 {
  modoMigraciones: "aplicar" | "continuar";
  migracionesAplicadas: string[];
  tablasSinPrivilegiosDeChainpulseApp: boolean;
  // Punto 4 (Alex, ronda 7): filas EXACTAS (tabla/privilegio/grantee/
  // grantor/is_grantable) si tablasSinPrivilegiosDeChainpulseApp es
  // false -- nunca solo el booleano. Vacio cuando es true. Nunca se
  // corrige aqui (ni REVOKE manual ni migracion nueva) -- solo se
  // reporta; la validacion ya aborta via el todoOk existente.
  privilegiosTablaInesperadosParaChainpulseApp: FilaPrivilegioTablaRf24[];
  // Punto 3 (Alex): la migracion 2 de RF24 hace REVOKE ALL ... FROM PUBLIC
  // explicito sobre estas mismas 2 tablas -- esto lo reverifica contra
  // catalogo real en vez de asumirlo (mismo alcance exacto de tablas,
  // punto 2: nunca se mezcla con privilegios de chainpulse_app sobre
  // otras tablas del proyecto).
  tablasSinPrivilegiosParaPublic: boolean;
  privilegiosTablaInesperadosParaPublic: FilaPrivilegioTablaRf24[];
  funcionesSinExecuteParaPublic: boolean;
  // Punto 4 (Alex, ronda 6): si funcionesSinExecuteParaPublic es false,
  // este arreglo trae los routine_name EXACTOS que tienen un GRANT EXECUTE
  // a PUBLIC inesperado -- nunca solo el booleano. Vacio cuando
  // funcionesSinExecuteParaPublic es true. Nunca se corrige aqui ni se
  // genera una migracion nueva -- solo se reporta y la validacion ya
  // aborta (ver el chequeo todoOk en scripts/rf24RamaTemporalNeonRunbook.ts).
  funcionesConExecuteInesperadoParaPublic: string[];
  funcionesPublicasConExecuteParaChainpulseApp: boolean;
  funcionInternaSinGrant: boolean;
  todasLasFuncionesSonDeNeondbOwner: boolean;
  tablasSinPoliticaRls: boolean;
  // Ronda 9 (Alex): BLOQUEANTE (a diferencia del diagnostico de
  // pg_default_acl de abajo) -- true solo si las 2 funciones de la
  // migracion 5 coinciden EXACTAMENTE con lo esperado (firma, SECURITY
  // DEFINER, propietario, search_path). discrepancias trae el detalle
  // completo (nunca solo el booleano) cuando es false; vacio cuando es
  // true.
  funcionesMigracion5ConDefinicionEsperada: boolean;
  discrepanciasDefinicionMigracion5: DiscrepanciaDefinicionMigracion5[];
  // Ronda 8 (Alex): diagnostico de SOLO LECTURA, NUNCA bloqueante -- ver
  // diagnosticarDefaultAclTablasNeondbOwner() mas abajo. null cuando la
  // propia consulta de diagnostico fallo (el motivo saneado queda en
  // defaultAclTablasNeondbOwnerError); arreglo vacio cuando no existe
  // ningun ALTER DEFAULT PRIVILEGES de neondb_owner sobre objetos tipo
  // tabla; arreglo no vacio cuando SI existe (esto es lo que confirmaria
  // o refutaria, contra catalogo real, la hipotesis de origen externo
  // documentada en el header de la migracion correctiva).
  defaultAclTablasNeondbOwner: FilaDefaultAclTablaRf24[] | null;
  defaultAclTablasNeondbOwnerError?: string;
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

/**
 * Envoltorio de diagnostico para las consultas de catalogo POST-aplicacion.
 * Correccion real (Alex, ejecucion en Windows contra la rama temporal real):
 * "prisma migrate deploy" aplico las 3 migraciones con exito, pero el script
 * aborto justo despues con "fallo o excedio el timeout de 240s" SIN ningun
 * diagnostico -- porque estas 6 consultas no tenian try/catch ni logError en
 * absoluto, y el catch del wrapper (scripts/rf24RamaTemporalNeonRunbook.ts)
 * descartaba el objeto Error real. Esta funcion cierra ambos huecos: cada
 * consulta ahora pasa por una ETIQUETA UNICA y especifica (nunca generica),
 * y logError() ya imprime mensaje+stack de forma segura (nunca la URL de
 * conexion: estos catch siguen "sin binding" del error crudo del driver,
 * igual que en subproceso.ts, asi que nunca se reenvia nada mas alla de la
 * etiqueta fija) -- la etiqueta sola ya dice EXACTAMENTE cual de las 6
 * consultas fallo, cosa que antes era imposible saber desde afuera.
 */
async function consultarCatalogoRf24<T>(etiqueta: string, contexto: string, consulta: () => Promise<T>): Promise<T> {
  try {
    return await consulta();
  } catch (err) {
    // Ronda 6 (Alex): antes este catch estaba "sin binding" y descartaba
    // TODO detalle del error -- asi fallo GRANTS_EXECUTE_PUBLIC sin dejar
    // saber si era SQL, firma, permiso o un grant real inesperado. Ahora
    // se extrae, con diagnosticoErrorConsultaCruda() (duck-typing
    // defensivo, nunca reenvia el error crudo ni la URL de conexion -- ver
    // ese helper en src/infra/prisma/errores.ts), el SQLSTATE real (si lo
    // hay), la severidad (si lo hay), el tipo de columna no soportado por
    // el adaptador (si ese fue el caso, como en GRANTS_EXECUTE_PUBLIC esta
    // ronda) y un mensaje ya saneado -- todo opcional, nunca se inventa un
    // valor que no vino del error.
    const diag = diagnosticoErrorConsultaCruda(err);
    const detalle =
      `codigo_prisma=${diag.codigoPrisma ?? "N/A"} sqlstate=${diag.sqlstate ?? "N/A"} ` +
      `severidad=${diag.severidad ?? "N/A"} tipo_no_soportado=${diag.tipoNoSoportado ?? "N/A"} ` +
      `mensaje=${diag.mensaje ?? "N/A"}`;
    logError(`${contexto}:catalogo:${etiqueta}`, `ERROR_CONSULTA_CATALOGO_${etiqueta} -- ${detalle}`);
    throw new Error(
      `ERROR_CONSULTA_CATALOGO_${etiqueta} -- fallo la consulta de catalogo "${etiqueta}" (post-migracion/post-continuacion). ${detalle}. ` +
        "Nunca se imprime la URL de conexion ni el error crudo del driver -- solo SQLSTATE/severidad/mensaje ya saneados (ver diagnosticoErrorConsultaCruda en src/infra/prisma/errores.ts).",
    );
  }
}

/**
 * Ronda 8 (Alex): diagnostico de SOLO LECTURA, NUNCA bloqueante, sobre el
 * origen de los 8 privilegios directos inesperados que la ronda 7 confirmo
 * (SELECT/INSERT/UPDATE/DELETE de chainpulse_app sobre las 2 tablas de
 * RF24, grantor=neondb_owner en todos los casos). Punto 1 del pedido de
 * Alex: revisa pg_default_acl/aclexplode para neondb_owner, objetos tipo
 * tabla (defaclobjtype = 'r'), sin restriccion de esquema (para ver
 * tambien un posible default "para todos los esquemas", defaclnamespace
 * = 0). A diferencia de TODAS las demas consultas de este modulo, un
 * fallo AQUI nunca aborta la validacion -- es un diagnostico adicional
 * sobre el ORIGEN del problema ya detectado y ya resuelto por la
 * migracion correctiva, nunca un gate nuevo. Si falla, se reporta el
 * motivo saneado (nunca la URL de conexion ni el error crudo del driver)
 * y el resto de la validacion sigue su curso exactamente igual que si
 * esta funcion no existiera.
 */
async function diagnosticarDefaultAclTablasNeondbOwner(
  prismaAdmin: ClientePrueba,
  contexto: string,
): Promise<{ filas: FilaDefaultAclTablaRf24[] | null; error?: string }> {
  try {
    const filas = await prismaAdmin.$queryRaw<FilaDefaultAclTablaRf24[]>`
      SELECT COALESCE(n.nspname::text, '(todos los esquemas)') AS esquema,
             a.privilege_type,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname::text END AS grantee,
             a.is_grantable
        FROM pg_default_acl d
        JOIN pg_roles r ON r.oid = d.defaclrole
        LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
        LEFT JOIN LATERAL aclexplode(d.defaclacl) a ON true
        LEFT JOIN pg_roles g ON g.oid = a.grantee
        WHERE r.rolname::text = ${ROL_ADMIN_ESPERADO} AND d.defaclobjtype = 'r'`;
    return { filas };
  } catch (err) {
    const diag = diagnosticoErrorConsultaCruda(err);
    const detalle =
      `codigo_prisma=${diag.codigoPrisma ?? "N/A"} sqlstate=${diag.sqlstate ?? "N/A"} ` +
      `severidad=${diag.severidad ?? "N/A"} tipo_no_soportado=${diag.tipoNoSoportado ?? "N/A"} ` +
      `mensaje=${diag.mensaje ?? "N/A"}`;
    logError(
      `${contexto}:catalogo:DEFAULT_ACL_TABLAS_NEONDB_OWNER`,
      `DIAGNOSTICO_NO_BLOQUEANTE_FALLO -- ${detalle}`,
    );
    return { filas: null, error: detalle };
  }
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
    // Cada consulta pasa por consultarCatalogoRf24() con su propia etiqueta --
    // antes de esta correccion, ninguna tenia try/catch ni logError, asi que
    // un fallo aqui abortaba sin dejar NINGUN rastro de cual consulta fallo.
    // Ronda 7 (Alex, punto 1): antes esta consulta solo traia privilege_type
    // (suficiente para el booleano, insuficiente para auditar que privilegio
    // exacto aparecio) -- ahora trae la fila completa de role_table_grants.
    // Punto 2: table_schema='public' AND table_name = ANY(TABLAS_RF24) sigue
    // exactamente igual -- limitado EXCLUSIVAMENTE a las 2 tablas de RF24,
    // nunca se confunde con un privilegio legitimo de chainpulse_app sobre
    // otra tabla del proyecto (eslabones, conexiones, etc., que tienen
    // nombres distintos y quedan fuera de este arreglo).
    const privilegiosTabla = await consultarCatalogoRf24<FilaPrivilegioTablaRf24[]>("PRIVILEGIOS_TABLA", contexto, () =>
      prismaAdmin.$queryRaw<FilaPrivilegioTablaRf24[]>`
        SELECT table_name::text AS table_name, privilege_type, grantee::text AS grantee,
               grantor::text AS grantor, is_grantable
          FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = ANY(${TABLAS_RF24}) AND grantee = ${ROL_APP_ESPERADO}`,
    );
    const tablasSinPrivilegiosDeChainpulseApp = privilegiosTabla.length === 0;
    const privilegiosTablaInesperadosParaChainpulseApp = privilegiosTabla;

    // Punto 3 (Alex): la migracion 2 de RF24 (20261022090000_rf24_tabla_
    // solicitud_derechos) hace "REVOKE ALL ... FROM PUBLIC" explicito sobre
    // "solicitudes_derechos" e "intentos_solicitud_derechos_descartados"
    // -- se reverifica aqui contra catalogo real, igual que el resto de
    // este modulo nunca asume un estado sin probarlo. Si chainpulse_app NO
    // es miembro de ningun rol intermedio con privilegios sobre estas 2
    // tablas (no hay ninguno documentado en este proyecto -- chainpulse_app
    // es el rol de runtime de la aplicacion, sin miembros propios) un
    // privilegio heredado por membresia de roles no aplicaria aqui; esta
    // consulta cubre la otra via real de herencia (PUBLIC).
    const privilegiosTablaPublic = await consultarCatalogoRf24<FilaPrivilegioTablaRf24[]>("PRIVILEGIOS_TABLA_PUBLIC", contexto, () =>
      prismaAdmin.$queryRaw<FilaPrivilegioTablaRf24[]>`
        SELECT table_name::text AS table_name, privilege_type, grantee::text AS grantee,
               grantor::text AS grantor, is_grantable
          FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = ANY(${TABLAS_RF24}) AND grantee = 'PUBLIC'`,
    );
    const tablasSinPrivilegiosParaPublic = privilegiosTablaPublic.length === 0;
    const privilegiosTablaInesperadosParaPublic = privilegiosTablaPublic;

    const todasLasFunciones = [...FUNCIONES_PUBLICAS_RF24, FUNCION_INTERNA_RF24];
    // Ronda 6 (Alex, punto 1/2): routine_name es de tipo sql_identifier en
    // information_schema (dominio sobre el tipo nativo "name", OID 19) --
    // @prisma/adapter-pg (6.19.3) no tiene mapeo para ese OID (confirmado
    // leyendo fieldToColumnType() en node_modules/) y lanza
    // UnsupportedNativeDataType ANTES de que la consulta llegue a tener
    // exito o fallo real en Postgres -- esta es la causa confirmada del
    // fallo real de esta consulta contra la rama temporal, NO un error de
    // SQL, NO un nombre/firma incorrecto (las 12 firmas se compararon
    // literalmente contra la migracion, todas coinciden) y NO un permiso
    // insuficiente de neondb_owner. El cast ::text (mismo patron ya usado
    // en restablecerPasswordMantenimiento.ts para current_user) evita el
    // problema de raiz sin cambiar la semantica de la consulta.
    const grantsExecutePublic = await consultarCatalogoRf24<Array<{ routine_name: string }>>("GRANTS_EXECUTE_PUBLIC", contexto, () =>
      prismaAdmin.$queryRaw<Array<{ routine_name: string }>>`
        SELECT routine_name::text AS routine_name FROM information_schema.routine_privileges
          WHERE routine_schema = 'public' AND routine_name = ANY(${todasLasFunciones})
            AND privilege_type = 'EXECUTE' AND grantee = 'PUBLIC'`,
    );
    const funcionesSinExecuteParaPublic = grantsExecutePublic.length === 0;
    // Punto 4 (Alex): firmas EXACTAS afectadas si hay un grant inesperado
    // a PUBLIC -- nunca se corrige aqui ni se genera una migracion nueva.
    const funcionesConExecuteInesperadoParaPublic = grantsExecutePublic.map((f: { routine_name: string }) => f.routine_name);

    // Mismo defecto que GRANTS_EXECUTE_PUBLIC (punto 6: auditadas las 5
    // consultas restantes antes de entregar, no una correccion por
    // consulta) -- mismo cast ::text.
    const grantsExecuteChainpulseApp = await consultarCatalogoRf24<Array<{ routine_name: string }>>("GRANTS_EXECUTE_CHAINPULSE_APP", contexto, () =>
      prismaAdmin.$queryRaw<Array<{ routine_name: string }>>`
        SELECT routine_name::text AS routine_name FROM information_schema.routine_privileges
          WHERE routine_schema = 'public' AND routine_name = ANY(${FUNCIONES_PUBLICAS_RF24})
            AND privilege_type = 'EXECUTE' AND grantee = ${ROL_APP_ESPERADO}`,
    );
    const funcionesPublicasConExecuteParaChainpulseApp =
      new Set(grantsExecuteChainpulseApp.map((f: { routine_name: string }) => f.routine_name)).size === FUNCIONES_PUBLICAS_RF24.length;

    // Mismo defecto (punto 6) -- mismo cast ::text.
    const grantInternaChainpulseApp = await consultarCatalogoRf24<Array<{ routine_name: string }>>("GRANT_INTERNA_CHAINPULSE_APP", contexto, () =>
      prismaAdmin.$queryRaw<Array<{ routine_name: string }>>`
        SELECT routine_name::text AS routine_name FROM information_schema.routine_privileges
          WHERE routine_schema = 'public' AND routine_name = ${FUNCION_INTERNA_RF24} AND grantee = ${ROL_APP_ESPERADO}`,
    );
    const funcionInternaSinGrant = grantInternaChainpulseApp.length === 0;

    // Mismo defecto (punto 6): p.proname y r.rolname son de tipo nativo
    // "name" (OID 19) en pg_proc/pg_roles -- mismo cast ::text en ambos.
    const propietarios = await consultarCatalogoRf24<Array<{ proname: string; rolname: string }>>("PROPIETARIOS_FUNCIONES", contexto, () =>
      prismaAdmin.$queryRaw<Array<{ proname: string; rolname: string }>>`
        SELECT p.proname::text AS proname, r.rolname::text AS rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.proname = ANY(${todasLasFunciones}) AND p.pronamespace = 'public'::regnamespace`,
    );
    const todasLasFuncionesSonDeNeondbOwner =
      propietarios.length === todasLasFunciones.length &&
      propietarios.every((p: { rolname: string }) => p.rolname === ROL_ADMIN_ESPERADO);

    // Mismo defecto (punto 6): pg_policies.tablename tambien es "name" --
    // mismo cast ::text.
    const politicasRls = await consultarCatalogoRf24<Array<{ tablename: string }>>("POLITICAS_RLS", contexto, () =>
      prismaAdmin.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename::text AS tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(${TABLAS_RF24})`,
    );
    const tablasSinPoliticaRls = politicasRls.length === 0;

    // Ronda 9 (Alex): verificacion BLOQUEANTE de que la migracion 5 dejo
    // las 2 funciones corregidas exactamente como se autorizo -- ver
    // evaluarDefinicionesMigracion5() y DEFINICIONES_ESPERADAS_MIGRACION_5
    // arriba. pg_get_function_identity_arguments(oid) SI conserva los
    // nombres de parametro declarados (nunca los omite -- solo omite
    // defaults y parametros OUT, ninguno presente en estas 2 funciones).
    // search_path se extrae de proconfig (ver comentario de
    // FilaDefinicionFuncionMigracion5 arriba).
    const definicionesMigracion5 = await consultarCatalogoRf24<FilaDefinicionFuncionMigracion5[]>(
      "DEFINICION_FUNCIONES_MIGRACION_5",
      contexto,
      () =>
        prismaAdmin.$queryRaw<FilaDefinicionFuncionMigracion5[]>`
          SELECT p.proname::text AS proname,
                 pg_get_function_identity_arguments(p.oid)::text AS identidad_argumentos,
                 p.prosecdef AS prosecdef,
                 r.rolname::text AS propietario,
                 (SELECT substring(cfg, 13) FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%') AS search_path
            FROM pg_proc p
            JOIN pg_roles r ON r.oid = p.proowner
            WHERE p.proname = ANY(${FUNCIONES_MIGRACION_5_ESPERADAS}) AND p.pronamespace = 'public'::regnamespace`,
    );
    const { coincide: funcionesMigracion5ConDefinicionEsperada, discrepancias: discrepanciasDefinicionMigracion5 } =
      evaluarDefinicionesMigracion5(definicionesMigracion5);

    // Ronda 8 (Alex, punto 1 del pedido): diagnostico de SOLO LECTURA,
    // nunca bloqueante -- ver diagnosticarDefaultAclTablasNeondbOwner()
    // arriba. Se corre AL FINAL, despues de todas las verificaciones que
    // SI bloquean, para que un fallo aqui nunca interrumpa nada que ya
    // estaba funcionando.
    const diagnosticoDefaultAcl = await diagnosticarDefaultAclTablasNeondbOwner(prismaAdmin, contexto);

    return {
      modoMigraciones: decision.modo,
      migracionesAplicadas: MIGRACIONES_RF24_ESPERADAS_EN_ORDEN,
      tablasSinPrivilegiosDeChainpulseApp,
      privilegiosTablaInesperadosParaChainpulseApp,
      tablasSinPrivilegiosParaPublic,
      privilegiosTablaInesperadosParaPublic,
      funcionesSinExecuteParaPublic,
      funcionesConExecuteInesperadoParaPublic,
      funcionesPublicasConExecuteParaChainpulseApp,
      funcionInternaSinGrant,
      todasLasFuncionesSonDeNeondbOwner,
      tablasSinPoliticaRls,
      funcionesMigracion5ConDefinicionEsperada,
      discrepanciasDefinicionMigracion5,
      defaultAclTablasNeondbOwner: diagnosticoDefaultAcl.filas,
      defaultAclTablasNeondbOwnerError: diagnosticoDefaultAcl.error,
    };
  } finally {
    await desconectarClientePrueba(prismaApp, `${contexto}:desconexion-app`);
    await desconectarClientePrueba(prismaAdmin, `${contexto}:desconexion-admin`);
  }
}
