// Script de mantenimiento -- SOLO LECTURA sobre el esquema real de la
// aplicacion (no toca ninguna fila de ninguna tabla de negocio, nunca
// hace GRANT/REVOKE/ALTER/CREATE/DROP sobre ningun objeto PERSISTENTE).
//
// Verificador de drift (Ronda 6 de planificacion del entorno de prueba
// exclusivo, 2026-10-05, punto 6 -> extendido en Ronda 9, 2026-10-05,
// punto 3 del pedido) -- compara el estado EFECTIVO del catalogo de
// Postgres contra lo que
// prisma/migrations/20261005120000_reconstruccion_rls_auth_grants/migration.sql
// mas las migraciones historicas (20260916150000, 20260920040000,
// 20260924000000, 20260924020000, 20260924040000) deberian haber dejado,
// para las 20 tablas con RLS, login_lookup() (identidad completa, no solo
// prosrc), los privilegios de chainpulse_app y de PUBLIC sobre las 33
// tablas del esquema, los privilegios de esquema (USAGE/CREATE sobre
// "public"), y los atributos/membresia de rol de chainpulse_app. No basta
// con que el objeto EXISTA -- compara contenido: RLS habilitado/forzado,
// politicas y expresiones (normalizadas via el mismo truco de
// canonicalizacion por tabla temporal que usa la migracion -- ver su
// comentario de cabecera), operaciones y roles de cada politica,
// identidad/propietario/search_path/volatilidad de login_lookup, y el
// conjunto EXACTO de privilegios de tabla/funcion/esquema (faltantes Y
// excedentes, nunca solo "¿estan los esperados?").
//
// NUNCA imprime: contraseñas, hashes, secretos de MFA, codigos de
// recuperacion, tokens, ni el objeto de error crudo (mensaje/stack) de
// ninguna excepcion -- solo etiquetas fijas ya clasificadas, via
// etiquetaSegura()/registrarFalloSeguro() (src/infra/auth/
// etiquetaErrorSegura.ts, el mismo mecanismo que ya usa
// restablecerPasswordMantenimiento.ts) -- mismo criterio de "logging de
// codigo fijo" que el resto del repositorio.
//
// Nota sobre "solo lectura": la comparacion de expresiones de politica
// (pg_get_expr) crea una tabla TEMPORAL descartable por cada chequeo
// (ver canonicalizarExpresion() mas abajo) para obtener el deparse real
// de la expresion esperada, en vez de comparar contra un string escrito
// a mano -- esta tabla es local a esta sesion, se borra explicitamente
// dentro del mismo chequeo, y nunca modifica ningun objeto real del
// esquema ni ninguna fila de ninguna tabla de negocio. Es el unico
// sentido en el que este script "escribe" algo. Las comprobaciones de
// rol/esquema de la Ronda 9 (verificarPrivilegiosEsquema,
// verificarRolChainpulseApp) son consultas puras a pg_roles/pg_namespace/
// pg_auth_members/has_schema_privilege -- no crean ni modifican nada, ni
// siquiera de forma descartable.
//
// NOTA EXPLICITA (punto 9 del pedido de Ronda 8, sigue vigente en Ronda
// 9): este script es el UNICO mecanismo de este repositorio que compara
// contra PostgreSQL real. Las pruebas de
// reconstruccionRlsAuthGrants.test.ts son ESTATICAS (parsean texto, nunca
// abren una conexion) y la suite de Ramas
// (reconstruccionRlsAuthGrantsRamas.integration.test.ts) ejercita
// Secciones A/B de la migracion contra un esquema descartable, no contra
// el esquema "public" real. Ninguna de las dos reemplaza una corrida real
// de ESTE script contra la base de "public" -- ver la seccion de
// cobertura por origen que imprime main() al final, que separa
// explicitamente "comprobado de forma estatica en esta entrega" de
// "pendiente de comprobar en PostgreSQL real" (este script, ejecutado).
//
// Uso:
//   npx tsx scripts/verificarDriftReconstruccion.ts
//
// Requiere SEED_DATABASE_URL (rol neondb_owner) -- igual que
// scripts/bootstrapPgBoss.ts y scripts/verificarObservacionesCobertura.ts,
// porque leer pg_policy/pg_proc/pg_roles/information_schema para TODAS
// las tablas y para el rol chainpulse_app (no solo para un tenant) no
// depende de RLS pero si conviene correrlo con el rol de mantenimiento,
// no con chainpulse_app, para que el resultado no dependa de que haya una
// sesion de tenant fijada ni de los privilegios limitados del propio rol
// que se esta auditando.
//
// Exit code 0 si todo coincide. Exit code 1 si se encuentra CUALQUIER
// divergencia (lista cada una, nunca se detiene en la primera -- a
// diferencia de la migracion, que aborta en la primera divergencia, este
// verificador es de diagnostico: junta todo el reporte en una sola
// corrida).
import "./_cargarEnv";
import { Client } from "pg";
import { etiquetaSegura, registrarFalloSeguro } from "../src/infra/auth/etiquetaErrorSegura";

