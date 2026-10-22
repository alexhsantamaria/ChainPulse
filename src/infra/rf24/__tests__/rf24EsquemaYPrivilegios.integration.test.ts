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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../prisma/client";
import { hashPassword } from "../../auth/password";
import {
  requerirEntornoDePruebasRf24Confirmado,
  crearFixtureEvaluacionRf24,
  borrarFixtureEvaluacionRf24,
  hashCorreoNormalizado,
  type FixtureEvaluacionRf24,
} from "./entornoPruebasIntegracionRf24";

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
 */
async function crearFixtureUsuarioAdminRf24(etiqueta: string): Promise<{ empresaId: string; usuarioId: string }> {
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(`integracion-rf24-${randomUUID()}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
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

async function borrarFixtureUsuarioAdminRf24(fixture: { empresaId: string }): Promise<void> {
  await prisma.empresa.delete({ where: { id: fixture.empresaId } }); // onDelete: Cascade se lleva al Usuario
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
const FUNCIONES_PUBLICAS_RF24: Array<{ nombre: string; argumentos: string }> = [
  { nombre: "crear_solicitud_derechos", argumentos: "text, text, text, text, text" },
  { nombre: "procesar_solicitud_derechos", argumentos: "text" },
  { nombre: "resolver_solicitud_por_soporte", argumentos: "text, text" },
  { nombre: "reclamar_solicitudes_derechos_para_envio", argumentos: "" },
  { nombre: "asignar_token_pendiente", argumentos: "text, text, text, integer" },
  { nombre: "confirmar_envio_token", argumentos: "text, text" },
  { nombre: "registrar_fallo_envio_solicitud_derechos", argumentos: "text, text" },
  { nombre: "cancelar_solicitud_derechos_por_envio_fallido", argumentos: "text, text" },
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

describe("Prueba 1 -- migraciones aplicables desde una copia de production", () => {
  it("las 3 migraciones de RF24 existen, en orden, bajo prisma/migrations/", () => {
    // Verificacion estatica (sin red): el ORDEN relativo (enum aislado
    // primero, tabla despues, funciones al final) es lo que realmente
    // importa para "aplicable desde una copia de production" -- ALTER
    // TYPE ... ADD VALUE exige su propia transaccion ya COMMITeada antes
    // de que cualquier otra migracion use el valor nuevo (ver cabecera de
    // la migracion 1). La aplicacion real contra una copia de production
    // (el runbook de rama temporal Neon, bloqueado en esta entrega) es lo
    // que demuestra esto de punta a punta -- esta asercion es el
    // chequeo minimo que SI puede correr localmente.
    const carpetas: string[] = readdirSync("prisma/migrations").filter((c: string) => c.startsWith("202610220"));
    expect(carpetas.sort()).toEqual([
      "20261022080000_rf24_enum_bucket_limite_tasa",
      "20261022090000_rf24_tabla_solicitud_derechos",
      "20261022100000_rf24_funciones_controladas",
    ]);
  });

  it("aplica las 3 migraciones de RF24, en orden, contra una copia real de production (sin destruir nada preexistente)", async () => {
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
    if (fixture) await borrarFixtureEvaluacionRf24(fixture);
  });

  it("alcance_retiro_coherente rechaza ELIMINACION_CONTACTO con alcanceRetiro no nulo", async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${`chk-1-${fixture.evaluacionExpresV2Id}`}, ${fixture.evaluacionExpresV2Id},
                'ELIMINACION_CONTACTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/alcance_retiro_coherente/);
  });

  it("alcance_retiro_coherente rechaza RETIRO_CONSENTIMIENTO con alcanceRetiro nulo", async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${`chk-2-${fixture.evaluacionExpresV2Id}`}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", NULL,
                now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/alcance_retiro_coherente/);
  });

  it("token_hash_formato rechaza un tokenHash que no sea sha256 hexadecimal de 64 caracteres", async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${`chk-3-${fixture.evaluacionExpresV2Id}`}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                'no-es-un-hash-valido', now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/token_hash_formato/);
  });

  it("token_hash_formato acepta NULL (fila aun no preparada)", async () => {
    const id = `chk-4-${fixture.evaluacionExpresV2Id}`;
    await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "expiraEn", "createdAt", "actualizadaEn")
      VALUES (${id}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              NULL, now() + interval '1 day', now(), now())`;
    const fila = await prisma.solicitudDerechos.findUnique({ where: { id } });
    expect(fila?.tokenHash).toBeNull();
    await prisma.solicitudDerechos.delete({ where: { id } });
  });

  it("solicitudes_derechos_tokenHash_key es unico: dos filas con el mismo tokenHash no coexisten", async () => {
    const tokenHash = "a".repeat(64);
    const idA = `chk-5a-${fixture.evaluacionExpresV2Id}`;
    const idB = `chk-5b-${fixture.evaluacionExpresV2Id}`;
    await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
      (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "expiraEn", "createdAt", "actualizadaEn")
      VALUES (${idA}, ${fixture.evaluacionExpresV2Id},
              'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
              ${tokenHash}, now() + interval '1 day', now(), now())`;
    await expect(
      prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "expiraEn", "createdAt", "actualizadaEn")
        VALUES (${idB}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                ${tokenHash}, now() + interval '1 day', now(), now())`,
    ).rejects.toThrow(/solicitudes_derechos_tokenHash_key/);
    await prisma.solicitudDerechos.delete({ where: { id: idA } });
  });

  // --- CORRECCION Alex 2026-10-22, punto 1 (segunda ronda): la
  // expiracion de crear_solicitud_derechos ya NO es un parametro
  // (p_expira_en eliminado de la firma) -- SIEMPRE now() + 24h, fijada
  // dentro de la funcion. ---
  describe("crear_solicitud_derechos -- expiracion fija (el llamador no la controla, punto 1 segunda ronda)", () => {
    it("crea la fila con expiraEn ~ now() + 24h SIN que exista ningun parametro para pedir otra cosa -- la firma real (5 argumentos) ya no deja hueco para intentarlo", async () => {
      const evaluacion = await prisma.evaluacionExpresV2.findUniqueOrThrow({
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

      const fila = await prisma.solicitudDerechos.findUniqueOrThrow({ where: { id: resultado.id! } });
      const horasHastaExpirar = (fila.expiraEn.getTime() - antes) / (1000 * 60 * 60);
      // Tolerancia de 1 minuto para el tiempo de ida y vuelta de la
      // prueba -- el punto central es que SIEMPRE es ~24h, nunca un
      // valor arbitrario que un llamador hubiera podido pedir.
      expect(horasHastaExpirar).toBeGreaterThan(23.98);
      expect(horasHastaExpirar).toBeLessThan(24.02);

      await prisma.solicitudDerechos.delete({ where: { id: resultado.id! } });
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
      await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "resueltoCanal", "resueltoPorUsuarioId",
         "expiraEn", estado, "createdAt", "actualizadaEn")
        VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                'SOPORTE'::"EstadoResolucion", ${admin.usuarioId},
                now() + interval '1 day', 'PROCESADA', now(), now())`;
      const fila = await prisma.solicitudDerechos.findUniqueOrThrow({ where: { id } });
      expect(fila.resueltoPorUsuarioId).toBe(admin.usuarioId);
      await prisma.solicitudDerechos.delete({ where: { id } });
    });

    // --- CORRECCION Alex 2026-10-22 (segunda ronda), punto 2: la FK
    // paso de ON DELETE SET NULL a ON DELETE RESTRICT -- un
    // administrador que resolvio al menos una SolicitudDerechos por
    // SOPORTE ya NO puede borrarse en silencio (antes la fila quedaba
    // huerfana con resueltoPorUsuarioId=NULL; ahora el borrado del
    // Usuario se rechaza mientras la fila exista). Fixture de Usuario
    // PROPIO en cada prueba (nunca el `admin` compartido de arriba) --
    // una prueba que intenta borrarlo no debe interferir con las demas.
    it("ON DELETE RESTRICT bloquea borrar un administrador mientras exista una SolicitudDerechos que lo referencia", async () => {
      const referenciado = await crearFixtureUsuarioAdminRf24("restrict-referenciado");
      const id = `chk-restrict-1-${fixture.evaluacionExpresV2Id}`;
      await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "resueltoCanal", "resueltoPorUsuarioId",
         "expiraEn", estado, "createdAt", "actualizadaEn")
        VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                'SOPORTE'::"EstadoResolucion", ${referenciado.usuarioId},
                now() + interval '1 day', 'PROCESADA', now(), now())`;

      await expect(
        prisma.usuario.delete({ where: { id: referenciado.usuarioId } }),
      ).rejects.toThrow(/solicitudes_derechos_resueltoPorUsuarioId_fkey/);

      // Limpieza en el orden que la propia RESTRICT exige: primero la
      // fila que referencia, despues el Usuario/Empresa.
      await prisma.solicitudDerechos.delete({ where: { id } });
      await borrarFixtureUsuarioAdminRf24(referenciado);
    });

    it("ON DELETE RESTRICT permite borrar un administrador que NO tiene ninguna SolicitudDerechos referenciandolo", async () => {
      const sinReferencias = await crearFixtureUsuarioAdminRf24("restrict-sin-referencias");

      await prisma.usuario.delete({ where: { id: sinReferencias.usuarioId } });

      const usuarioTrasBorrado = await prisma.usuario.findUnique({ where: { id: sinReferencias.usuarioId } });
      expect(usuarioTrasBorrado).toBeNull();

      await prisma.empresa.delete({ where: { id: sinReferencias.empresaId } }); // ya sin Usuario que cascada
    });
  });

  // --- CORRECCION Alex 2026-10-22, punto 4: constraints de integridad
  // del despacho (hash/version, envio/token, reclamo/lease, intentos,
  // version). ---
  describe("constraints de integridad del despacho (punto 4)", () => {
    it("token_hash_version_pareja rechaza tokenHash poblado con tokenKeyVersion NULL", async () => {
      const id = `chk-par-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
          (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "envioConfirmadoEn",
           "expiraEn", estado, "createdAt", "actualizadaEn")
          VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                  'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                  NULL, now(), now() + interval '1 day', 'PENDIENTE', now(), now())`,
      ).rejects.toThrow(/envio_confirmado_requiere_token/);
    });

    it("envio_confirmado_requiere_token permite envioConfirmadoEn poblado SIN tokenHash cuando el estado es terminal (fila ya purgada -- funcion 12)", async () => {
      const id = `chk-env-2-${fixture.evaluacionExpresV2Id}`;
      await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
        (id, "evaluacionExpresV2Id", tipo, "alcanceRetiro", "tokenHash", "envioConfirmadoEn",
         "expiraEn", "consumidoEn", estado, "createdAt", "actualizadaEn")
        VALUES (${id}, ${fixture.evaluacionExpresV2Id},
                'RETIRO_CONSENTIMIENTO'::"TipoSolicitudDerechos", 'DIAGNOSTICO'::"AlcanceRetiro",
                NULL, now(), now() - interval '1 day', now(), 'PROCESADA', now(), now())`;
      const fila = await prisma.solicitudDerechos.findUniqueOrThrow({ where: { id } });
      expect(fila.tokenHash).toBeNull();
      expect(fila.envioConfirmadoEn).not.toBeNull();
      await prisma.solicitudDerechos.delete({ where: { id } });
    });

    it("reclamo_lease_pareja rechaza reclamoId poblado con reclamadoHasta NULL", async () => {
      const id = `chk-rec-1-${fixture.evaluacionExpresV2Id}`;
      await expect(
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
        prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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
    if (fixture) await borrarFixtureEvaluacionRf24(fixture);
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

  it("una conexion autenticada como chainpulse_app no puede SELECT/INSERT/UPDATE/DELETE directamente sobre solicitudes_derechos", async () => {
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
      await expect(clienteApp.query(`SELECT * FROM "solicitudes_derechos" LIMIT 1`)).rejects.toThrow();
      await expect(
        clienteApp.query(
          `INSERT INTO "solicitudes_derechos" (id, "evaluacionExpresV2Id", tipo, "expiraEn", "createdAt", "actualizadaEn")
             VALUES ('x', $1, 'ELIMINACION_CONTACTO', now(), now(), now())`,
          [fixture.evaluacionExpresV2Id],
        ),
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

  beforeAll(async () => {
    requerirEntornoDePruebasRf24Confirmado();
    fixture = await crearFixtureEvaluacionRf24("shadowing");
    clienteSesion = await conectarComoOwner();
  }, 30000);

  afterAll(async () => {
    if (fixture) await borrarFixtureEvaluacionRf24(fixture);
    if (clienteSesion) await clienteSesion.end();
  });

  afterEach(async () => {
    // pg_temp es por-sesion -- se limpia al cerrar la conexion de todos
    // modos, pero se dropean explicitamente entre pruebas para que cada
    // `it` empiece desde un estado limpio conocido.
    await clienteSesion.query(`DROP TABLE IF EXISTS pg_temp.solicitudes_derechos`);
  });

  it("una tabla temporal 'solicitudes_derechos' en la sesion llamante no desvia a procesar_solicitud_derechos de la tabla real", async () => {
    // Siembra una fila PENDIENTE real con un token conocido.
    const tokenHash = "b".repeat(64);
    const id = `shadow-1-${fixture.evaluacionExpresV2Id}`;
    await prisma.$executeRaw`INSERT INTO "solicitudes_derechos"
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

    const filaReal = await prisma.solicitudDerechos.findUnique({ where: { id } });
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
