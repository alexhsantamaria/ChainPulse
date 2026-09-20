// Prueba de integracion — RNF1: aislamiento multi-tenant de punta a
// punta contra la base Neon real, con dos tenants sinteticos de forma
// realista (shape de las dos empresas piloto: usuario administrador,
// eslabones, una conexion completa, un ciclo cerrado con respuesta y
// resultados, y — desde el Incremento 3 — una Cadena con sus Nodos,
// ConexionCadena/Flujos y un HallazgoCadena). Verifica las DOS capas
// independientes que exige ADR-0001 ("cinturon y tirantes"):
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
import { crearCadenaCompleta } from "../../mapa/crearCadenaCompleta";

// Neon "duerme" la base cuando esta inactiva un rato -- la primera
// conexion de la corrida puede tardar bastante mas que el default de
// Prisma (maxWait 2000ms / timeout 5000ms), y esta prueba suele ser la
// primera consulta real del proceso. Mismo margen en las cuatro
// funciones de abajo que abren una transaccion.
const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

interface TenantFixture {
  empresaId: string;
  adminId: string;
  eslabonOrigenId: string;
  conexionId: string;
  cicloPulsoId: string;
  resultadoConexionId: string;
  // Incremento 3 (Mapa y profundidad) -- ver crearFixtureMapa() abajo.
  cadenaId: string;
  nodoOrigenId: string;
  nodoDestinoId: string;
  conexionCadenaId: string;
  hallazgoCadenaId: string;
}