interface ResultadoChequeo {
  categoria: string;
  objeto: string;
  ok: boolean;
  detalle: string;
}

// ---------------------------------------------------------------------
// Configuracion declarativa -- el estado ESPERADO completo (20 tablas
// con RLS: 10 que esta migracion nueva agrega + 10 ya versionadas en
// migraciones historicas; el verificador no distingue origen para decidir
// SI algo esta bien o mal -- verifica el resultado final igual para
// ambas -- pero SI etiqueta el origen de cada una para el reporte final,
// punto 6 del pedido de Ronda 9).
// ---------------------------------------------------------------------
type OrigenPolitica = "historica" | "nueva";

interface PoliticaDirecta {
  tipo: "directa";
  tabla: string;
  columna: string; // ya citada si hace falta, ej. "empresaId" o id
  origen: OrigenPolitica;
}
interface PoliticaSubconsulta {
  tipo: "subconsulta";
  tabla: string;
  fkColumna: string; // ya citada
  tablaPadre: string; // ya citada
  origen: OrigenPolitica;
}
type PoliticaEsperada = PoliticaDirecta | PoliticaSubconsulta;

const POLITICAS_ESPERADAS: PoliticaEsperada[] = [
  // Seccion A/B de la migracion nueva (10 tablas, solo las que antes
  // vivian unicamente en prisma/rls.sql):
  { tipo: "directa", tabla: "empresas", columna: "id", origen: "nueva" },
  { tipo: "directa", tabla: "usuarios", columna: '"empresaId"', origen: "nueva" },
  { tipo: "directa", tabla: "eslabones", columna: '"empresaId"', origen: "nueva" },
  { tipo: "directa", tabla: "conexiones", columna: '"empresaId"', origen: "nueva" },
  { tipo: "directa", tabla: "ciclos_pulso", columna: '"empresaId"', origen: "nueva" },
  { tipo: "subconsulta", tabla: "respuestas_crudas", fkColumna: '"conexionId"', tablaPadre: '"conexiones"', origen: "nueva" },
  { tipo: "subconsulta", tabla: "resultados_conexion", fkColumna: '"conexionId"', tablaPadre: '"conexiones"', origen: "nueva" },
  { tipo: "subconsulta", tabla: "resultados_ciclo", fkColumna: '"cicloPulsoId"', tablaPadre: '"ciclos_pulso"', origen: "nueva" },
  { tipo: "subconsulta", tabla: "metricas_cuestionario", fkColumna: '"cicloPulsoId"', tablaPadre: '"ciclos_pulso"', origen: "nueva" },
  { tipo: "subconsulta", tabla: "recomendaciones_ejecutadas", fkColumna: '"cicloPulsoId"', tablaPadre: '"ciclos_pulso"', origen: "nueva" },
  // Ya versionadas en migraciones historicas -- el verificador las
  // incluye igual porque audita el ESTADO FINAL, no quien lo creo:
  { tipo: "directa", tabla: "consentimientos_cuenta", columna: '"empresaId"', origen: "historica" },
  { tipo: "directa", tabla: "cadenas", columna: '"empresaId"', origen: "historica" },
  { tipo: "directa", tabla: "nodos", columna: '"empresaId"', origen: "historica" },
  { tipo: "directa", tabla: "conexiones_cadena", columna: '"empresaId"', origen: "historica" },
  { tipo: "directa", tabla: "hallazgos_cadena", columna: '"empresaId"', origen: "historica" },
  { tipo: "subconsulta", tabla: "flujos_conexion_cadena", fkColumna: '"conexionCadenaId"', tablaPadre: '"conexiones_cadena"', origen: "historica" },
  { tipo: "directa", tabla: "respuestas_cadena", columna: '"empresaId"', origen: "historica" },
  { tipo: "directa", tabla: "observaciones_kpi", columna: '"empresaId"', origen: "historica" },
  { tipo: "directa", tabla: "importaciones_csv", columna: '"empresaId"', origen: "historica" },
  { tipo: "directa", tabla: "observaciones_cobertura", columna: '"empresaId"', origen: "historica" },
];

