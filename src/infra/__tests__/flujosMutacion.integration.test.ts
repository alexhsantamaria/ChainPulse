// Prueba de integracion — amplia la cobertura automatizada a los flujos
// criticos de MUTACION que todavia no tenian ninguna prueba propia:
// registro de cuenta (RF1), activacion de MFA (ADR-0003), CRUD de
// eslabones/conexiones (RF2/RF3) y el ciclo completo abrir -> responder ->
// cerrar (RF5-RF7). RNF1 (aislamientoMultitenant.integration.test.ts) ya
// prueba el AISLAMIENTO entre tenants para varios de estos modelos; esta
// prueba se enfoca en la LOGICA de cada mutacion (que reglas de negocio
// se cumplen, que errores se lanzan cuando corresponde), no en el
// aislamiento en si.
//
// Corre SOLO con `npm run test:integration` (vitest.integration.config.ts),
// nunca con `npm run test` -- necesita DATABASE_URL real y red hacia
// Neon, por eso queda fuera del ciclo normal de tsc/eslint/vitest en Mac
// (sin acceso de red ni .env -- ver ADR-0003) y se corre a mano en
// Windows, mismo criterio que `prisma generate`/`migrate`/`build` y que
// aislamientoMultitenant.integration.test.ts.
//
// Nota sobre RESEND_API_KEY: abrirCiclo() intenta notificar por correo a
// cada responsable elegible, pero atrapa cualquier error de envio sin
// abortar la apertura del ciclo (ver abrirCiclo.ts). En modo sandbox de
// Resend (sin dominio propio verificado), un envio a una direccion de
// prueba como "...@chainpulse.test" va a fallar porque no es la cuenta
// con la que se creo Resend -- por eso esta prueba no afirma un valor
// exacto de "responsablesNotificados", solo que la apertura del ciclo en
// si no se ve afectada por ese fallo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { prisma } from "../prisma/client";
import { tenantClient } from "../prisma/tenantClient";
import { hashPassword } from "../auth/password";
import { registrarEmpresaYAdmin, EmailYaRegistradoError } from "../auth/registro";
import { verificarCodigoMfa } from "../auth/mfa";
import { calcularCompletitud } from "../conexiones/completitud";
import { abrirCiclo, YaHayCicloAbiertoError } from "../ciclos/abrirCiclo";
import { cerrarCiclo, CicloNoAbiertoError as CicloNoAbiertoErrorCerrar } from "../ciclos/cerrarCiclo";
import {
  registrarRespuestas,
  CicloNoAbiertoError as CicloNoAbiertoErrorRespuestas,
  ConexionNoAsignadaError,
} from "../ciclos/registrarRespuestas";

// Neon "duerme" la base cuando esta inactiva un rato -- mismo margen que
// aislamientoMultitenant.integration.test.ts para la primera conexion de
// la corrida.
const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

async function borrarEmpresaDePrueba(empresaId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    // Mismo hallazgo real de RNF1 (ver README): RespuestaCruda.responsable
    // no tiene onDelete: Cascade, hay que borrarlas a mano antes de la
    // empresa para no chocar con el RESTRICT de Postgres.
    await tx.respuestaCruda.deleteMany({});
    await tx.empresa.delete({ where: { id: empresaId } });
  }, TX_OPTIONS);
}

