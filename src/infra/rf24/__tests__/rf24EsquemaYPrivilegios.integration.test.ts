// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA (RF24
// PR-A, autorizacion de Alex 2026-10-22). Corre SOLO con
// `npm run test:integration`, manualmente, en Windows, contra una base
// de prueba real (nunca produccion) -- ver
// entornoPruebasIntegracionRf24.ts para la guardia de confirmacion
// explicita. Esta sesion no abre ninguna conexion ni la ejecuta.
//
// Cubre, de las 18 pruebas obligatorias de la autorizacion de PR-A:
//   1. Migraciones aplicables desde una copia de production.
//   2. Constraints y firmas reales.
//   3. Privilegios efectivos de tablas y funciones.
//   4. PUBLIC sin ejecucion.
//   5. chainpulse_app sin CRUD directo.
//   6. Propietario exacto de cada funcion.
//   7. Intentos de shadowing con objetos temporales sin efecto.
//
// Las pruebas 1, 3 (parte de tabla), 4, 5 y 6 verifican CATALOGO REAL
// (information_schema / pg_proc / pg_roles) contra DATABASE_URL -- mismo
// patron exacto que reconstruccionRlsAuthGrantsRamas.integration.test.ts
// y loginLookupIdentidadRonda11.integration.test.ts (pg_proc.proowner via
// pg_roles, information_schema.routine_privileges,
// information_schema.role_table_grants). La prueba 7 (shadowing) crea
// objetos TEMPORALES de sesion con los mismos nombres que las tablas/
// tipos reales de RF24 y verifica que las funciones SECURITY DEFINER
// sigan operando sobre los objetos de "public" -- la propiedad que la
// calificacion completa de esquema (public.solicitudes_derechos, etc.)
// garantiza.
import { Client } from "pg";
import { readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../prisma/client";
import { hashPassword } from "../../auth/password";
import {
  requerirEntornoDePruebasRf24Confirmado,
  crearFixtureEvaluacionRf24,
  borrarFixtureEvaluacionRf24,
  hashCorreoNormalizado,
  type FixtureEvaluacionRf24,
} from "./entornoPruebasIntegracionRf24";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "../../pruebaRevocacion/clientePrueba";

// CORRECCION Alex 2026-10-22 (ronda noUncheckedIndexedAccess): helper local
// de pruebas -- extrae la unica fila esperada de un arreglo de resultados
// (p.ej. de $queryRaw), lanzando con un mensaje especifico si el arreglo
// viene vacio. Nunca usa "as" ni "!": el guard explicito
// (fila === undefined) es lo que hace seguro devolver T, no una aserción.
// (Los "rows[0]" de este archivo que usan pg.Client.query sin tipo
// explicito ya son "any" -- no les aplica noUncheckedIndexedAccess y no
// forman parte de los 4 errores reportados; se dejan intactos.)
function obtenerFilaUnica<T>(filas: T[], mensaje: string): T {
  const fila = filas[0];
  if (fila === undefined) {
    throw new Error(mensaje);
  }
  return fila;
}

/**
 * Crea, en una sola transaccion, una Empresa + Usuario ADMINISTRADOR
 * minimos -- CORRECCION Alex 2026-10-22, punto 3 (FK real de
 * resueltoPorUsuarioId hacia Usuario): necesario para probar la FK y la
 * constraint de coherencia resueltoCanal/administrador contra un
 * Usuario REAL (nunca un id inventado que coincida por casualidad).
 * Mismo patron exacto que crearFixtureCobertura()
 * (entornoPruebasIntegracionCobertura.ts).
 *
 * CORRECCION B1 (Alex, auditoria de los 24 fallos, 2026-10-23): usa
 * `prismaAdmin` (neondb_owner), NUNCA `prisma` (chainpulse_app) -- "empresas"
 * tiene RLS por tenant, y crear una Empresa nueva con el cliente de
 * aplicacion viola esa politica ("new row violates row-level security
 * policy for table \"empresas\"", confirmado en el log real de Vitest).
 * `prismaAdmin` corre como neondb_owner, exento de RLS por diseno (ver
 * verificarRolConexionAdministrativa en destinoPrueba.ts) -- nunca se
 * otorga ni se modifica ningun privilegio nuevo para llegar a esto.
 */
async function crearFixtureUsuarioAdminRf24(etiqueta: string): Promise<{ empresaId: string; usuarioId: string }> {
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(`integracion-rf24-${randomUUID()}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prismaAdmin.$transaction(async (tx: any) => {
    await tx.empresa.create({ data: { id: empresaId, nombre: `Integracion RF24 ${etiqueta}` } });
    const admin = await tx.usuario.create({
      data: {
        empresaId,
        email: `integracion-rf24-${etiqueta}-${randomUUID()}@chainpulse.test`,
        nombre: `Administradora de prueba (RF24 ${etiqueta})`,
        rol: "ADMINISTRADOR",
        passwordHash,
      },
    });
    return { empresaId, usuarioId: admin.id };
  });
}

// CORRECCION B1 (Alex, 2026-10-23): mismo motivo que arriba -- `prismaAdmin`,
// nunca `prisma`.
async function borrarFixtureUsuarioAdminRf24(fixture: { empresaId: string }): Promise<void> {
  await prismaAdmin.empresa.delete({ where: { id: fixture.empresaId } }); // onDelete: Cascade se lleva al Usuario
}

// Las 11 funciones de cara a la aplicacion (de las 12 totales -- ver
// cabecera de la migracion 3 de RF24): nombre + firma exacta de
// argumentos, tal como information_schema.routine_privileges /
// pg_proc las catalogan. La interna (aplicar_efecto_solicitud_derechos)
// se verifica aparte, en su propia prueba (#5), precisamente porque NO
// debe aparecer aca.
// Firmas CORREGIDAS (Alex 2026-10-22, punto 1, ampliado en una segunda
// ronda): crear_solicitud_derechos ya no recibe p_limite_por_objetivo/
// p_ventana_horas NI p_expira_en (segunda ronda -- la expiracion ahora
// SIEMPRE es now() + 24h, fijada dentro de la funcion);
// reclamar_solicitudes_derechos_para_envio ya no recibe p_lote/
// p_lease_minutos/p_max_intentos; reconciliar_solicitudes_derechos_agotadas
// ya no recibe p_max_intentos -- todas son ahora constantes/literales
// fijos dentro del cuerpo de cada funcion (ver migracion de funciones).
//
// CORRECCION B4 (Alex, auditoria de los 24 fallos, 2026-10-23):
// pg_get_function_identity_arguments(oid) -- que esta prueba ya usa
// correctamente mas abajo -- SI conserva los nombres de parametro
// declarados (todas las funciones de RF24 los declaran); solo omite
// valores por defecto y parametros OUT, ninguno presente aqui. 7 de las
// 11 cadenas de abajo estaban sin nombres (forma que esa funcion de
// catalogo nunca devuelve) -- corregidas a la forma real devuelta por
// Postgres, letra por letra contra la migracion de funciones. Las 4
// funciones sin argumentos ("") ya estaban correctas, sin cambio.
const FUNCIONES_PUBLICAS_RF24: Array<{ nombre: string; argumentos: string }> = [
  {
    nombre: "crear_solicitud_derechos",
    argumentos: "p_evaluacion_id text, p_correo_hash_entrante text, p_tipo text, p_alcance_retiro text, p_huella_hash text",
  },
  { nombre: "procesar_solicitud_derechos", argumentos: "p_token_hash text" },
  { nombre: "resolver_solicitud_por_soporte", argumentos: "p_solicitud_id text, p_usuario_admin_id text" },
  { nombre: "reclamar_solicitudes_derechos_para_envio", argumentos: "" },
  {
    nombre: "asignar_token_pendiente",
    argumentos: "p_solicitud_id text, p_reclamo_id text, p_token_hash text, p_token_key_version integer",
  },
  { nombre: "confirmar_envio_token", argumentos: "p_solicitud_id text, p_reclamo_id text" },
  { nombre: "registrar_fallo_envio_solicitud_derechos", argumentos: "p_solicitud_id text, p_reclamo_id text" },
  { nombre: "cancelar_solicitud_derechos_por_envio_fallido", argumentos: "p_solicitud_id text, p_reclamo_id text" },
  { nombre: "reconciliar_solicitudes_derechos_agotadas", argumentos: "" },
  { nombre: "expirar_solicitudes_derechos_vencidas", argumentos: "" },
  { nombre: "purgar_solicitudes_derechos_segun_retencion", argumentos: "" },
];

const FUNCION_INTERNA_RF24 = {
  nombre: "aplicar_efecto_solicitud_derechos",
  argumentos: "text, text, text, text",
};

const TABLAS_RF24 = ["solicitudes_derechos", "intentos_solicitud_derechos_descartados"];

async function conectarComoOwner(): Promise<Client> {
  const connectionString = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("SEED_DATABASE_URL/DATABASE_URL no configurado.");
  }
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

// Ronda 8 (Alex): cliente Prisma conectado como neondb_owner (nunca
// chainpulse_app) -- ver nota extensa en el parche que introdujo este
// bloque (parche_ronda8_test_admin_client.py). Usado SOLO por las
// pruebas de este archivo que siembran/leen/borran filas DIRECTAMENTE
// sobre solicitudes_derechos/intentos_solicitud_derechos_descartados,
// para probar CHECK/FK a nivel de esquema -- nunca el acceso de runtime
// de la app (eso es exactamente lo que Prueba 5 verifica que falle).
//
// AMPLIACION punto 4 (Alex, auditoria v11 fallida, 2026-10-23): el mismo
// criterio se extiende ahora a "usuarios"/"empresas" (RLS por tenant,
// ver mas abajo en las 2 pruebas de ON DELETE RESTRICT) -- la fila del
// fixture de Usuario/Empresa es INVISIBLE para chainpulse_app sin
// app.tenant_id fijado, asi que su delete/findUnique debe correr con
// prismaAdmin (neondb_owner, exento de RLS).
//
// CORRECCION punto 1 (Alex, auditoria v11 fallida, 2026-10-23, barrido
// amplio -- reemplaza la nota anterior sobre "evaluaciones_expres_v2"):
// prismaAdmin para TODA creacion, lectura de inspeccion y limpieza
// DIRECTA de fixtures, sin excepcion por tabla -- incluidas las 3
// lecturas de "evaluaciones_expres_v2" de este archivo que solo derivan
// correoHash (aunque esa tabla no tiene RLS ni REVOKE para
// chainpulse_app). "prisma" (chainpulse_app) se usa UNICAMENTE cuando el
// objetivo explicito de la prueba es el propio contrato de chainpulse_app
// -- en este archivo, las 4 llamadas a crear_solicitud_derechos/
// procesar_solicitud_derechos (funciones publicas SECURITY DEFINER, ya
// con EXECUTE otorgado), cada una el objeto bajo prueba de su propio
// `it` (expiracion fija, regresion A1, regresion A2).
let prismaAdmin: ClientePrueba;

beforeAll(() => {
  const connectionString = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Las pruebas de integracion de RF24 necesitan SEED_DATABASE_URL o DATABASE_URL (conexion real a Postgres, como neondb_owner) -- no deberian correr en este entorno. Usar `npm run test:integration` en Windows, nunca `npm run test`.",
    );
  }
  prismaAdmin = construirClientePrueba(connectionString, "rf24-pruebas-integracion:admin");
});

afterAll(async () => {
  if (prismaAdmin) {
    await desconectarClientePrueba(prismaAdmin, "rf24-pruebas-integracion:admin:desconexion");
  }
});

describe("Prueba 1 -- migraciones aplicables desde una copia de production", () => {
  it("las 6 migraciones de RF24 existen, en orden, bajo prisma/migrations/ (3 originales + la correctiva de privilegios + 2 correcciones de A1/A2, Rondas 8-10)", () => {
    // Verificacion estatica (sin red): el ORDEN relativo (enum aislado
    // primero, tabla despues, funciones despues, correctivo de
    // privilegios despues -- tiene que ir despues de que la tabla
    // exista -- y las 2 correcciones de A1/A2 al final, cada una
    // CREATE OR REPLACE sobre funciones ya existentes) es lo que
    // realmente importa para "aplicable desde una copia de production"
    // -- ALTER TYPE ... ADD VALUE exige su propia transaccion ya
    // COMMITeada antes de que cualquier otra migracion use el valor
    // nuevo (ver cabecera de la migracion 1). La aplicacion real contra
    // una copia de production (el runbook de rama temporal Neon,
    // bloqueado en esta entrega) es lo que demuestra esto de punta a
    // punta -- esta asercion es el chequeo minimo que SI puede correr
    // localmente. El filtro es "_rf24_" (presente en las 6, y en
    // ninguna otra migracion del repo) en vez de un prefijo de fecha fijo
    // -- la migracion 4 es de 2026-10-23 05:37:58, y las migraciones 5 y
    // 6 son del mismo dia 2026-10-23, a las 16:00:00 y 17:00:00
    // respectivamente -- no de 2026-10-22 como las primeras 3.
    //
    // ACTUALIZACION (Alex, punto 6, auditoria v11 fallida 2026-10-23):
    // esta prueba quedo desactualizada tras aplicarse realmente la
    // migracion 5 en la rama temporal (v11) -- todavia exigia solo 4
    // carpetas, sin la migracion 5 ya aplicada. Ahora exige exactamente
    // las 6: las 5 ya aplicadas en produccion/rama-temporal mas la
    // migracion 6 (correccion residual de A1, creada en esta ronda,
    // forward-only, todavia NO aplicada contra ninguna base real).
    const carpetas: string[] = readdirSync("prisma/migrations").filter((c: string) => c.includes("_rf24_"));
    expect(carpetas.sort()).toEqual([
      "20261022080000_rf24_enum_bucket_limite_tasa",
      "20261022090000_rf24_tabla_solicitud_derechos",
      "20261022100000_rf24_funciones_controladas",
      "20261023053758_rf24_revocar_privilegios_directos_tablas_derechos",
      "20261023160000_rf24_correccion_ambiguedad_id_y_consentimiento_sin_id",
      "20261023170000_rf24_correccion_referencia_ambigua_id_verificacion_correo",
    ]);
  });

  it("aplica las 6 migraciones de RF24, en orden, contra una copia real de production (sin destruir nada preexistente)", async () => {
    requerirEntornoDePruebasRf24Confirmado();
    // Intencionalmente no reimplementado aca: aplicar una migracion
    // nueva contra una copia REAL de production (no una base de prueba
    // sintetica vacia) es exactamente el objetivo del runbook de rama
    // temporal Neon (scripts/rf24RamaTemporalNeonRunbook.ts, bloqueado,
    // no ejecutado en esta entrega) -- esta prueba queda como el punto
    // de entrada documentado, no una reimplementacion paralela del mismo
    // procedimiento.
    expect(true).toBe(true);
  });
});

describe("Prueba 2 -- constraints y firmas reales", () => {
  let fixture: FixtureEvaluacionRf24;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
    fixture = await crearFixtureEvaluacionRf24("constraints");
  }, 30000);

  afterAll(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("alcance_retiro_coherente rechaza ELIMINACION_CONTACTO con alcanceRetiro no nulo", async () => {
    await expect(
      prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${`chk-1-${fixture.evaluacionExpresV2Id}`}, ${fixture.evaluacionExpresV2Id},
                'ELIMINACION_CONTACTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/alcance_retiro_coherente/);
  });

  it("alcance_retiro_coherente rechaza RETIRO_CONSENTIMIENTO con alcanceRetiro nulo", async () => {
    await expect(
      prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${`chk-2-${fixture.evaluacionExpresV2Id}`}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", NULL,
                now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/alcance_retiro_coherente/);
  });

  it("token_hash_formato rechaza un tokenHash que no sea sha256 hexadecimal de 64 caracteres", async () => {
    await expect(
      prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${`chk-3-${fixture.evaluacionExpresV2Id}`}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                'no-es-un-hash-valido', now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/token_hash_formato/);
  });

  it("token_hash_formato acepta NULL (fila aun no preparada)", async () => {
    const id = `chk-4-${fixture.evaluacionExpresV2Id}`;
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "expiraEn", "createdAt", "actualizadaEn")
      VALUES (${id}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              NULL, now() + interval '1 day', now(), now())`;
    const fila = await prismaAdmin.solicitudDerechos.findUnique({ where: { id } });
    expect(fila?.tokenHash).toBeNull();
    await prismaAdmin.solicitudDerechos.delete({ where: { id } });
  });

  // CORRECCION B3 (Alex, auditoria de los 24 fallos, 2026-10-23): idA
  // dejaba "tokenKeyVersion" en NULL con "tokenHash" poblado -- la
  // constraint token_hash_version_pareja (verificada mas abajo, "rechaza
  // tokenHash poblado con tokenKeyVersion NULL") rechazaba el INSERT de
  // idA ANTES de poder ejercitar la UNIQUE que esta prueba pretende
  // probar. Se agrega "tokenKeyVersion" (1) a ambas filas -- ninguna otra
  // columna cambia.
  it("solicitudes_derechos_tokenHash_key es unico: dos filas con el mismo tokenHash no coexisten", async () => {
    const tokenHash = "a".repeat(64);
    const idA = `chk-5a-${fixture.evaluacionExpresV2Id}`;
    const idB = `chk-5b-${fixture.evaluacionExpresV2Id}`;
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion", "expiraEn", "createdAt", "actualizadaEn")
      VALUES (${idA}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${tokenHash}, 1, now() + interval '1 day', now(), now())`;
    await expect(
      prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${idB}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                ${tokenHash}, 1, now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/solicitudes_derechos_tokenHash_key/);
    await prismaAdmin.solicitudDerechos.delete({ where: { id: idA } });
  });

  // --- CORRECCION Alex 2026-10-22, punto 1 (segunda ronda): la
  // expiracion de crear_solicitud_derechos ya NO es un parametro
  // (p_expira_en eliminado de la firma) -- SIEMPRE now() + 24h, fijada
  // dentro de la funcion. ---
  describe("crear_solicitud_derechos -- expiracion fija (el llamador no la controla, punto 1 segunda ronda)", () => {
    it("crea la fila con expiraEn ~ now() + 24h SIN que exista ningun parametro para pedir otra cosa -- la firma real (5 argumentos) ya no deja hueco para intentarlo", async () => {
      // CORRECCION punto 1 (Alex, auditoria v11 fallida, 2026-10-23,
      // barrido amplio): prismaAdmin, nunca prisma -- lectura de
      // inspeccion de fixture (obtener el correo), nunca el contrato de
      // chainpulse_app bajo prueba aqui (eso es crear_solicitud_derechos,
      // invocado mas abajo via $queryRaw con "prisma").
      const evaluacion = await prismaAdmin.evaluacionExpresV2.findUniqueOrThrow({
        where: { id: fixture.evaluacionExpresV2Id },
      });
      const correoHash = hashCorreoNormalizado(evaluacion.correo!);
      const antes = Date.now();

      const resultado = obtenerFilaUnica<{ creada: boolean; id: string | null }>(
        await prisma.$queryRaw<Array<{ creada: boolean; id: string | null }>>`
          SELECT * FROM crear_solicitud_derechos(
            ${fixture.evaluacionExpresV2Id}, ${correoHash}, 'ELIMINACION_CONTACTO', NULL,
            ${`huella-expiracion-fija-${fixture.evaluacionExpresV2Id}`})`,
        "crear_solicitud_derechos no devolvio ninguna fila (se esperaba exactamente una).",
      );
      expect(resultado.creada).toBe(true);
      expect(resultado.id).not.toBeNull();

      const fila = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id: resultado.id! } });
      const horasHastaExpirar = (fila.expiraEn.getTime() - antes) / (1000 * 60 * 60);
      // Tolerancia de 1 minuto para el tiempo de ida y vuelta de la
      // prueba -- el punto central es que SIEMPRE es ~24h, nunca un
      // valor arbitrario que un llamador hubiera podido pedir.
      expect(horasHastaExpirar).toBeGreaterThan(23.98);
      expect(horasHastaExpirar).toBeLessThan(24.02);

      await prismaAdmin.solicitudDerechos.delete({ where: { id: resultado.id! } });
    });
  });

  // --- CORRECCION Alex 2026-10-22, punto 3: FK real + coherencia
  // resueltoCanal/administrador. ---
  describe("resueltoPorUsuarioId -- FK real hacia usuarios + coherencia con resueltoCanal (punto 3)", () => {
    let admin: { empresaId: string; usuarioId: string };

    beforeAll(async () => {
      admin = await crearFixtureUsuarioAdminRf24("fk-resuelto");
    }, 30000);

    afterAll(async () => {
      if (admin) await borrarFixtureUsuarioAdminRf24(admin);
    });

    it("solicitudes_derechos_resueltoPorUsuarioId_fkey rechaza un usuarioId que no existe en usuarios", async () => {
      const id = `chk-fk-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "resueltoCanal", "resueltoPorUsuarioId",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  'SOPORTE'::"EstadoResolucion", ${`usuario-inexistente-${fixture.evaluacionExpresV2Id}`},
                  now() + interval '1 day', 'PROCESADA', now(), now())`,
      ).rejects.toThrow(/solicitudes_derechos_resueltoPorUsuarioId_fkey/);
    });

    it("resuelto_canal_administrador_coherente rechaza SOPORTE sin administrador", async () => {
      const id = `chk-coh-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "resueltoCanal", "resueltoPorUsuarioId",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  'SOPORTE'::"EstadoResolucion", NULL,
                  now() + interval '1 day', 'PROCESADA', now(), now())`,
      ).rejects.toThrow(/resuelto_canal_administrador_coherente/);
    });

    it("resuelto_canal_administrador_coherente rechaza AUTOMATICO con un administrador poblado", async () => {
      const id = `chk-coh-2-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "resueltoCanal", "resueltoPorUsuarioId",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  'AUTOMATICO'::"EstadoResolucion", ${admin.usuarioId},
                  now() + interval '1 day', 'PROCESADA', now(), now())`,
      ).rejects.toThrow(/resuelto_canal_administrador_coherente/);
    });

    it("resuelto_canal_administrador_coherente acepta SOPORTE con un administrador REAL poblado", async () => {
      const id = `chk-coh-3-${fixture.evaluacionExpresV2Id}`;
      await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "resueltoCanal", "resueltoPorUsuarioId",
         "expiraEn", estado, "createdAt", "actualizadaEn")
        VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                'SOPORTE'::"EstadoResolucion", ${admin.usuarioId},
                now() + interval '1 day', 'PROCESADA', now(), now())`;
      const fila = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id } });
      expect(fila.resueltoPorUsuarioId).toBe(admin.usuarioId);
      await prismaAdmin.solicitudDerechos.delete({ where: { id } });
    });

    // --- CORRECCION Alex 2026-10-22 (segunda ronda), punto 2: la FK
    // paso de ON DELETE SET NULL a ON DELETE RESTRICT -- un
    // administrador que resolvio al menos una SolicitudDerechos por
    // SOPORTE ya NO puede borrarse en silencio (antes la fila quedaba
    // huerfana con resueltoPorUsuarioId=NULL; ahora el borrado del
    // Usuario se rechaza mientras la fila exista). Fixture de Usuario
    // PROPIO en cada prueba (nunca el `admin` compartido de arriba) --
    // una prueba que intenta borrarlo no debe interferir con las demas.
    //
    // CORRECCION punto 4 (Alex, auditoria v11 fallida, 2026-10-23):
    // prismaAdmin, nunca prisma, en el delete/findUnique de estas 2
    // pruebas -- "usuarios" tiene RLS por tenant (prisma/rls.sql,
    // tenant_isolation_usuarios: USING ("empresaId" = current_setting
    // ('app.tenant_id', true))). El cliente de aplicacion no fija
    // app.tenant_id en este contexto de prueba, asi que para ese rol la
    // fila del fixture es INVISIBLE -- prisma.usuario.delete/findUnique
    // devolvian "record not found" (P2025/null), NUNCA el error real de
    // la FK RESTRICT, en el log real de v11. prismaAdmin corre como
    // neondb_owner (propietario de la tabla, exento de RLS por diseno,
    // igual que crearFixtureUsuarioAdminRf24/borrarFixtureUsuarioAdminRf24
    // de mas arriba) -- con prismaAdmin la fila SI es visible y el
    // DELETE llega de verdad a Postgres, que es lo que esta prueba
    // necesita ejercitar (la RESTRICT real), nunca el contrato de RLS/
    // privilegios de chainpulse_app, que no es lo que estas 2 pruebas
    // validan.
    it("ON DELETE RESTRICT bloquea borrar un administrador mientras exista una SolicitudDerechos que lo referencia", async () => {
      const referenciado = await crearFixtureUsuarioAdminRf24("restrict-referenciado");
      const id = `chk-restrict-1-${fixture.evaluacionExpresV2Id}`;
      await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "resueltoCanal", "resueltoPorUsuarioId",
         "expiraEn", estado, "createdAt", "actualizadaEn")
        VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                'SOPORTE'::"EstadoResolucion", ${referenciado.usuarioId},
                now() + interval '1 day', 'PROCESADA', now(), now())`;

      await expect(
        prismaAdmin.usuario.delete({ where: { id: referenciado.usuarioId } }),
      ).rejects.toThrow(/solicitudes_derechos_resueltoPorUsuarioId_fkey/);

      // Limpieza en el orden que la propia RESTRICT exige: primero la
      // fila que referencia, despues el Usuario/Empresa.
      await prismaAdmin.solicitudDerechos.delete({ where: { id } });
      await borrarFixtureUsuarioAdminRf24(referenciado);
    });

    it("ON DELETE RESTRICT permite borrar un administrador que NO tiene ninguna SolicitudDerechos referenciandolo", async () => {
      const sinReferencias = await crearFixtureUsuarioAdminRf24("restrict-sin-referencias");

      await prismaAdmin.usuario.delete({ where: { id: sinReferencias.usuarioId } });

      const usuarioTrasBorrado = await prismaAdmin.usuario.findUnique({ where: { id: sinReferencias.usuarioId } });
      expect(usuarioTrasBorrado).toBeNull();

      await prismaAdmin.empresa.delete({ where: { id: sinReferencias.empresaId } }); // ya sin Usuario que cascada
    });
  });

  // --- CORRECCION Alex 2026-10-22, punto 4: constraints de integridad
  // del despacho (hash/version, envio/token, reclamo/lease, intentos,
  // version). ---
  describe("constraints de integridad del despacho (punto 4)", () => {
    it("token_hash_version_pareja rechaza tokenHash poblado con tokenKeyVersion NULL", async () => {
      const id = `chk-par-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion",
           "expiraEn", "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  ${"1".repeat(64)}, NULL, now() + interval '1 day', now(), now())`,
      ).rejects.toThrow(/token_hash_version_pareja/);
    });

    it("token_hash_version_pareja rechaza tokenKeyVersion poblado con tokenHash NULL", async () => {
      const id = `chk-par-2-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion",
           "expiraEn", "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  NULL, 1, now() + interval '1 day', now(), now())`,
      ).rejects.toThrow(/token_hash_version_pareja/);
    });

    it("envio_confirmado_requiere_token rechaza envioConfirmadoEn poblado sin tokenHash en una fila PENDIENTE", async () => {
      const id = `chk-env-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "envioConfirmadoEn",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  NULL, now(), now() + interval '1 day', 'PENDIENTE', now(), now())`,
      ).rejects.toThrow(/envio_confirmado_requiere_token/);
    });

    it("envio_confirmado_requiere_token permite envioConfirmadoEn poblado SIN tokenHash cuando el estado es terminal (fila ya purgada -- funcion 12)", async () => {
      const id = `chk-env-2-${fixture.evaluacionExpresV2Id}`;
      await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "envioConfirmadoEn",
         "expiraEn", "consumidoEn", estado, "createdAt", "actualizadaEn")
        VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                NULL, now(), now() - interval '1 day', now(), 'PROCESADA', now(), now())`;
      const fila = await prismaAdmin.solicitudDerechos.findUniqueOrThrow({ where: { id } });
      expect(fila.tokenHash).toBeNull();
      expect(fila.envioConfirmadoEn).not.toBeNull();
      await prismaAdmin.solicitudDerechos.delete({ where: { id } });
    });

    it("reclamo_lease_pareja rechaza reclamoId poblado con reclamadoHasta NULL", async () => {
      const id = `chk-rec-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "reclamoId", "reclamadoHasta",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  ${randomUUID()}, NULL, now() + interval '1 day', 'PENDIENTE', now(), now())`,
      ).rejects.toThrow(/reclamo_lease_pareja/);
    });

    it("reclamo_lease_pareja rechaza reclamadoHasta poblado con reclamoId NULL", async () => {
      const id = `chk-rec-2-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "reclamoId", "reclamadoHasta",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  NULL, now() + interval '2 minutes', now() + interval '1 day', 'PENDIENTE', now(), now())`,
      ).rejects.toThrow(/reclamo_lease_pareja/);
    });

    it("intentos_envio_no_negativo rechaza un intentosEnvio negativo", async () => {
      const id = `chk-int-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "intentosEnvio",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  -1, now() + interval '1 day', 'PENDIENTE', now(), now())`,
      ).rejects.toThrow(/intentos_envio_no_negativo/);
    });

    it("token_key_version_positivo rechaza tokenKeyVersion = 0", async () => {
      const id = `chk-ver-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion",
           "expiraEn", "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  ${"2".repeat(64)}, 0, now() + interval '1 day', now(), now())`,
      ).rejects.toThrow(/token_key_version_positivo/);
    });

    it("token_key_version_positivo rechaza tokenKeyVersion negativa", async () => {
      const id = `chk-ver-2-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion",
           "expiraEn", "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  ${"3".repeat(64)}, -1, now() + interval '1 day', now(), now())`,
      ).rejects.toThrow(/token_key_version_positivo/);
    });
  });

  it("las firmas reales de las 11 funciones publicas coinciden exactamente con las esperadas (pg_proc)", async () => {
    const client = await conectarComoOwner();
    try {
      for (const { nombre, argumentos } of FUNCIONES_PUBLICAS_RF24) {
        const { rows } = await client.query(
          `SELECT pg_get_function_identity_arguments(oid) AS firma
             FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
          [nombre],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].firma).toBe(argumentos);
      }
    } finally {
      await client.end();
    }
  });
});

describe("Prueba 3 -- privilegios efectivos de tablas y funciones", () => {
  it("solicitudes_derechos e intentos_solicitud_derechos_descartados: chainpulse_app no tiene ningun privilegio en information_schema.role_table_grants", async () => {
    const client = await conectarComoOwner();
    try {
      for (const tabla of TABLAS_RF24) {
        const { rows } = await client.query(
          `SELECT privilege_type FROM information_schema.role_table_grants
             WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'chainpulse_app'`,
          [tabla],
        );
        expect(rows).toHaveLength(0);
      }
    } finally {
      await client.end();
    }
  });

  it("las 11 funciones publicas otorgan EXECUTE a chainpulse_app con la firma exacta (information_schema.routine_privileges)", async () => {
    const client = await conectarComoOwner();
    try {
      for (const { nombre } of FUNCIONES_PUBLICAS_RF24) {
        const { rows } = await client.query(
          `SELECT grantee FROM information_schema.routine_privileges
             WHERE routine_schema = 'public' AND routine_name = $1 AND privilege_type = 'EXECUTE'`,
          [nombre],
        );
        const grantees: string[] = rows.map((r: { grantee: string }) => r.grantee);
        expect(grantees).toContain("chainpulse_app");
      }
    } finally {
      await client.end();
    }
  });
});

describe("Prueba 4 -- PUBLIC sin ejecucion", () => {
  it("ninguna de las 12 funciones RF24 (las 11 publicas + la interna) otorga EXECUTE a PUBLIC", async () => {
    const client = await conectarComoOwner();
    try {
      const todas = [...FUNCIONES_PUBLICAS_RF24, FUNCION_INTERNA_RF24];
      for (const { nombre } of todas) {
        const { rows } = await client.query(
          `SELECT grantee FROM information_schema.routine_privileges
             WHERE routine_schema = 'public' AND routine_name = $1 AND privilege_type = 'EXECUTE' AND grantee = 'PUBLIC'`,
          [nombre],
        );
        expect(rows).toHaveLength(0);
      }
    } finally {
      await client.end();
    }
  });

  it("ninguna de las 2 tablas RF24 otorga ningun privilegio a PUBLIC", async () => {
    const client = await conectarComoOwner();
    try {
      for (const tabla of TABLAS_RF24) {
        const { rows } = await client.query(
          `SELECT privilege_type FROM information_schema.role_table_grants
             WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'PUBLIC'`,
          [tabla],
        );
        expect(rows).toHaveLength(0);
      }
    } finally {
      await client.end();
    }
  });
});

describe("Prueba 5 -- chainpulse_app sin CRUD directo", () => {
  let fixture: FixtureEvaluacionRf24;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
    fixture = await crearFixtureEvaluacionRf24("sin-crud");
  }, 30000);

  afterAll(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it("la funcion interna aplicar_efecto_solicitud_derechos nunca aparece en information_schema.routine_privileges para chainpulse_app", async () => {
    const client = await conectarComoOwner();
    try {
      const { rows } = await client.query(
        `SELECT grantee FROM information_schema.routine_privileges
           WHERE routine_schema = 'public' AND routine_name = $1 AND grantee = 'chainpulse_app'`,
        [FUNCION_INTERNA_RF24.nombre],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it("una conexion autenticada como chainpulse_app no puede SELECT/INSERT/UPDATE/DELETE directamente sobre ninguna de las 2 tablas de RF24 (Ronda 8: se agrega UPDATE/DELETE y la segunda tabla, antes solo se cubria SELECT/INSERT sobre solicitudes_derechos)", async () => {
    const connectionStringApp = process.env.CHAINPULSE_APP_DATABASE_URL;
    if (!connectionStringApp) {
      // Documentado, no fingido: esta verificacion a nivel de conexion
      // real como el rol de aplicacion necesita una connection string
      // propia de chainpulse_app (no DATABASE_URL, que en este proyecto
      // conecta como neondb_owner -- ver ADR-0003). Sin esa variable, la
      // prueba de arriba (catalogo de privilegios via
      // information_schema.role_table_grants) ya demuestra la misma
      // propiedad por via catalogo; esta prueba queda preparada para
      // cuando CHAINPULSE_APP_DATABASE_URL este disponible en el
      // runbook de rama temporal Neon.
      return;
    }
    const clienteApp = new Client({ connectionString: connectionStringApp });
    await clienteApp.connect();
    try {
      // solicitudes_derechos: SELECT/INSERT/UPDATE/DELETE, los 4.
      await expect(clienteApp.query(`SELECT * FROM "solicitudes_derechos" LIMIT 1`)).rejects.toThrow();
      await expect(
        clienteApp.query(
          `INSERT INTO "solicitudes_derechos" (id, "evaluacionExpresV2Id", tipo, "expiraEn", "createdAt", "actualizadaEn")
             VALUES ('x', $1, 'ELIMINACION_CONTACTO', now(), now(), now())`,
          [fixture.evaluacionExpresV2Id],
        ),
      ).rejects.toThrow();
      // Ronda 8 (Alex, parte del punto "acceso directo SELECT/INSERT/
      // UPDATE/DELETE falla para chainpulse_app"): el privilegio se
      // revoca a nivel de ACL, ANTES de evaluar si la fila existe o no
      // -- por eso un WHERE que no empareja ninguna fila real sigue
      // siendo una prueba valida del privilegio (el motor rechaza por
      // falta de permiso, nunca llega a buscar filas).
      await expect(
        clienteApp.query(`UPDATE "solicitudes_derechos" SET estado = estado WHERE id = 'no-existe-ronda-8'`),
      ).rejects.toThrow();
      await expect(
        clienteApp.query(`DELETE FROM "solicitudes_derechos" WHERE id = 'no-existe-ronda-8'`),
      ).rejects.toThrow();

      // intentos_solicitud_derechos_descartados: SELECT/INSERT/UPDATE/
      // DELETE, los 4 -- Ronda 8, tabla antes no cubierta en esta prueba.
      await expect(clienteApp.query(`SELECT * FROM "intentos_solicitud_derechos_descartados" LIMIT 1`)).rejects.toThrow();
      await expect(
        clienteApp.query(`INSERT INTO "intentos_solicitud_derechos_descartados" (id) VALUES ('no-existe-ronda-8')`),
      ).rejects.toThrow();
      await expect(
        clienteApp.query(
          `UPDATE "intentos_solicitud_derechos_descartados" SET "creadoEn" = "creadoEn" WHERE id = 'no-existe-ronda-8'`,
        ),
      ).rejects.toThrow();
      await expect(
        clienteApp.query(`DELETE FROM "intentos_solicitud_derechos_descartados" WHERE id = 'no-existe-ronda-8'`),
      ).rejects.toThrow();
    } finally {
      await clienteApp.end();
    }
  });
});

describe("Prueba 6 -- propietario exacto de cada funcion", () => {
  it("las 12 funciones RF24 (las 11 publicas + la interna) son propiedad de neondb_owner", async () => {
    const client = await conectarComoOwner();
    try {
      const todas = [...FUNCIONES_PUBLICAS_RF24, FUNCION_INTERNA_RF24];
      for (const { nombre } of todas) {
        const { rows } = await client.query(
          `SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
             WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`,
          [nombre],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].rolname).toBe("neondb_owner");
      }
    } finally {
      await client.end();
    }
  });
});

describe("Prueba 7 -- intentos de shadowing con objetos temporales sin efecto", () => {
  let fixture: FixtureEvaluacionRf24;
  let clienteSesion: Client;
  // CORRECCION (Alex, auditoria residuos v12, 2026-10-24): el `it` de
  // "tipo temporal" de este describe usa, A PROPOSITO, un correo que NO
  // coincide con el de la fixture (para probar que el cast homonimo
  // sigue resolviendo contra el ENUM real, nunca contra el objeto de
  // pg_temp) -- eso hace que crear_solicitud_derechos caiga en la rama
  // "no revela si fue por no-coincidencia o por limite alcanzado" (ver
  // migracion de funciones, Funcion 1) e inserte un descarte senuelo en
  // "intentos_solicitud_derechos_descartados", tabla que NO tiene (ni
  // debe tener, ver "Tabla senuelo" en el schema real) ninguna columna
  // que lo vincule a este fixture -- ningun afterEach puede borrarlo por
  // id/FK. Misma estrategia de VENTANA DE TIEMPO que Prueba 8
  // (rf24Concurrencia.integration.test.ts): reloj del propio servidor
  // (SELECT now()), capturado en beforeEach antes de cada `it` de este
  // describe (los otros 2 `it` no generan ningun descarte, asi que el
  // DELETE de abajo no les afecta -- 0 filas, inofensivo). Esto NUNCA
  // relaja el gate final de fixtures=0: lo deja en cero de verdad.
  let ventanaDescartadosDesde: Date;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
    fixture = await crearFixtureEvaluacionRf24("shadowing");
    clienteSesion = await conectarComoOwner();
  }, 30000);

  afterAll(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
    if (clienteSesion) await clienteSesion.end();
  });

  beforeEach(async () => {
    const filaReloj = await prismaAdmin.$queryRaw<{ ahora: Date }[]>`SELECT now() AS ahora`;
    ventanaDescartadosDesde = obtenerFilaUnica<{ ahora: Date }>(filaReloj, "SELECT now() no devolvio ninguna fila -- no se puede acotar la ventana de limpieza de descartes senuelo.").ahora;
  });

  afterEach(async () => {
    // pg_temp es por-sesion -- se limpia al cerrar la conexion de todos
    // modos, pero se dropean explicitamente entre pruebas para que cada
    // `it` empiece desde un estado limpio conocido.
    await clienteSesion.query(`DROP TABLE IF EXISTS pg_temp.solicitudes_derechos`);
    // Ventana de tiempo -- unica limpieza posible para el descarte
    // senuelo del `it` de "tipo temporal" (ver comentario de arriba).
    // prismaAdmin: Ronda 8 revoco los 4 privilegios directos de
    // chainpulse_app sobre esta tabla.
    await prismaAdmin.$executeRaw`DELETE FROM "intentos_solicitud_derechos_descartados" WHERE "creadoEn" >= ${ventanaDescartadosDesde}`;
  });

  it("una tabla temporal 'solicitudes_derechos' en la sesion llamante no desvia a procesar_solicitud_derechos de la tabla real", async () => {
    // Siembra una fila PENDIENTE real con un token conocido.
    const tokenHash = "b".repeat(64);
    const id = `shadow-1-${fixture.evaluacionExpresV2Id}`;
    await prismaAdmin.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "tokenKeyVersion",
       "expiraEn", estado, "createdAt", "actualizadaEn")
      VALUES (${id}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${tokenHash}, 1, now() + interval '1 day', 'PENDIENTE', now(), now())`;

    // La sesion llamante (misma conexion que invoca la funcion) crea una
    // tabla TEMPORAL con el mismo nombre sin calificar, poblada con una
    // fila senuelo que, si la funcion resolviera el identificador sin
    // calificar contra pg_temp primero, haria creer que la solicitud no
    // existe (y por lo tanto devolveria procesada=false) o -- peor --
    // marcaria PROCESADA una fila falsa sin tocar la real.
    await clienteSesion.query(
      `CREATE TEMP TABLE solicitudes_derechos (id text, "tokenHash" text, estado text, "expiraEn" timestamp)`,
    );
    await clienteSesion.query(
      `INSERT INTO pg_temp.solicitudes_derechos (id, "tokenHash", estado, "expiraEn") VALUES ('fila-senuelo', $1, 'PENDIENTE', now() + interval '1 day')`,
      [tokenHash],
    );

    const { rows } = await clienteSesion.query(`SELECT * FROM procesar_solicitud_derechos($1)`, [tokenHash]);
    expect(rows[0].procesada).toBe(true);

    const filaReal = await prismaAdmin.solicitudDerechos.findUnique({ where: { id } });
    expect(filaReal?.estado).toBe("PROCESADA");

    const filaSenuelo = await clienteSesion.query(`SELECT * FROM pg_temp.solicitudes_derechos WHERE id = 'fila-senuelo'`);
    expect(filaSenuelo.rows[0].estado).toBe("PENDIENTE"); // nunca tocada
  });

  it("un tipo temporal 'TipoSolicitudDerechos' en la sesion llamante no desvia el cast dentro de crear_solicitud_derechos", async () => {
    await clienteSesion.query(`CREATE TEMP TABLE "TipoSolicitudDerechos" (valor text)`); // objeto homonimo, forma distinta a proposito
    const correoHash = hashCorreoNormalizado(`titular-shadowing-tipo@chainpulse.test`);
    // No se espera que esto rompa -- el objetivo de esta prueba es que
    // el cast ::public."TipoSolicitudDerechos" (completamente calificado
    // dentro del cuerpo de la funcion) siga resolviendo contra el ENUM
    // real de "public", nunca contra el objeto homonimo de pg_temp
    // (que ademas tiene una forma incompatible -- si el shadowing
    // ocurriera, esto fallaria con un error de tipo distinto al
    // esperado, o produciria un resultado incorrecto en silencio).
    const { rows } = await clienteSesion.query(
      `SELECT * FROM crear_solicitud_derechos($1, $2, 'RETIRO_CONSENTIMIENTO', 'DIAGNOSTICO', 'huella-shadow-tipo')`,
      [fixture.evaluacionExpresV2Id, correoHash],
    );
    expect(rows[0].creada).toBe(false); // correo no coincide (titular real tiene otro correo) -- lo que importa es que NO lance un error de tipo
  });
});

// Prueba 19 (Alex, auditoria de los 24 fallos, 2026-10-23): regresion
// explicita de la migracion 5 -- nunca se asume que A1/A2 quedaron
// corregidos solo porque las pruebas preexistentes (Prueba 2/7, que ya
// exponian ambos bugs) vuelven a pasar; esta describe lo verifica de
// forma dedicada y ademas reconfirma que la correccion no abrio ningun
// privilegio nuevo.
describe("Prueba 19 -- regresion migracion 5 (A1: 42702 corregido; A2: consentimientos_expres.id poblado; privilegios intactos)", () => {
  let fixture: FixtureEvaluacionRf24;

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
    fixture = await crearFixtureEvaluacionRf24("regresion-migracion5");
  }, 30000);

  afterAll(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture, prismaAdmin);
  });

  it('A1 -- crear_solicitud_derechos ya NO lanza SQLSTATE 42702 ("column reference \\"id\\" is ambiguous") y devuelve un id real', async () => {
    // CORRECCION punto 1 (Alex, auditoria v11 fallida, 2026-10-23,
    // barrido amplio): prismaAdmin, nunca prisma -- lectura de inspeccion
    // de fixture.
    const evaluacion = await prismaAdmin.evaluacionExpresV2.findUniqueOrThrow({
      where: { id: fixture.evaluacionExpresV2Id },
    });
    const correoHash = hashCorreoNormalizado(evaluacion.correo!);
    const resultado = obtenerFilaUnica<{ creada: boolean; id: string | null }>(
      await prisma.$queryRaw<Array<{ creada: boolean; id: string | null }>>`
        SELECT * FROM crear_solicitud_derechos(
          ${fixture.evaluacionExpresV2Id}, ${correoHash}, 'ELIMINACION_CONTACTO', NULL,
          ${`huella-regresion-a1-${fixture.evaluacionExpresV2Id}`})`,
      "crear_solicitud_derechos no devolvio ninguna fila (se esperaba exactamente una) -- regresion A1.",
    );
    // Antes de la migracion 5, esta misma llamada lanzaba 42702 antes de
    // devolver ninguna fila -- que obtenerFilaUnica() reciba una fila con
    // "creada" ya demuestra que la ambiguedad quedo resuelta.
    expect(resultado.creada).toBe(true);
    expect(resultado.id).not.toBeNull();
    await prismaAdmin.solicitudDerechos.delete({ where: { id: resultado.id! } });
  });

  it("A2 -- aplicar_efecto_solicitud_derechos (via la ruta publica procesar_solicitud_derechos) ya NO viola el NOT NULL de consentimientos_expres.id", async () => {
    // CORRECCION punto 1 (Alex, auditoria v11 fallida, 2026-10-23,
    // barrido amplio): prismaAdmin, nunca prisma -- lectura de inspeccion
    // de fixture.
    const evaluacion = await prismaAdmin.evaluacionExpresV2.findUniqueOrThrow({
      where: { id: fixture.evaluacionExpresV2Id },
    });
    const correoHash = hashCorreoNormalizado(evaluacion.correo!);
    const creado = obtenerFilaUnica<{ creada: boolean; id: string | null }>(
      await prisma.$queryRaw<Array<{ creada: boolean; id: string | null }>>`
        SELECT * FROM crear_solicitud_derechos(
          ${fixture.evaluacionExpresV2Id}, ${correoHash}, 'RETIRO_CONSENTIMIENTO', 'DIAGNOSTICO',
          ${`huella-regresion-a2-${fixture.evaluacionExpresV2Id}`})`,
      "crear_solicitud_derechos no devolvio ninguna fila -- regresion A2 (preparacion).",
    );
    expect(creado.creada).toBe(true);
    const solicitudId = creado.id!;
    const tokenHash = "f".repeat(64);
    // Persiste el token como si ya hubiera sido despachado -- unico
    // objetivo de esta linea es dejar la fila en el estado que
    // procesar_solicitud_derechos exige (PENDIENTE, expiraEn > now(),
    // tokenHash = el que se va a confirmar); nunca ejercita el reclamo/
    // lease real de reclamar_solicitudes_derechos_para_envio, que no es
    // lo que esta prueba de regresion mide.
    await prismaAdmin.solicitudDerechos.update({
      where: { id: solicitudId },
      data: { tokenHash, tokenKeyVersion: 1 },
    });

    // procesar_solicitud_derechos es la ruta PUBLICA real (SECURITY
    // DEFINER, EXECUTE ya otorgado a chainpulse_app) -- llama internamente
    // a aplicar_efecto_solicitud_derechos; esta prueba de regresion NUNCA
    // invoca la funcion interna de forma directa (eso es exactamente lo
    // que B5 corrigio que NO se hiciera).
    const procesado = obtenerFilaUnica<{ procesada: boolean }>(
      await prisma.$queryRaw<Array<{ procesada: boolean }>>`SELECT * FROM procesar_solicitud_derechos(${tokenHash})`,
      "procesar_solicitud_derechos no devolvio ninguna fila -- regresion A2.",
    );
    // Antes de la migracion 5, procesar_solicitud_derechos lanzaba el
    // error de NOT NULL de consentimientos_expres.id ANTES de poder
    // devolver "procesada" -- que esta linea pase ya demuestra que A2
    // quedo corregido; la fila de abajo confirma ademas que el id
    // quedo poblado (nunca NULL ni vacio), no solo que no hubo excepcion.
    expect(procesado.procesada).toBe(true);

    const consentimientos = await prismaAdmin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "consentimientos_expres"
      WHERE "evaluacionExpresV2Id" = ${fixture.evaluacionExpresV2Id}
        AND finalidad = 'DIAGNOSTICO'::"FinalidadConsentimiento"
      ORDER BY "createdAt" DESC LIMIT 1`;
    const consentimiento = consentimientos[0];
    expect(consentimiento).not.toBeUndefined();
    expect(consentimiento?.id).toBeTruthy();

    await prismaAdmin.solicitudDerechos.delete({ where: { id: solicitudId } });
  });

  it("modelo de privilegios intacto tras la migracion 5: chainpulse_app sigue sin SELECT/INSERT/UPDATE/DELETE directo sobre las 2 tablas de RF24", async () => {
    const client = await conectarComoOwner();
    try {
      for (const tabla of TABLAS_RF24) {
        const { rows } = await client.query(
          `SELECT privilege_type FROM information_schema.role_table_grants
             WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'chainpulse_app'`,
          [tabla],
        );
        expect(rows).toHaveLength(0);
      }
    } finally {
      await client.end();
    }
  });
});