// Matriz de privilegios de chainpulse_app (Ronda 6, Seccion 4.1) -- las
// 33 tablas del esquema. "RW" = SELECT/INSERT/UPDATE/DELETE completo;
// "SOLO_RECIBO" = SELECT/INSERT, sin UPDATE/DELETE (patron append-only).
const PRIVILEGIOS_ESPERADOS: Record<string, "RW" | "SOLO_RECIBO"> = {
  empresas: "RW", usuarios: "RW", eslabones: "RW", conexiones: "RW", ciclos_pulso: "RW",
  respuestas_crudas: "RW", resultados_conexion: "RW", resultados_ciclo: "RW",
  evaluaciones_expres: "RW", evaluaciones_expres_eslabones: "RW", evaluaciones_expres_conexiones: "RW",
  metricas_cuestionario: "RW", recomendaciones_ejecutadas: "RW", limite_tasa: "RW",
  usuarios_plataforma: "RW", cuestionario_versiones: "RW", pregunta_versiones: "RW",
  evaluaciones_expres_v2: "RW", respuestas: "RW", hallazgos_expres: "RW", hallazgos_expres_traza: "RW",
  consentimientos_expres: "SOLO_RECIBO", consentimientos_cuenta: "SOLO_RECIBO",
  cadenas: "RW", nodos: "RW", conexiones_cadena: "RW", flujos_conexion_cadena: "RW", hallazgos_cadena: "RW",
  respuestas_cadena: "RW", definicion_kpis: "RW", observaciones_kpi: "RW",
  importaciones_csv: "RW", observaciones_cobertura: "RW",
};

const PROSRC_ESPERADO_LOGIN_LOOKUP = `
  SELECT id, "empresaId", email, nombre, rol, "passwordHash", "mfaSecret",
         "mfaHabilitado", "intentosFallidos", "bloqueadoHasta", "eslabonId"
  FROM usuarios
  WHERE email = p_email
  LIMIT 1;
`;