describe("Registro de cuenta (RF1) y activación de MFA (ADR-0003) — integración", () => {
  let empresaId: string;
  let emailAdmin: string;

  beforeAll(async () => {
    // Este es el primer archivo de prueba del run (ver vitest.integration.config.ts,
    // fileParallelism: false), asi que esta es la primera conexion real hacia Neon.
    // A diferencia de las demas transacciones de este archivo (que usan TX_OPTIONS
    // extendido), la transaccion interna de registrarEmpresaYAdmin() usa el timeout
    // por defecto de Prisma (maxWait 2000ms / timeout 5000ms) porque es codigo de
    // produccion real -- no lo tocamos (ver README: ya validado en vivo con una sola
    // conexion a la vez). En su lugar, "despertamos" la base con una consulta trivial
    // antes de que corra la primera prueba, mismo criterio que el beforeAll de
    // aislamientoMultitenant.integration.test.ts (RNF1).
    await prisma.$queryRaw`SELECT 1`;
  }, 60000);

  afterAll(async () => {
    if (empresaId) {
      await borrarEmpresaDePrueba(empresaId);
    }
  });

  it("registrarEmpresaYAdmin crea la empresa y el administrador atómicamente", async () => {
    emailAdmin = `flujo-registro-${randomUUID()}@chainpulse.test`;
    const resultado = await registrarEmpresaYAdmin({
      nombreEmpresa: "Empresa de prueba (flujo de registro, borrar si queda huérfana)",
      email: emailAdmin,
      password: "contrasena-de-prueba-123",
    });
    empresaId = resultado.empresaId;

    const admin = await tenantClient(empresaId).usuario.findFirst({ where: { email: emailAdmin } });
    expect(admin).not.toBeNull();
    expect(admin?.rol).toBe("ADMINISTRADOR");
    expect(admin?.mfaHabilitado).toBe(false);
    expect(admin?.mfaSecret).toBeTruthy();
  });

  it("un email ya registrado lanza EmailYaRegistradoError y no deja una empresa huérfana", async () => {
    await expect(
      registrarEmpresaYAdmin({
        nombreEmpresa: "Empresa de prueba duplicada (no debería persistir)",
        email: emailAdmin,
        password: "otra-contrasena-123",
      }),
    ).rejects.toThrow(EmailYaRegistradoError);

    // La transaccion de registro es atomica (ver registro.ts): si el
    // usuario falla por email duplicado, la empresa tampoco debe haber
    // quedado creada. No hay forma directa de obtener el empresaId que
    // se intento crear (se genera dentro de la funcion), asi que se
    // confirma indirectamente: bajo el tenant ya conocido (el de la
    // primera llamada) sigue existiendo un solo usuario con ese email.
    // Nota: tiene que ser tenantClient(), no prisma directo sin
    // set_config -- RLS "falla cerrado" sin un tenant fijado (ver RNF1),
    // asi que una consulta cruda aca siempre devolveria [] sin que eso
    // signifique nada sobre si quedo o no una fila huerfana.
    const usuarios = await tenantClient(empresaId).usuario.findMany({ where: { email: emailAdmin } });
    expect(usuarios).toHaveLength(1);
    expect(usuarios[0].empresaId).toBe(empresaId);
  });

  it("un código TOTP válido activa MFA para el administrador", async () => {
    const admin = await tenantClient(empresaId).usuario.findFirst({ where: { email: emailAdmin } });
    if (!admin?.mfaSecret) throw new Error("fixture inválido: falta mfaSecret");

    // Mismos parametros que generarSecretoMfa()/construirOtpauthUrl() en
    // mfa.ts -- se genera el codigo valido "del lado del autenticador"
    // para simular lo que el usuario tipearia en /activar-mfa.
    const totp = new OTPAuth.TOTP({
      issuer: "ChainPulse",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(admin.mfaSecret),
    });
    const codigoValido = totp.generate();

    expect(verificarCodigoMfa(admin.mfaSecret, codigoValido)).toBe(true);

    // Misma mutacion que hace src/app/api/mfa/activar/route.ts tras
    // validar el codigo -- se reproduce aca en vez de invocar la ruta
    // HTTP porque la ruta depende de auth() (sesion de NextAuth), fuera
    // del alcance de esta prueba de infraestructura.
    await tenantClient(empresaId).usuario.update({
      where: { id: admin.id },
      data: { mfaHabilitado: true },
    });

    const actualizado = await tenantClient(empresaId).usuario.findUnique({ where: { id: admin.id } });
    expect(actualizado?.mfaHabilitado).toBe(true);
  });

  it("un código inválido no activa MFA", async () => {
    const admin = await tenantClient(empresaId).usuario.findFirst({ where: { email: emailAdmin } });
    if (!admin?.mfaSecret) throw new Error("fixture inválido: falta mfaSecret");

    expect(verificarCodigoMfa(admin.mfaSecret, "000000")).toBe(false);
    expect(verificarCodigoMfa(admin.mfaSecret, "")).toBe(false);
  });
});