async function crearFixtureTenant(nombreEmpresa: string): Promise<TenantFixture> {
  const empresaId = randomUUID();
  // Contraseña de descarte -- estos usuarios de prueba nunca inician
  // sesion, solo existen para poblar las tablas y probar el aislamiento.
  const passwordHash = await hashPassword(`rnf1-${randomUUID()}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  const base = await prisma.$transaction(async (tx: any) => {
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
  }, TX_OPTIONS);

  const mapa = await crearFixtureMapa(empresaId);

  return { ...base, ...mapa };
}

// Incremento 3 (Mapa y profundidad) -- poblado en una transaccion aparte
// (no anidada dentro de la de arriba: crearCadenaCompleta() abre la suya
// propia via tenantTransaction(), y Prisma no soporta transacciones
// interactivas anidadas). Dogfooding deliberado: usar la propia funcion
// que se quiere probar aislada, en vez de crear la Cadena/Nodo a mano,
// ejercita tambien su camino feliz como efecto colateral de este fixture.
async function crearFixtureMapa(empresaId: string) {
  const resultado = await crearCadenaCompleta(empresaId, {
    nombre: "Cadena de prueba (RNF1)",
    productoServicio: "Producto de prueba (RNF1)",
    periodoInicio: new Date("2026-01-01"),
    periodoFin: new Date("2026-03-31"),
    tipoOperacion: "manufactura",
    nodos: [
      { nombre: "Nodo origen (RNF1)", tipo: "AREA" },
      { nombre: "Nodo destino (RNF1)", tipo: "AREA" },
    ],
    conexiones: [{ origenIndex: 0, destinoIndex: 1, flujos: ["INFORMACION"] }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  const conexionCadena = await bajoTenant(empresaId, (tx: any) =>
    tx.conexionCadena.findFirstOrThrow({ where: { cadenaId: resultado.cadenaId } }),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  const hallazgoCadena = await bajoTenant(empresaId, (tx: any) =>
    tx.hallazgoCadena.create({
      data: {
        // A diferencia de crearCadenaCompleta() (tenantTransaction(), con
        // inyeccion automatica), este create pasa por el tx crudo de
        // bajoTenant() -- empresaId hay que pasarlo a mano, HallazgoCadena
        // SI tiene empresaId propio y esta en TENANT_SCOPED_MODELS.
        empresaId,
        cadenaId: resultado.cadenaId,
        dimension: "NODO_CRITICO",
        resultado: "DIFERENCIA",
      },
    }),
  );

  return {
    cadenaId: resultado.cadenaId,
    nodoOrigenId: resultado.nodoIds[0],
    nodoDestinoId: resultado.nodoIds[1],
    conexionCadenaId: conexionCadena.id as string,
    hallazgoCadenaId: hallazgoCadena.id as string,
  };
}

async function borrarFixtureTenant(empresaId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    // Hallazgo real de esta prueba (ver README, seccion RNF1):
    // RespuestaCruda.responsable (Usuario) no tiene onDelete: Cascade en
    // el schema -- Postgres bloquea (RESTRICT/NO ACTION) el cascade de
    // empresa -> usuario en cuanto intenta borrar un Usuario que todavia
    // tiene respuestas propias, aunque esas mismas respuestas tambien
    // vayan a borrarse por el otro camino (ciclo -> respuesta, que si
    // cascadea). Se borran a mano primero para no depender del orden en
    // que Postgres resuelve los dos caminos de cascade. RLS ya acota este
    // delete al tenant activo, sin necesidad de un where explicito.
    await tx.respuestaCruda.deleteMany({});
    // Mismo hallazgo, misma causa, tabla nueva del Incremento 3:
    // conexiones_cadena -> nodos es ON DELETE RESTRICT (migracion
    // 20260920040000), pero tanto "nodos" como "conexiones_cadena"
    // cascadean de forma independiente desde "empresas" (cada una tiene
    // su propio empresaId). Si Postgres intentara borrar nodos antes que
    // conexiones_cadena dentro del mismo cascade de "borrar Empresa", la
    // restriccion bloquearia el borrado -- se borra a mano primero, igual
    // que respuestaCruda arriba. flujos_conexion_cadena y
    // hallazgos_cadena no necesitan borrado manual: cascadean sin
    // RESTRICT de por medio (CASCADE y SET NULL respectivamente).
    await tx.conexionCadena.deleteMany({});
    await tx.empresa.delete({ where: { id: empresaId } });
  }, TX_OPTIONS);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo criterio que tenantTransaction.ts: tipos exactos pendientes de `prisma generate` con red real.
async function bajoTenant(empresaId: string, fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

// Misma forma que bajoTenant(), pero sin fijar ningun tenant -- para
// probar explicitamente el "falla cerrado" de RLS (sin
// current_setting('app.tenant_id'), ninguna fila coincide).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
async function sinTenantFijado(fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => fn(tx), TX_OPTIONS);
}

describe("RNF1 — aislamiento multi-tenant (integración contra Neon real)", () => {
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    // Secuencial, no Promise.all: Neon "duerme" la base cuando esta
    // inactiva, y pedir dos conexiones nuevas a la vez mientras todavia
    // esta despertando es lo que causaba "Unable to start a transaction
    // in the given time" (maxWait) la primera vez que corrio esta prueba.
    tenantA = await crearFixtureTenant("Empresa piloto A (prueba RNF1, borrar si queda huerfana)");
    tenantB = await crearFixtureTenant("Empresa piloto B (prueba RNF1, borrar si queda huerfana)");
  }, 60000);

  afterAll(async () => {
    // Defensivo: si beforeAll fallo a mitad de camino, no reventar el
    // afterAll tambien -- borrar solo lo que efectivamente se creo.
    if (tenantA?.empresaId) {
      await borrarFixtureTenant(tenantA.empresaId);
    }
    if (tenantB?.empresaId) {
      await borrarFixtureTenant(tenantB.empresaId);
    }
  }, 60000);

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

    it("findMany de Cadena bajo el tenant A nunca incluye la cadena del tenant B", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const cadenas = await (tenantClient(tenantA.empresaId) as any).cadena.findMany();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = cadenas.map((c: any) => c.id as string);
      expect(ids).toContain(tenantA.cadenaId);
      expect(ids).not.toContain(tenantB.cadenaId);
    });

    it("findMany de Nodo bajo el tenant A nunca incluye un nodo del tenant B", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const nodos = await (tenantClient(tenantA.empresaId) as any).nodo.findMany();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = nodos.map((n: any) => n.id as string);
      expect(ids).toContain(tenantA.nodoOrigenId);
      expect(ids).not.toContain(tenantB.nodoOrigenId);
    });

    it("findMany de ConexionCadena bajo el tenant A nunca incluye una conexión del tenant B", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const conexiones = await (tenantClient(tenantA.empresaId) as any).conexionCadena.findMany();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = conexiones.map((c: any) => c.id as string);
      expect(ids).toContain(tenantA.conexionCadenaId);
      expect(ids).not.toContain(tenantB.conexionCadenaId);
    });

    it("findMany de HallazgoCadena bajo el tenant A nunca incluye un hallazgo del tenant B", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const hallazgos = await (tenantClient(tenantA.empresaId) as any).hallazgoCadena.findMany();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const ids = hallazgos.map((h: any) => h.id as string);
      expect(ids).toContain(tenantA.hallazgoCadenaId);
      expect(ids).not.toContain(tenantB.hallazgoCadenaId);
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

    it("pedir explícitamente el id de un Nodo de otro tenant devuelve null bajo RLS", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const nodo = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.nodo.findUnique({ where: { id: tenantB.nodoOrigenId } }),
      );
      expect(nodo).toBeNull();
    });

    it("pedir explícitamente el id de una ConexionCadena de otro tenant devuelve null bajo RLS", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const conexionCadena = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.conexionCadena.findUnique({ where: { id: tenantB.conexionCadenaId } }),
      );
      expect(conexionCadena).toBeNull();
    });

    it("FlujoConexionCadena (sin empresaId propio) respeta el aislamiento vía la ConexionCadena padre", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const flujos = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.flujoConexionCadena.findMany({ where: { conexionCadenaId: tenantB.conexionCadenaId } }),
      );
      expect(flujos).toHaveLength(0);
    });

    it("HallazgoCadena de otro tenant no es visible bajo RLS", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const hallazgo = await bajoTenant(tenantA.empresaId, (tx: any) =>
        tx.hallazgoCadena.findUnique({ where: { id: tenantB.hallazgoCadenaId } }),
      );
      expect(hallazgo).toBeNull();
    });

    it("sin ningún tenant fijado, RLS falla cerrado: no devuelve ninguna fila de ningún tenant", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const eslabones = await sinTenantFijado((tx: any) => tx.eslabon.findMany());
      expect(eslabones).toHaveLength(0);
    });
  });
});