// Identidad completa esperada de login_lookup(text) -- mismo contenido
// que Seccion C de la migracion (v_proargnames_esperado/v_proargmodes_
// esperado/los 12 to_regtype() de v_proallargtypes_esperado), para que
// este script detecte exactamente las mismas divergencias que la
// migracion detectaria si se corriera de nuevo contra un estado ya
// existente -- ninguno de los dos archivos adivina el otro, ambos
// codifican la MISMA identidad por separado (ver el riesgo abierto sobre
// esto en el reporte final de esta entrega).
const NOMBRES_ARGUMENTOS_ESPERADOS_LOGIN_LOOKUP = [
  "p_email", "id", "empresaId", "email", "nombre", "rol", "passwordHash",
  "mfaSecret", "mfaHabilitado", "intentosFallidos", "bloqueadoHasta", "eslabonId",
];
// RONDA 11: corregido tras ejecucion real contra PostgreSQL 18.6 -- las
// columnas de salida de un RETURNS TABLE se catalogan con modo 't'
// (tabla), no 'o' (out de un parametro OUT declarado suelto). Visto
// directamente via SELECT proargmodes FROM pg_proc, no inferido. Debe
// coincidir siempre con v_proargmodes_esperado en la Seccion C de la
// migracion -- ninguno de los dos archivos adivina el otro.
const MODOS_ARGUMENTOS_ESPERADOS_LOGIN_LOOKUP = ["i", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t"];
// RONDA 12: corregido tras ejecucion real contra PostgreSQL 18.6 (ver
// diagnostico de Alex, 2026-10-06, 106 chequeos: 105 OK + 1
// divergencia). information_schema.routine_privileges cataloga al
// propietario (neondb_owner) como grantee de EXECUTE ademas de
// chainpulse_app, aunque REVOKE ALL FROM PUBLIC ya se haya aplicado: el
// propietario conserva facultades inherentes sobre su propia funcion,
// eso no es un GRANT adicional. El conjunto efectivo correcto es
// {chainpulse_app, neondb_owner}, nunca uno solo -- PUBLIC o un tercer
// rol siguen siendo divergencia real. Debe coincidir siempre con
// v_execute_grantees_esperado en la Seccion C de la migracion.
const EXECUTE_GRANTEES_ESPERADOS_LOGIN_LOOKUP = ["chainpulse_app", "neondb_owner"];
const TIPOS_FUENTE_ARGUMENTOS_LOGIN_LOOKUP = [
  "text", "text", "text", "text", "text", '"RolUsuario"', "text", "text",
  "boolean", "integer", "timestamp", "text",
];

function normalizarEspacios(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------
// Canonicalizacion de expresiones RLS -- mismo truco que la migracion:
// pg_get_expr() deparsea desde el arbol almacenado, asi que la unica
// forma confiable de saber que texto producira para una fuente dada es
// pedirselo a Postgres contra un objeto descartable, nunca adivinarlo.
// ---------------------------------------------------------------------
async function canonicalizarExpresion(client: Client, columnaParaTabla: string, expresionFuente: string): Promise<string> {
  await client.query(`CREATE TEMP TABLE _calib_drift (${columnaParaTabla} text)`);
  try {
    await client.query(`CREATE POLICY _calib_drift_pol ON _calib_drift USING (${expresionFuente})`);
    const r = await client.query(
      `SELECT pg_get_expr(polqual, polrelid) AS expr FROM pg_policy WHERE polname = '_calib_drift_pol' AND polrelid = '_calib_drift'::regclass`,
    );
    return r.rows[0]?.expr ?? "";
  } finally {
    await client.query("DROP TABLE _calib_drift");
  }
}

async function verificarPolitica(client: Client, pol: PoliticaEsperada): Promise<ResultadoChequeo> {
  const policyName = `tenant_isolation_${pol.tabla}`;
  const columnaParaCalib = pol.tipo === "directa" ? pol.columna : pol.fkColumna;
  const expresionFuente =
    pol.tipo === "directa"
      ? `${pol.columna} = current_setting('app.tenant_id', true)`
      : `${pol.fkColumna} IN (SELECT id FROM ${pol.tablaPadre} WHERE "empresaId" = current_setting('app.tenant_id', true))`;

  try {
    const esperado = await canonicalizarExpresion(client, columnaParaCalib, expresionFuente);

    const estado = await client.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p
                 WHERE p.polname = $2 AND p.polrelid = c.oid) AS expr_actual,
              EXISTS (SELECT 1 FROM pg_policy p WHERE p.polname = $2 AND p.polrelid = c.oid) AS existe
         FROM pg_class c WHERE c.oid = $1::regclass`,
      [`"${pol.tabla}"`, policyName],
    );
    const fila = estado.rows[0];

    if (!fila || !fila.existe) {
      return { categoria: `RLS:${pol.origen}`, objeto: pol.tabla, ok: false, detalle: "politica ausente" };
    }
    if (fila.relrowsecurity !== true) {
      return { categoria: `RLS:${pol.origen}`, objeto: pol.tabla, ok: false, detalle: "relrowsecurity no esta en true" };
    }
    if (fila.relforcerowsecurity !== false) {
      return { categoria: `RLS:${pol.origen}`, objeto: pol.tabla, ok: false, detalle: "relforcerowsecurity no esta en false (se esperaba sin FORCE)" };
    }
    if (normalizarEspacios(fila.expr_actual ?? "") !== normalizarEspacios(esperado)) {
      return { categoria: `RLS:${pol.origen}`, objeto: pol.tabla, ok: false, detalle: "la expresion USING no coincide con la esperada" };
    }
    return { categoria: `RLS:${pol.origen}`, objeto: pol.tabla, ok: true, detalle: "coincide" };
  } catch (err) {
    registrarFalloSeguro(`verificarPolitica:${pol.tabla}`, err);
    return { categoria: `RLS:${pol.origen}`, objeto: pol.tabla, ok: false, detalle: `error al verificar (${etiquetaSegura(err)})` };
  }
}

// ---------------------------------------------------------------------
// login_lookup() -- identidad completa (Ronda 9, punto 2 del pedido).
// Mismo orden de verificacion que la Seccion C de la migracion: primero
// CARDINALIDAD (¿existe exactamente 1 funcion con ese nombre, en
// cualquier esquema?), luego -- solo si la cardinalidad es exactamente 1
// -- identidad estructural (esquema/nombres/modos/tipos de argumento), y
// solo si la identidad coincide, contenido (prosrc/SECURITY DEFINER/
// volatilidad/search_path/propietario/grants EXECUTE). Reportar "difiere
// en contenido" cuando la identidad ni siquiera coincide seria enganoso
// -- por eso cada etapa tiene su propio ResultadoChequeo y las etapas
// posteriores a una cardinalidad distinta de 1 NO se ejecutan (no hay
// "fila" univoca sobre la que preguntar nombres/tipos/contenido).
// ---------------------------------------------------------------------
async function verificarLoginLookup(client: Client): Promise<ResultadoChequeo[]> {
  const resultados: ResultadoChequeo[] = [];
  try {
    const conteoR = await client.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'login_lookup'`);
    const n: number = conteoR.rows[0].n;

    if (n === 0) {
      resultados.push({ categoria: "AUTH", objeto: "login_lookup.cardinalidad", ok: false, detalle: "la funcion no existe en ningun esquema (se esperaba exactamente 1)" });
      return resultados;
    }
    if (n > 1) {
      resultados.push({
        categoria: "AUTH",
        objeto: "login_lookup.cardinalidad",
        ok: false,
        detalle: `se encontraron ${n} funciones llamadas login_lookup en el catalogo (en cualquier esquema) -- sobrecarga inesperada; no se puede verificar identidad de forma inequivoca, no se continua con los demas chequeos de login_lookup`,
      });
      return resultados;
    }
    resultados.push({ categoria: "AUTH", objeto: "login_lookup.cardinalidad", ok: true, detalle: "exactamente 1 funcion llamada login_lookup en el catalogo" });

    // n === 1: identidad univoca -- se puede continuar de forma segura.
    // RONDA 11: proargmodes es "char"[] y proallargtypes es oid[] -- el
    // driver "pg" no trae un parser de array registrado para ninguno de
    // los dos (a diferencia de text[]/int4[]), asi que sin normalizar
    // cada uno llega en un formato distinto a cada lado de la
    // comparacion JSON.stringify, que entonces falla SIEMPRE, sin
    // relacion con si los valores semanticos coinciden o no (esto fue lo
    // que una ejecucion real contra PostgreSQL 18.6 encontro: las 20
    // politicas y el resto de chequeos de login_lookup pasaron, pero
    // modos/tipos reportaban divergencia falsa). La correccion: pedirle
    // a Postgres mismo que desglose ambos arrays a text[] via
    // unnest(...)::text -- text[] si tiene parser nativo en "pg" y por
    // lo tanto llega como un array de JS normal en ambos lados.
    const identidadR = await client.query(
      `SELECT p.oid, p.pronamespace::regnamespace::text AS esquema,
              p.proargnames,
              (SELECT array_agg(m::text ORDER BY ord)
                 FROM unnest(p.proargmodes) WITH ORDINALITY AS u(m, ord)) AS proargmodes_texto,
              (SELECT array_agg(t::text ORDER BY ord)
                 FROM unnest(p.proallargtypes) WITH ORDINALITY AS u(t, ord)) AS proallargtypes_texto
         FROM pg_proc p WHERE p.proname = 'login_lookup'`,
    );
    const fila = identidadR.rows[0];

    const tiposEsperadosR = await client.query(
      `SELECT array_agg(to_regtype(t)::oid::text ORDER BY ord) AS oids
         FROM unnest($1::text[]) WITH ORDINALITY AS u(t, ord)`,
      [TIPOS_FUENTE_ARGUMENTOS_LOGIN_LOOKUP],
    );
    const tiposEsperadosOids: string[] = tiposEsperadosR.rows[0].oids;

    const esquemaOk = fila.esquema === "public";
    const nombresOk = JSON.stringify(fila.proargnames) === JSON.stringify(NOMBRES_ARGUMENTOS_ESPERADOS_LOGIN_LOOKUP);
    const modosOk = JSON.stringify(fila.proargmodes_texto) === JSON.stringify(MODOS_ARGUMENTOS_ESPERADOS_LOGIN_LOOKUP);
    const tiposOk = JSON.stringify(fila.proallargtypes_texto) === JSON.stringify(tiposEsperadosOids);

    resultados.push({ categoria: "AUTH", objeto: "login_lookup.esquema", ok: esquemaOk, detalle: `esperado public, encontrado ${fila.esquema ?? "(null)"}` });
    resultados.push({ categoria: "AUTH", objeto: "login_lookup.nombres_argumentos", ok: nombresOk, detalle: "proargnames (incluye columnas de RETURNS TABLE) debe coincidir exactamente y en el mismo orden" });
    resultados.push({ categoria: "AUTH", objeto: "login_lookup.modos_argumentos", ok: modosOk, detalle: "proargmodes debe ser exactamente 1 IN + 11 TABLE, en ese orden (RONDA 12: texto corregido -- PostgreSQL cataloga las columnas de RETURNS TABLE con modo 't'/TABLE, nunca 'o'/OUT; ver RONDA 11 para la correccion del valor, esta es solo la correccion del texto del reporte)" });
    resultados.push({ categoria: "AUTH", objeto: "login_lookup.tipos_argumentos", ok: tiposOk, detalle: "proallargtypes comparado por OID resuelto via to_regtype(), nunca por texto formateado (format_type podria renderizar \"RolUsuario\" de forma distinta a como se escribio)" });

    if (!esquemaOk || !nombresOk || !modosOk || !tiposOk) {
      resultados.push({
        categoria: "AUTH",
        objeto: "login_lookup.contenido",
        ok: false,
        detalle: "no se evalua -- la identidad ya difiere (ver los 4 chequeos anteriores); comparar contenido contra una funcion que no es la esperada no tendria sentido",
      });
      return resultados;
    }

    // Identidad confirmada univocamente -- recien ahora tiene sentido
    // comparar contenido/seguridad/propietario/grants.
    const contenidoR = await client.query(
      `SELECT prosrc, prosecdef, provolatile, proconfig,
              (SELECT rolname FROM pg_roles WHERE oid = proowner) AS owner
         FROM pg_proc WHERE oid = $1`,
      [fila.oid],
    );
    const c = contenidoR.rows[0];

    resultados.push({
      categoria: "AUTH",
      objeto: "login_lookup.prosrc",
      ok: normalizarEspacios(c.prosrc) === normalizarEspacios(PROSRC_ESPERADO_LOGIN_LOOKUP),
      detalle: "cuerpo SQL verbatim (prosrc no se deparsea, comparacion confiable sin canonicalizar)",
    });
    resultados.push({ categoria: "AUTH", objeto: "login_lookup.security_definer", ok: c.prosecdef === true, detalle: "SECURITY DEFINER" });
    resultados.push({
      categoria: "AUTH",
      objeto: "login_lookup.volatilidad",
      ok: c.provolatile === "s",
      detalle: `se espera STABLE ('s') -- la funcion solo consulta datos dentro de una sentencia y no modifica la base; encontrado '${c.provolatile}'`,
    });
    resultados.push({
      categoria: "AUTH",
      objeto: "login_lookup.search_path",
      ok: Array.isArray(c.proconfig) && c.proconfig.includes("search_path=public"),
      detalle: "search_path fijo a public (SECURITY DEFINER sin esto es vulnerable a search_path hijacking)",
    });
    resultados.push({
      categoria: "AUTH",
      objeto: "login_lookup.owner",
      ok: c.owner === "neondb_owner",
      detalle: "propietario esperado neondb_owner",
    });
    resultados.push({
      categoria: "AUTH",
      objeto: "login_lookup.no_propietario_chainpulse_app",
      ok: c.owner !== "chainpulse_app",
      detalle: "chainpulse_app no debe ser propietario -- solo el propietario o un superusuario puede reemplazar la funcion (CREATE OR REPLACE/DROP+CREATE), y el chequeo ROL.chainpulse_app.rolsuper de este mismo script confirma que chainpulse_app no es superusuario",
    });

    const execR = await client.query(
      `SELECT grantee FROM information_schema.routine_privileges
         WHERE routine_name = 'login_lookup' AND privilege_type = 'EXECUTE' ORDER BY grantee`,
    );
    const grantees = execR.rows.map((f) => f.grantee).sort();
    const grantsOk = JSON.stringify(grantees) === JSON.stringify(EXECUTE_GRANTEES_ESPERADOS_LOGIN_LOOKUP);
    resultados.push({
      categoria: "AUTH",
      objeto: "login_lookup.execute_grants",
      ok: grantsOk,
      detalle: `EXECUTE otorgado a exactamente ${JSON.stringify(EXECUTE_GRANTEES_ESPERADOS_LOGIN_LOOKUP)} -- propietario incluido (facultad inherente, no un GRANT adicional), nunca PUBLIC ni un tercer rol (encontrado: ${grantees.length} rol(es): [${grantees.join(",")}])`,
    });
  } catch (err) {
    registrarFalloSeguro("verificarLoginLookup", err);
    resultados.push({ categoria: "AUTH", objeto: "login_lookup", ok: false, detalle: `error al verificar (${etiquetaSegura(err)})` });
  }
  return resultados;
}