describe("CRUD de eslabones/conexiones (RF2/RF3) y ciclo de pulso completo (RF5-RF7) — integración", () => {
  let empresaId: string;
  let eslabonOrigenId: string;
  let eslabonDestinoId: string;
  let conexionId: string;
  let responsableId: string;
  let cicloId: string;

  beforeAll(async () => {
    empresaId = randomUUID();
    const passwordHash = await hashPassword(`flujo-mutacion-${randomUUID()}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
      await tx.empresa.create({
        data: { id: empresaId, nombre: "Empresa de prueba (flujo de mutación, borrar si queda huérfana)" },
      });
    }, TX_OPTIONS);

    // El usuario RESPONSABLE se crea de entrada (no es lo que este bloque
    // prueba como "CRUD"), pero recien queda "elegible" para un ciclo
    // (obtenerResponsablesElegibles) una vez que su eslabon participe de
    // una conexion "completa" -- eso lo deja armado el propio test de
    // CRUD de conexiones, mas abajo, antes de llegar al describe de ciclos.
    const eslabonOrigen = await tenantClient(empresaId).eslabon.create({ data: { nombre: "Compras (prueba)" } });
    const eslabonDestino = await tenantClient(empresaId).eslabon.create({ data: { nombre: "Producción (prueba)" } });
    eslabonOrigenId = eslabonOrigen.id;
    eslabonDestinoId = eslabonDestino.id;

    const responsable = await tenantClient(empresaId).usuario.create({
      data: {
        email: `flujo-responsable-${randomUUID()}@chainpulse.test`,
        nombre: "Responsable de prueba",
        rol: "RESPONSABLE",
        passwordHash,
        eslabonId: eslabonOrigenId,
      },
    });
    responsableId = responsable.id;
  }, 60000);

  afterAll(async () => {
    if (empresaId) {
      await borrarEmpresaDePrueba(empresaId);
    }
  }, 60000);

  describe("CRUD de eslabones/conexiones (RF2/RF3)", () => {
    it("declarar una conexión sin los datos de criticidad la deja incompleta", async () => {
      const datos = {
        gradoDependencia: null,
        impactoPromesaCliente: null,
        tieneAlternativa: null,
        tiempoTolerable: null,
        tiempoRecuperacion: null,
      };
      const completa = calcularCompletitud(datos);
      expect(completa).toBe(false);

      const conexion = await tenantClient(empresaId).conexion.create({
        data: { origenId: eslabonOrigenId, destinoId: eslabonDestinoId, completa },
      });
      conexionId = conexion.id;
      expect(conexion.completa).toBe(false);
      expect(conexion.criticidadConfirmadaEn).toBeNull();
    });

    it("completar los 5 datos de criticidad marca la conexión como completa", async () => {
      const datos = {
        gradoDependencia: "ALTA" as const,
        impactoPromesaCliente: "ALTO" as const,
        tieneAlternativa: false,
        tiempoTolerable: "CORTO" as const,
        tiempoRecuperacion: "MEDIO" as const,
      };
      const completa = calcularCompletitud(datos);
      expect(completa).toBe(true);

      const conexion = await tenantClient(empresaId).conexion.update({
        where: { id: conexionId },
        data: { ...datos, completa, criticidadConfirmadaEn: new Date() },
      });
      expect(conexion.completa).toBe(true);
      expect(conexion.criticidadConfirmadaEn).not.toBeNull();
    });

    it("declarar la misma conexión (mismo origen/destino) dos veces viola la restricción única", async () => {
      let codigo: string | undefined;
      try {
        await tenantClient(empresaId).conexion.create({
          data: { origenId: eslabonOrigenId, destinoId: eslabonDestinoId, completa: false },
        });
      } catch (err) {
        codigo = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      }
      // Mismo duck-typing que src/app/api/conexiones/route.ts (ver
      // ADR-0003, addendum): P2002 = violación de restricción única.
      expect(codigo).toBe("P2002");
    });
  });

  describe("Ciclo de pulso: abrir → responder → cerrar (RF5-RF7)", () => {
    it("abre un ciclo y detecta al responsable elegible (su eslabón ya tiene una conexión completa)", async () => {
      const resultado = await abrirCiclo(empresaId);
      cicloId = resultado.cicloId;
      expect(resultado.totalResponsables).toBe(1);
      // Ver nota sobre RESEND_API_KEY al inicio del archivo: no se afirma
      // un valor exacto de responsablesNotificados, solo que no revienta.
      expect(resultado.responsablesNotificados).toBeGreaterThanOrEqual(0);
    });

    it("no permite abrir un segundo ciclo mientras el primero sigue abierto", async () => {
      await expect(abrirCiclo(empresaId)).rejects.toThrow(YaHayCicloAbiertoError);
    });

    it("registra la respuesta del responsable para la conexión asignada, con la métrica de duración (RNF9)", async () => {
      const resultado = await registrarRespuestas({
        empresaId,
        cicloPulsoId: cicloId,
        responsableId,
        eslabonId: eslabonOrigenId,
        respuestas: [{ conexionId, valor: 4 }],
        duracionSegundos: 42,
      });
      expect(resultado.registradas).toBe(1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const verificacion = await prisma.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
        const respuesta = await tx.respuestaCruda.findUnique({
          where: {
            cicloPulsoId_conexionId_responsableId: { cicloPulsoId: cicloId, conexionId, responsableId },
          },
        });
        const metricas = await tx.metricaCuestionario.findMany({ where: { cicloPulsoId: cicloId } });
        return { respuesta, metricas };
      }, TX_OPTIONS);

      expect(verificacion.respuesta?.valor).toBe(4);
      expect(verificacion.metricas).toHaveLength(1);
      expect(verificacion.metricas[0].duracionSegundos).toBe(42);
    });

    it("responder por una conexión no asignada al eslabón del responsable lanza ConexionNoAsignadaError", async () => {
      await expect(
        registrarRespuestas({
          empresaId,
          cicloPulsoId: cicloId,
          responsableId,
          eslabonId: eslabonOrigenId,
          respuestas: [{ conexionId: randomUUID(), valor: 3 }],
        }),
      ).rejects.toThrow(ConexionNoAsignadaError);
    });

    it("cierra el ciclo y persiste ResultadoConexion/ResultadoCiclo con la conexión como eslabón más débil", async () => {
      const resultado = await cerrarCiclo(empresaId, cicloId);
      expect(resultado.eslabonesMasDebilesIds).toContain(conexionId);
      expect(resultado.coberturaRespuesta).toBe(100);

      const ciclo = await tenantClient(empresaId).cicloPulso.findUnique({ where: { id: cicloId } });
      expect(ciclo?.estado).toBe("CERRADO");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const resultadoConexion = await prisma.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
        return tx.resultadoConexion.findFirst({ where: { cicloPulsoId: cicloId, conexionId } });
      }, TX_OPTIONS);
      expect(resultadoConexion?.salud).not.toBeNull();
    });

    it("cerrar un ciclo ya cerrado lanza CicloNoAbiertoError", async () => {
      await expect(cerrarCiclo(empresaId, cicloId)).rejects.toThrow(CicloNoAbiertoErrorCerrar);
    });

    it("registrar respuestas en un ciclo ya cerrado lanza CicloNoAbiertoError", async () => {
      await expect(
        registrarRespuestas({
          empresaId,
          cicloPulsoId: cicloId,
          responsableId,
          eslabonId: eslabonOrigenId,
          respuestas: [{ conexionId, valor: 5 }],
        }),
      ).rejects.toThrow(CicloNoAbiertoErrorRespuestas);
    });
  });
});
