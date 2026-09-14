// Prueba de integracion — RNF1: aislamiento multi-tenant de punta a
// punta contra la base Neon real, con dos tenants sinteticos de forma
// realista (shape de las dos empresas piloto: usuario administrador,
// eslabones, una conexion completa, un ciclo cerrado con respuesta y
// resultados). Verifica las DOS capas independientes que exige
// ADR-0001 ("cinturon y tirantes"):
//   1. tenantClient() (src/infra/prisma/tenantClient.ts) -- filtro de
//      tenant a nivel de aplicacion.
//   2. RLS de Postgres (prisma/rls.sql) -- incluso si el codigo de
//      aplicacion "se olvida" del filtro, la base tiene que bloquear
//      igual el acceso cruzado entre tenants.
//
// Corre SOLO con `npm run test:integration` (vitest.integration.config.ts),
// nunca con `npm run test` -- necesita DATABASE_URL real y red hacia
// Neon, por eso queda fuera del ciclo normal de tsc/eslint/vitest en Mac
// (sin acceso de red ni .env -- ver ADR-0003) y se corre a mano en
// Windows, mismo criterio que `prisma generate`/`migrate`/`build`.
//
// Crea y borra sus propios dos tenants de prueba en cada corrida (ids
// unicos con randomUUID()) -- nunca toca las cuentas de prueba ya
// existentes (admin@chainpulse.test, etc.). El borrado tambien pasa por
// RLS (cubre todos los comandos, no solo SELECT) y se apoya en
// ON DELETE CASCADE del schema para limpiar todo lo demas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../client";
import { tenantClient } from "../tenantClient";
import { hashPassword } from "@/infra/auth/password";
import { RULE_VERSION } from "@/engine/constantes";

interface TenantFixture {
  empresaId: string;
  adminId: string;
  eslabonOrigenId: string;
  conexionId: string;
  cicloPulsoId: string;
  resultadoConexionId: string;
}