async function verificarPrivilegios(client: Client): Promise<ResultadoChequeo[]> {
  const resultados: ResultadoChequeo[] = [];
  try {
    // RONDA 11: privilege_type en information_schema.role_table_grants es
    // del dominio information_schema.character_data -- array_agg(...
    // ORDER BY privilege_type) sobre ese dominio fallo en una ejecucion
    // real contra PostgreSQL 18.6 (la consulta agregada completa
    // lanzaba una excepcion, nunca llegaba a producir resultados; una
    // consulta equivalente sin agregar, casteando a texto, si funciono
    // y devolvio correctamente los grants de chainpulse_app). La
    // correccion: castear a ::text antes de agregar y antes de
    // ordenar, igual que en la consulta de PUBLIC mas abajo.
    const r = await client.query(
      `SELECT table_name, array_agg(privilege_type::text ORDER BY privilege_type::text) AS privilegios
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND grantee = 'chainpulse_app'
         GROUP BY table_name`,
    );
    const actual = new Map<string, string[]>(r.rows.map((f) => [f.table_name, f.privilegios]));

    // PUBLIC -- consulta separada, mismo esquema de comparacion (Ronda 9,
    // "ausencia de privilegios inesperados concedidos a PUBLIC", no
    // limitado a las 14 tablas que gestiona la migracion nueva: las 33
    // tablas del esquema).
    const rPublic = await client.query(
      `SELECT table_name, array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) AS privilegios
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND grantee = 'PUBLIC'
         GROUP BY table_name`,
    );
    const actualPublic = new Map<string, string[]>(rPublic.rows.map((f) => [f.table_name, f.privilegios]));

    for (const [tabla, nivel] of Object.entries(PRIVILEGIOS_ESPERADOS)) {
      const esperado = nivel === "RW" ? ["DELETE", "INSERT", "SELECT", "UPDATE"] : ["INSERT", "SELECT"];
      const encontrado = actual.get(tabla) ?? [];
      // Comparacion por igualdad EXACTA de conjunto (no solo "¿estan los
      // esperados?") -- JSON.stringify sobre arrays ya ordenados detecta
      // tanto un privilegio FALTANTE (el esperado no aparece) como uno
      // EXCEDENTE (aparece uno que no deberia, p. ej. TRUNCATE o
      // REFERENCES) con la misma comparacion, sin una rama separada para
      // cada caso (punto 7 del pedido de Ronda 8, reconfirmado en el
      // punto 3 de Ronda 9).
      const coincide = JSON.stringify(encontrado) === JSON.stringify(esperado);
      resultados.push({
        categoria: "GRANT:chainpulse_app",
        objeto: tabla,
        ok: coincide,
        detalle: coincide ? "coincide (ni falta ni sobra ningun privilegio)" : `esperado [${esperado.join(",")}], encontrado [${encontrado.join(",")}] -- incluye faltantes Y excedentes`,
      });

      const encontradoPublic = actualPublic.get(tabla) ?? [];
      resultados.push({
        categoria: "GRANT:PUBLIC",
        objeto: tabla,
        ok: encontradoPublic.length === 0,
        detalle: encontradoPublic.length === 0 ? "sin privilegios para PUBLIC (correcto)" : `PUBLIC tiene privilegios inesperados: [${encontradoPublic.join(",")}] -- no se revoca automaticamente desde este script, solo se reporta`,
      });
    }
  } catch (err) {
    registrarFalloSeguro("verificarPrivilegios", err);
    resultados.push({ categoria: "GRANT", objeto: "(consulta agregada)", ok: false, detalle: `error al verificar (${etiquetaSegura(err)})` });
  }
  return resultados;
}

// ---------------------------------------------------------------------
// Privilegios de ESQUEMA (Ronda 9, punto 3 del pedido) -- mismo patron
// que la Seccion E de la migracion: USAGE de chainpulse_app sobre
// "public" (debe existir), CREATE de chainpulse_app sobre "public" (NO
// debe existir), CREATE de PUBLIC sobre "public" (NO debe existir, via
// aclexplode()/grantee=0 porque information_schema no tiene una vista de
// privilegios de esquema equivalente a role_table_grants).
// ---------------------------------------------------------------------
async function verificarPrivilegiosEsquema(client: Client): Promise<ResultadoChequeo[]> {
  const resultados: ResultadoChequeo[] = [];
  try {
    const r = await client.query(
      `SELECT has_schema_privilege('chainpulse_app', 'public', 'USAGE') AS usage_chainpulse,
              has_schema_privilege('chainpulse_app', 'public', 'CREATE') AS create_chainpulse,
              EXISTS (
                SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
                WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
              ) AS create_public`,
    );
    const fila = r.rows[0];
    resultados.push({ categoria: "GRANT_ESQUEMA", objeto: "public.USAGE.chainpulse_app", ok: fila.usage_chainpulse === true, detalle: "chainpulse_app debe tener USAGE sobre el esquema public (indispensable para operar sobre cualquier tabla)" });
    resultados.push({ categoria: "GRANT_ESQUEMA", objeto: "public.CREATE.chainpulse_app", ok: fila.create_chainpulse === false, detalle: "chainpulse_app NO debe tener CREATE sobre el esquema public (podria crear objetos propios sin pasar por ninguna migracion)" });
    resultados.push({ categoria: "GRANT_ESQUEMA", objeto: "public.CREATE.PUBLIC", ok: fila.create_public === false, detalle: "PUBLIC NO debe tener CREATE sobre el esquema public (aclexplode con grantee=0 representa al pseudo-rol PUBLIC)" });
  } catch (err) {
    registrarFalloSeguro("verificarPrivilegiosEsquema", err);
    resultados.push({ categoria: "GRANT_ESQUEMA", objeto: "(consulta agregada)", ok: false, detalle: `error al verificar (${etiquetaSegura(err)})` });
  }
  return resultados;
}