async function crearFixtureTenant(nombreEmpresa: string): Promise<TenantFixture> {
  const empresaId = randomUUID();
  // Contraseña de descarte -- estos usuarios de prueba nunca inician
  // sesion, solo existen para poblar las tablas y probar el aislamiento.
  const passwordHash = await hashPassword(`rnf1-${randomUUID()}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;

    // El id de la empresa se elige aca, no con el @default(cuid()) del
    // schema -- misma razon que registro.ts: la politica RLS de
    // "empresas" exige que app.tenant_id ya sea igual al id insertado.
    await tx.empresa.create({ data: { id: empresaId, nombre: nombreEmpresa } });

    const admin = await tx.usuario.create({
      data: {
        empresaId,
        email: `rnf1-admin-${randomUUID()}@chainpulse.test`,
        nombre: "Administradora de prueba (RNF1)",
        rol: "ADMINISTRADOR",
        passwordHash,
      },
    });

    const eslabonOrigen = await tx.eslabon.create({ data: { empresaId, nombre: "Compras (RNF1)" } });
    const eslabonDestino = await tx.eslabon.create({ data: { empresaId, nombre: "Produccion (RNF1)" } });

    const conexion = await tx.conexion.create({
      data: {
        empresaId,
        origenId: eslabonOrigen.id,
        destinoId: eslabonDestino.id,
        gradoDependencia: "ALTA",
        impactoPromesaCliente: "ALTO",
        tieneAlternativa: false,
        tiempoTolerable: "CORTO",
        tiempoRecuperacion: "MEDIO",
        completa: true,
      },
    });

    const ciclo = await tx.cicloPulso.create({
      data: { empresaId, estado: "CERRADO", cerradoEn: new Date(), coberturaRespuesta: 100 },
    });

    await tx.respuestaCruda.create({
      data: { cicloPulsoId: ciclo.id, conexionId: conexion.id, responsableId: admin.id, valor: 4 },
    });

    const resultadoConexion = await tx.resultadoConexion.create({
      data: {
        cicloPulsoId: ciclo.id,
        conexionId: conexion.id,
        salud: 75,
        criticidadSnapshot: {
          gradoDependencia: "ALTA",
          impactoPromesaCliente: "ALTO",
          tieneAlternativa: false,
          tiempoTolerable: "CORTO",
          tiempoRecuperacion: "MEDIO",
        },
        gradoDependenciaSnapshot: "ALTA",
        riesgo: 42,
        ruleVersion: RULE_VERSION,
      },
    });

    await tx.resultadoCiclo.create({
      data: {
        cicloPulsoId: ciclo.id,
        indiceIntegracion: 90,
        eslabonesMasDebilesIds: [conexion.id],
        ruleVersion: RULE_VERSION,
      },
    });

    return {
      empresaId,
      adminId: admin.id as string,
      eslabonOrigenId: eslabonOrigen.id as string,
      conexionId: conexion.id as string,
      cicloPulsoId: ciclo.id as string,
      resultadoConexionId: resultadoConexion.id as string,
    };
  });
}

async function borrarFixtureTenant(empresaId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.delete({ where: { id: empresaId } });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
async function bajoTenant(empresaId: string, fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    return fn(tx);
  });
}

// Misma forma que bajoTenant(), pero sin fijar ningun tenant -- para
// probar explicitamente el "falla cerrado" de RLS (sin
// current_setting('app.tenant_id'), ninguna fila coincide).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
async function sinTenantFijado(fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => fn(tx));
}

describe("RNF1 — aislamiento multi-tenant (integración contra Neon real)", () => {
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    [tenantA, tenantB] = await Promise.all([
      crearFixtureTenant("Empresa piloto A (prueba RNF1, borrar si queda huerfana)"),
      crearFixtureTenant("Empresa piloto B (prueba RNF1, borrar si queda huerfana)"),
    ]);
  }, 30000);

  afterAll(async () => {
    await Promise.all([borrarFixtureTenant(tenantA.empresaId), borrarFixtureTenant(tenantB.empresaId)]);
  }, 30000);

  describe("capa 1 — tenantClient() filtra a nivel de aplicación", () => {
    it("no devuelve un eslabón de otro tenant por id, aunque se pida explícito", async () => {
      const resultado = await tenantClient(tenantA.empresaId).eslabon.findUnique({
        where: { id: tenantB.eslabonOrigenId },
      });
      expect(resultado).toBeNull();
    });

    it("findMany de eslabones bajo el tenant A nunca incluye eslabones del tenant B", async () => {
      const eslabones = await tenantClient(tenantA.empresaId).eslabon.findMany();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = eslabones.map((e: any) => e.id as string);
      expect(ids).toContain(tenantA.eslabonOrigenId);
      expect(ids).not.toContain(tenantB.eslabonOrigenId);
    });

    it("findMany de usuarios bajo el tenant A nunca incluye el administrador del tenant B", async () => {
      const usuarios = await tenantClient(tenantA.empresaId).usuario.findMany();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = usuarios.map((u: any) => u.id as string);
      expect(ids).toContain(tenantA.adminId);
      expect(ids).not.toContain(tenantB.adminId);
    });

    it("findMany de ciclos bajo el tenant A nunca incluye el ciclo del tenant B", async () => {
      const ciclos = await tenantClient(tenantA.empresaId).cicloPulso.findMany();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = ciclos.map((c: any) => c.id as string);
      expect(ids).toContain(tenantA.cicloPulsoId);
      expect(ids).not.toContain(tenantB.cicloPulsoId);
    });
  });

  describe("capa 2 — RLS bloquea aunque el código de aplicación se olvide del filtro", () => {
    it("una consulta SIN filtro de tenant en el código igual queda acotada por RLS (eslabones)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const eslabones = await bajoTenant(tenantA.empresaId, (tx: any) => tx.eslabon.findMany());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = eslabones.map((e: any) => e.id as string);
      expect(ids).toContain(tenantA.eslabonOrigenId);
      expect(ids).not.toContain(tenantB.eslabonOrigenId);
    });

    it("pedir explícitamente el id de una conexión de otro tenant devuelve null bajo RLS", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const conexion = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.conexion.findUnique({ where: { id: tenantB.conexionId } }),
      );
      expect(conexion).toBeNull();
    });

    it("RespuestaCruda (sin empresaId propio) respeta el aislamiento vía la conexión padre", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const respuestas = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.respuestaCruda.findMany({ where: { conexionId: tenantB.conexionId } }),
      );
      expect(respuestas).toHaveLength(0);
    });

    it("ResultadoConexion (sin empresaId propio) respeta el aislamiento vía la conexión padre", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const resultado = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.resultadoConexion.findUnique({ where: { id: tenantB.resultadoConexionId } }),
      );
      expect(resultado).toBeNull();
    });

    it("ResultadoCiclo (sin empresaId propio) respeta el aislamiento vía el ciclo padre", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const resultado = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.resultadoCiclo.findUnique({ where: { cicloPulsoId: tenantB.cicloPulsoId } }),
      );
      expect(resultado).toBeNull();
    });

    it("sin ningún tenant fijado, RLS falla cerrado: no devuelve ninguna fila de ningún tenant", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const eslabones = await sinTenantFijado((tx: any) => tx.eslabon.findMany());
      expect(eslabones).toHaveLength(0);
    });
  });
});