// ---------------------------------------------------------------------
// Atributos y membresia de rol de chainpulse_app (Ronda 9, punto 3 del
// pedido) -- precondiciones de nivel Neon/branch que la migracion SOLO
// verifica-y-aborta (Seccion 0), nunca corrige; este script las reporta
// con el mismo criterio de diagnostico (nunca se detiene en la primera).
// Si alguno de estos chequeos falla, la correccion NO es una migracion
// SQL -- es una accion manual sobre el rol/branch de Neon (ver el
// documento de planificacion, Seccion 5).
// ---------------------------------------------------------------------
async function verificarRolChainpulseApp(client: Client): Promise<ResultadoChequeo[]> {
  const resultados: ResultadoChequeo[] = [];
  try {
    const r = await client.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'chainpulse_app'`,
    );
    if (r.rows.length === 0) {
      resultados.push({ categoria: "ROL", objeto: "chainpulse_app.existe", ok: false, detalle: "el rol no existe -- precondicion de Neon/branch, este script no puede corregirlo" });
      return resultados;
    }
    const fila = r.rows[0];
    resultados.push({ categoria: "ROL", objeto: "chainpulse_app.rolsuper", ok: fila.rolsuper === false, detalle: "no debe tener SUPERUSER" });
    resultados.push({ categoria: "ROL", objeto: "chainpulse_app.rolbypassrls", ok: fila.rolbypassrls === false, detalle: "no debe tener BYPASSRLS (de lo contrario ninguna politica RLS de este archivo protegeria nada para este rol)" });
    resultados.push({ categoria: "ROL", objeto: "chainpulse_app.rolcreaterole", ok: fila.rolcreaterole === false, detalle: "no debe tener CREATEROLE" });
    resultados.push({ categoria: "ROL", objeto: "chainpulse_app.rolcreatedb", ok: fila.rolcreatedb === false, detalle: "no debe tener CREATEDB" });

    const membresiaR = await client.query(
      `SELECT array_agg(r.rolname ORDER BY r.rolname) AS roles
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid
         JOIN pg_roles m2 ON m2.oid = m.member
        WHERE m2.rolname = 'chainpulse_app'`,
    );
    const roles: string[] = membresiaR.rows[0]?.roles ?? [];
    resultados.push({
      categoria: "ROL",
      objeto: "chainpulse_app.membresia",
      ok: roles.length === 0,
      detalle: roles.length === 0 ? "sin membresia en ningun otro rol (correcto)" : `miembro inesperado de: [${roles.join(",")}] -- precondicion de Neon/branch, este script no puede corregirlo`,
    });
  } catch (err) {
    registrarFalloSeguro("verificarRolChainpulseApp", err);
    resultados.push({ categoria: "ROL", objeto: "(consulta agregada)", ok: false, detalle: `error al verificar (${etiquetaSegura(err)})` });
  }
  return resultados;
}

async function main() {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado (ver .env.example) -- este verificador necesita el rol neondb_owner para leer pg_policy/pg_proc/pg_roles/information_schema sin depender de una sesion de tenant ni de los privilegios limitados del rol que se esta auditando.",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  const resultados: ResultadoChequeo[] = [];
  try {
    for (const pol of POLITICAS_ESPERADAS) {
      resultados.push(await verificarPolitica(client, pol));
    }
    resultados.push(...(await verificarLoginLookup(client)));
    resultados.push(...(await verificarPrivilegios(client)));
    resultados.push(...(await verificarPrivilegiosEsquema(client)));
    resultados.push(...(await verificarRolChainpulseApp(client)));
  } finally {
    await client.end();
  }

  const fallidos = resultados.filter((r) => !r.ok);
  console.log(`Chequeos totales: ${resultados.length}. OK: ${resultados.length - fallidos.length}. Divergentes: ${fallidos.length}.`);
  for (const r of resultados) {
    console.log(`  [${r.ok ? "OK" : "DIVERGE"}] ${r.categoria} ${r.objeto} -- ${r.detalle}`);
  }

  // Cobertura por origen (punto 6 del pedido de Ronda 9) -- separacion
  // explicita entre 4 cosas que "741 pruebas pasaron" (punto 9, Ronda 8)
  // nunca deberia confundir entre si:
  console.log("\n--- Cobertura por origen (punto 6, Ronda 9) ---");
  const historicas = POLITICAS_ESPERADAS.filter((p) => p.origen === "historica").map((p) => p.tabla);
  const nuevas = POLITICAS_ESPERADAS.filter((p) => p.origen === "nueva").map((p) => p.tabla);
  console.log(`1) Definicion HISTORICAMENTE VERSIONADA (migraciones previas a esta ronda, 20260916150000/20260920040000/20260924000000/20260924020000/20260924040000): ${historicas.length} politicas RLS -> ${historicas.join(", ")}.`);
  console.log(`2) Definicion INCORPORADA AHORA (migracion 20261005120000_reconstruccion_rls_auth_grants): ${nuevas.length} politicas RLS + login_lookup() + 14 GRANT de tabla + privilegios de esquema -> ${nuevas.join(", ")}.`);
  console.log(`3) Definicion comprobada UNICAMENTE DE FORMA ESTATICA en esta entrega (parser libpg-query sobre migration.sql + aserciones de texto en reconstruccionRlsAuthGrants.test.ts, SIN ninguna conexion a Postgres): las 20 politicas RLS, la identidad de login_lookup, los 14 GRANT de tabla y los privilegios de esquema -- todos los que este mismo script TAMBIEN sabe comprobar, pero que NO se comprobaron de esa forma en esta entrega.`);
  console.log(`4) Definicion PENDIENTE DE COMPROBAR EN POSTGRESQL REAL: exactamente los ${resultados.length} chequeos de la corrida de ESTE script que se acaba de imprimir arriba -- este script es el mecanismo que lo comprobaria, pero esta ronda (Ronda 9) tiene prohibido conectarse a cualquier base (instruccion explicita), asi que esta ejecucion del reporte en si misma NO ha ocurrido todavia contra ninguna base real en el marco de esta entrega -- si este texto se esta leyendo como salida real de un "npx tsx" ejecutado, esta seccion 4 ya quedo satisfecha para esta corrida especifica; si se esta leyendo como parte del cuerpo de este archivo sin haberlo ejecutado, sigue pendiente.`);

  if (fallidos.length > 0) {
    console.error(`DRIFT_DETECTADO: ${fallidos.length} chequeo(s) no coinciden con el estado esperado.`);
    process.exit(1);
  }
  console.log("\nSin drift detectado.");
}

main().catch((err: unknown) => {
  registrarFalloSeguro("verificarDriftReconstruccion:main", err);
  process.exit(1);
});
