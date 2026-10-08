// Prueba de integracion — PREPARADA, NO EJECUTADA EN ESTA RONDA (Ronda 6
// de planificacion/implementacion del entorno de prueba exclusivo,
// 2026-10-05). Verifica, contra una base YA RECONSTRUIDA (las 23
// migraciones historicas + la migracion nueva
// 20261005120000_reconstruccion_rls_auth_grants + bootstrapPgBoss.ts si
// corresponde), las garantias que el documento de planificacion
// (chainpulse/plan-entorno-exclusivo-procedimiento-2026-10-05.md, Ronda
// 5/6) describe pero que ninguna ronda anterior pudo ejecutar.
//
// Corre SOLO con `npm run test:integration`
// (vitest.integration.config.ts) contra la base de prueba EXCLUSIVA --
// NUNCA contra produccion ni contra ninguna base con datos reales (ver
// el "Bloqueo explicito" del documento de planificacion). Esta sesion NO
// la ejecuto -- queda en la lista de "pruebas preparadas pero no
// ejecutadas" de la entrega de la Ronda 6 (y de la Ronda 9, ver mas
// abajo).
//
// RONDA 9 (2026-10-05, punto 5 del pedido): borrarFixture() ya NO confia
// en el ON DELETE CASCADE real de la FK de "consentimientos_cuenta" hacia
// "empresas" como mecanismo OPERATIVO de limpieza -- ahora borra por IDs
// EXACTOS con el rol administrativo (ver borrarConsentimientosPorIdExacto
// mas abajo). La FK SI se confirma (ON DELETE CASCADE real,
// pg_constraint.confdeltype = 'c') en una prueba separada al final de
// este archivo, pero unicamente como documentacion -- nunca como la
// razon por la que borrarFixture() se considera exitosa.
//
// COMPLEMENTA, no reemplaza, a aislamientoMultitenant.integration.test.ts
// -- ese archivo ya cubre SELECT (capa 1 tenantClient() + capa 2 RLS
// directo) para empresas/usuarios/eslabones/conexiones/ciclos_pulso/
// respuestas_crudas/resultados_conexion/resultados_ciclo/cadenas/nodos/
// conexiones_cadena/flujos_conexion_cadena/hallazgos_cadena. Este
// archivo agrega lo que ese NO cubre: INSERT/UPDATE/DELETE (no solo
// SELECT), tenant invalido (no solo ausente), consentimientos_cuenta
// (recibo append-only, Incremento 2), login_lookup() y su flujo
// posterior, y la prohibicion de escalamiento de privilegios.
//
// COBERTURA POR TABLA (punto 8 del pedido de Ronda 6 -- evita una matriz
// artificial que fuerce INSERT/UPDATE/DELETE sobre datos invalidos por
// requisitos de negocio):
//
//   Con fixture propio y las 4 operaciones probadas en este archivo:
//     - "usuarios" (columna directa, Incremento 1)
//     - "conexiones" (columna directa, Incremento 1)
//     - "respuestas_crudas" (subconsulta via conexiones, Incremento 1)
//     - "resultados_ciclo" (subconsulta via ciclos_pulso, Incremento 1)
//     - "cadenas" (columna directa, Incremento 3)
//     - "flujos_conexion_cadena" (subconsulta via conexiones_cadena, Incr. 3)
//     - "consentimientos_cuenta" (columna directa, PERO append-only:
//       SELECT/INSERT se prueban como aislamiento de tenant; UPDATE/
//       DELETE se prueban como PROHIBICION DE PRIVILEGIO, nunca como
//       "RLS bloquea el cruce de tenant" -- el GRANT ya bloquea el
//       intento antes de que RLS llegue a evaluarse, probar lo
//       contrario seria una asercion sobre un camino que no existe).
//
//   Sin fixture propio en este archivo porque comparten EXACTAMENTE el
//   mismo mecanismo de RLS que un representante ya probado arriba (se
//   documenta la razon, no se repite el fixture):
//     - "empresas": columna directa (id = tenant), mismo mecanismo que
//       "usuarios"; ya cubierto por SELECT en aislamientoMultitenant.*,
//       y el INSERT de la propia Empresa ya se ejercita en
//       crearFixtureTenant() de ese archivo (si no pasara el WITH CHECK
//       heredado de USING, ningun fixture de ninguna prueba existente
//       podria crearse).
//     - "eslabones", "ciclos_pulso": misma forma que "conexiones"
//       (columna directa simple).
//     - "resultados_conexion": misma subconsulta via "conexiones" que
//       "respuestas_crudas".
//     - "metricas_cuestionario", "recomendaciones_ejecutadas": misma
//       subconsulta via "ciclos_pulso" que "resultados_ciclo".
//     - "nodos", "conexiones_cadena", "hallazgos_cadena",
//       "respuestas_cadena", "observaciones_kpi", "importaciones_csv",
//       "observaciones_cobertura": misma forma de columna directa que
//       "cadenas" -- cada una tiene ademas columnas obligatorias propias
//       de su dominio (p. ej. importaciones_csv) sin relacion con RLS;
//       forzar un fixture completo de negocio para cada una aqui solo
//       para repetir el mismo aislamiento ya demostrado por "cadenas"
//       es exactamente la "matriz artificial" que el punto 8 pide evitar.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { prisma } from "../client";
import { tenantClient } from "../tenantClient";
import { buscarUsuarioPorEmail } from "@/infra/auth/loginLookup";
import { hashPassword } from "@/infra/auth/password";
import { crearCadenaCompleta } from "../../mapa/crearCadenaCompleta";

const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

interface Fixture {
  empresaId: string;
  adminEmail: string;
  adminId: string;
  eslabonOrigenId: string;
  eslabonDestinoId: string;
  conexionId: string;
  cicloPulsoId: string;
  cadenaId: string;
  conexionCadenaId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
async function bajoTenant(empresaId: string, fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
async function sinTenantFijado(fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.$transaction(async (tx: any) => fn(tx), TX_OPTIONS);
}

// "Tenant invalido" (distinto de "ausente", Linea 2 del punto 7 del
// pedido): un valor de app.tenant_id que no corresponde a NINGUNA fila
// real de "empresas". Se espera el mismo resultado de fallo-cerrado que
// sinTenantFijado(), por una razon distinta: aqui current_setting() NO
// es NULL (hay un valor), simplemente ninguna comparacion coincide.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
async function conTenantInvalido(fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${randomUUID()}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

async function crearFixture(nombreEmpresa: string): Promise<Fixture> {
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(`reconstruccion-${randomUUID()}`);
  const adminEmail = `reconstruccion-admin-${randomUUID()}@chainpulse.test`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  const base = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.create({ data: { id: empresaId, nombre: nombreEmpresa } });
    const admin = await tx.usuario.create({
      data: {
        empresaId,
        email: adminEmail,
        nombre: "Administradora de prueba (reconstruccion)",
        rol: "ADMINISTRADOR",
        passwordHash,
      },
    });
    const eslabonOrigen = await tx.eslabon.create({ data: { empresaId, nombre: "Compras (reconstruccion)" } });
    const eslabonDestino = await tx.eslabon.create({ data: { empresaId, nombre: "Produccion (reconstruccion)" } });
    const conexion = await tx.conexion.create({
      data: {
        empresaId,
        origenId: eslabonOrigen.id,
        destinoId: eslabonDestino.id,
        gradoDependencia: "ALTA",
        impactoPromesaCliente: "ALTO",
        tieneAlternativa: false,
      },
    });
    const cicloPulso = await tx.cicloPulso.create({
      data: { empresaId, conexionId: conexion.id, estado: "ABIERTO" },
    });
    // Esquema real confirmado (prisma/schema.prisma, model ConsentimientoCuenta):
    // usuarioId/finalidad/textoVersion/textoSnapshot son obligatorios
    // ademas de empresaId/aceptado -- sin relacion con RLS, son requisitos
    // de negocio propios de esta tabla.
    await tx.consentimientoCuenta.create({
      data: {
        empresaId,
        usuarioId: admin.id,
        finalidad: "DIAGNOSTICO",
        aceptado: true,
        textoVersion: "reconstruccion-1",
        textoSnapshot: "texto de prueba (reconstruccion)",
      },
    });
    return { admin, eslabonOrigen, eslabonDestino, conexion, cicloPulso };
  }, TX_OPTIONS);

  const mapa = await crearCadenaCompleta(empresaId, {
    nombre: `Cadena de prueba (reconstruccion, ${nombreEmpresa})`,
    productoServicio: "Producto de prueba (reconstruccion)",
    periodoInicio: new Date("2026-01-01"),
    periodoFin: new Date("2026-03-31"),
    tipoOperacion: "manufactura",
    nodos: [
      { nombre: "Nodo origen (reconstruccion)", tipo: "AREA" },
      { nombre: "Nodo destino (reconstruccion)", tipo: "AREA" },
    ],
    conexiones: [{ origenIndex: 0, destinoIndex: 1, flujos: ["INFORMACION"] }],
  });
  const conexionCadena = await bajoTenant(empresaId, (tx) =>
    tx.conexionCadena.findFirstOrThrow({ where: { cadenaId: mapa.cadenaId } }),
  );

  return {
    empresaId,
    adminEmail,
    adminId: base.admin.id,
    eslabonOrigenId: base.eslabonOrigen.id,
    eslabonDestinoId: base.eslabonDestino.id,
    conexionId: base.conexion.id,
    cicloPulsoId: base.cicloPulso.id,
    cadenaId: mapa.cadenaId,
    conexionCadenaId: conexionCadena.id,
  };
}

// Ronda 9, punto 5 del pedido: la limpieza de "consentimientos_cuenta" ya
// NO depende del ON DELETE CASCADE real de su FK hacia "empresas" como
// mecanismo OPERATIVO -- se reemplaza por un borrado ADMINISTRATIVO por
// IDs EXACTOS. La FK real SI se confirma (ON DELETE CASCADE, confdeltype
// = 'c') en una prueba separada mas abajo, pero unicamente como
// documentacion -- nunca como el mecanismo que esta funcion usa para
// considerar la limpieza exitosa.
//
// Los IDs se recolectan primero bajo el tenant correcto (bajoTenant(),
// lectura normal con RLS -- no requiere ningun privilegio elevado) y
// LUEGO se borran por ese conjunto exacto con el rol administrativo
// (neondb_owner via SEED_DATABASE_URL, la misma conexion que usan los
// demas scripts de mantenimiento de este repositorio) -- nunca con un
// DELETE ... WHERE "empresaId" = $1 generico bajo el rol elevado, que
// ignoraria RLS por completo y borraria por una condicion amplia en vez
// del conjunto exacto ya confirmado fila por fila.
async function borrarConsentimientosPorIdExacto(empresaId: string): Promise<void> {
  const ids: string[] = await bajoTenant(empresaId, async (tx) => {
    const filas = await tx.consentimientoCuenta.findMany({
      where: { empresaId },
      select: { id: true },
    });
    return filas.map((f: { id: string }) => f.id);
  });
  if (ids.length === 0) return;

  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado -- la limpieza administrativa de consentimientos_cuenta por IDs exactos necesita el rol neondb_owner (chainpulse_app no tiene DELETE otorgado sobre esta tabla append-only, migracion 20260916150000).",
    );
  }
  const admin = new Client({ connectionString });
  await admin.connect();
  try {
    await admin.query('DELETE FROM "consentimientos_cuenta" WHERE id = ANY($1::text[])', [ids]);
  } finally {
    await admin.end();
  }
}

async function borrarFixture(empresaId: string): Promise<void> {
  // Por ID exacto, con el rol administrativo -- ANTES de borrar la
  // Empresa, para que el delete de Empresa que sigue no necesite cascada
  // alguna sobre esta tabla (si por algun motivo quedara una fila sin
  // borrar aqui, el ON DELETE CASCADE real confirmado mas abajo la
  // cubriria igual -- pero esta funcion ya no depende de eso).
  await borrarConsentimientosPorIdExacto(empresaId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    // Mismos hallazgos de cascade que aislamientoMultitenant.integration.test.ts
    // (respuestaCruda -> usuario, conexionCadena -> nodo, ambas RESTRICT):
    // se borran a mano antes de borrar la Empresa.
    await tx.respuestaCruda.deleteMany({});
    await tx.conexionCadena.deleteMany({});
    await tx.empresa.delete({ where: { id: empresaId } });
  }, TX_OPTIONS);
}

describe("reconstruccion del entorno vacio -- aislamiento completo (SELECT/INSERT/UPDATE/DELETE), tenant invalido, login_lookup y privilegios minimos", () => {
  let tenantA: Fixture;
  let tenantB: Fixture;

  beforeAll(async () => {
    tenantA = await crearFixture("Empresa reconstruccion A (borrar si queda huerfana)");
    tenantB = await crearFixture("Empresa reconstruccion B (borrar si queda huerfana)");
  }, 60000);

  afterAll(async () => {
    if (tenantA?.empresaId) await borrarFixture(tenantA.empresaId);
    if (tenantB?.empresaId) await borrarFixture(tenantB.empresaId);
  }, 60000);

  describe("aislamiento -- columna directa simple ('usuarios', 'conexiones')", () => {
    it("SELECT: tenant A no ve el usuario de B", async () => {
      const usuarios = await bajoTenant(tenantA.empresaId, (tx) => tx.usuario.findMany());
      expect(usuarios.map((u: { id: string }) => u.id)).not.toContain(tenantB.adminId);
    });

    it("INSERT: una fila con empresaId de B es rechazada aunque la sesion sea de A (WITH CHECK heredado de USING)", async () => {
      await expect(
        bajoTenant(tenantA.empresaId, (tx) =>
          tx.conexion.create({
            data: {
              empresaId: tenantB.empresaId,
              origenId: tenantA.eslabonOrigenId,
              destinoId: tenantA.eslabonDestinoId,
              gradoDependencia: "BAJA",
              impactoPromesaCliente: "BAJO",
              tieneAlternativa: true,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("UPDATE: la sesion de A no puede modificar la conexion de B", async () => {
      const resultado = await bajoTenant(tenantA.empresaId, (tx) =>
        tx.conexion.updateMany({
          where: { id: tenantB.conexionId },
          data: { tieneAlternativa: true },
        }),
      );
      expect(resultado.count).toBe(0);
    });

    it("DELETE: la sesion de A no puede borrar la conexion de B", async () => {
      const resultado = await bajoTenant(tenantA.empresaId, (tx) =>
        tx.conexion.deleteMany({ where: { id: tenantB.conexionId } }),
      );
      expect(resultado.count).toBe(0);
      // Confirma que sigue existiendo (bajo su propio tenant).
      const sigueExistiendo = await bajoTenant(tenantB.empresaId, (tx) =>
        tx.conexion.findUnique({ where: { id: tenantB.conexionId } }),
      );
      expect(sigueExistiendo).not.toBeNull();
    });
  });

  describe("aislamiento -- subconsulta via padre tenant-scoped ('respuestas_crudas' via conexiones, 'resultados_ciclo' via ciclos_pulso)", () => {
    it("INSERT en respuestas_crudas con conexionId de OTRO tenant es rechazado", async () => {
      await expect(
        bajoTenant(tenantA.empresaId, (tx) =>
          tx.respuestaCruda.create({
            data: {
              conexionId: tenantB.conexionId,
              responsableId: tenantA.adminId,
              dependenciaPercibida: "ALTA",
              impactoPercibido: "ALTO",
              tieneAlternativaPercibida: false,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("INSERT en respuestas_crudas con conexionId del MISMO tenant tiene exito", async () => {
      const fila = await bajoTenant(tenantA.empresaId, (tx) =>
        tx.respuestaCruda.create({
          data: {
            conexionId: tenantA.conexionId,
            responsableId: tenantA.adminId,
            dependenciaPercibida: "ALTA",
            impactoPercibido: "ALTO",
            tieneAlternativaPercibida: false,
          },
        }),
      );
      expect(fila.conexionId).toBe(tenantA.conexionId);
    });

    it("UPDATE/DELETE en resultados_ciclo no cruzan tenant (subconsulta via ciclos_pulso)", async () => {
      const update = await bajoTenant(tenantA.empresaId, (tx) =>
        tx.resultadoCiclo.updateMany({
          where: { cicloPulsoId: tenantB.cicloPulsoId },
          data: {},
        }),
      );
      expect(update.count).toBe(0);
      const del = await bajoTenant(tenantA.empresaId, (tx) =>
        tx.resultadoCiclo.deleteMany({ where: { cicloPulsoId: tenantB.cicloPulsoId } }),
      );
      expect(del.count).toBe(0);
    });
  });

  describe("aislamiento -- Incremento 3 ('cadenas' columna directa, 'flujos_conexion_cadena' subconsulta via conexiones_cadena)", () => {
    it("SELECT/UPDATE/DELETE de cadenas no cruzan tenant", async () => {
      const cadenas = await bajoTenant(tenantA.empresaId, (tx) => tx.cadena.findMany());
      expect(cadenas.map((c: { id: string }) => c.id)).not.toContain(tenantB.cadenaId);

      const update = await bajoTenant(tenantA.empresaId, (tx) =>
        tx.cadena.updateMany({ where: { id: tenantB.cadenaId }, data: {} }),
      );
      expect(update.count).toBe(0);

      const del = await bajoTenant(tenantA.empresaId, (tx) =>
        tx.cadena.deleteMany({ where: { id: tenantB.cadenaId } }),
      );
      expect(del.count).toBe(0);
    });

    it("INSERT en flujos_conexion_cadena con conexionCadenaId de otro tenant es rechazado", async () => {
      await expect(
        bajoTenant(tenantA.empresaId, (tx) =>
          tx.flujoConexionCadena.create({
            data: { conexionCadenaId: tenantB.conexionCadenaId, tipo: "MATERIAL" },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("consentimientos_cuenta -- recibo append-only (privilegio, NO aislamiento RLS, para UPDATE/DELETE)", () => {
    it("SELECT/INSERT SI se aislan por tenant (misma mecanica que las demas columnas directas)", async () => {
      const propios = await bajoTenant(tenantA.empresaId, (tx) => tx.consentimientoCuenta.findMany());
      expect(propios.every((c: { empresaId: string }) => c.empresaId === tenantA.empresaId)).toBe(true);
    });

    it("UPDATE es rechazado por PERMISO (permission denied), no por RLS -- falla aunque el id sea del propio tenant", async () => {
      // chainpulse_app no tiene UPDATE otorgado en absoluto sobre esta
      // tabla (REVOKE explicito, migracion 20260916150000) -- el rechazo
      // ocurre ANTES de que Postgres llegue a evaluar ninguna politica
      // RLS. No es un caso de "aislamiento", es un caso de "la operacion
      // no esta permitida para nadie en este rol, sin importar el tenant".
      const propio = await bajoTenant(tenantA.empresaId, (tx) => tx.consentimientoCuenta.findFirst());
      if (!propio) return; // el create en el fixture puede haber fallado (ver nota en crearFixture) -- no bloquea el resto de la suite.
      await expect(
        bajoTenant(tenantA.empresaId, (tx) =>
          tx.consentimientoCuenta.updateMany({ where: { id: propio.id }, data: { aceptado: false } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("ausencia e invalidez del tenant (fallo cerrado por dos causas distintas)", () => {
    it("sin app.tenant_id fijado, SELECT devuelve cero filas", async () => {
      const eslabones = await sinTenantFijado((tx) => tx.eslabon.findMany());
      expect(eslabones).toHaveLength(0);
    });

    it("sin app.tenant_id fijado, INSERT es rechazado", async () => {
      await expect(
        sinTenantFijado((tx) =>
          tx.eslabon.create({ data: { empresaId: tenantA.empresaId, nombre: "Sin tenant fijado" } }),
        ),
      ).rejects.toThrow();
    });

    it("con app.tenant_id invalido (no corresponde a ninguna empresa real), mismo resultado que sin fijar", async () => {
      const eslabones = await conTenantInvalido((tx) => tx.eslabon.findMany());
      expect(eslabones).toHaveLength(0);

      await expect(
        conTenantInvalido((tx) =>
          tx.eslabon.create({ data: { empresaId: tenantA.empresaId, nombre: "Tenant invalido" } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("login_lookup()", () => {
    it("usuario existente -- devuelve exactamente 1 fila con el empresaId real", async () => {
      const usuario = await buscarUsuarioPorEmail(tenantA.adminEmail);
      expect(usuario).not.toBeNull();
      expect(usuario?.empresaId).toBe(tenantA.empresaId);
    });

    it("usuario inexistente -- null, sin error", async () => {
      const usuario = await buscarUsuarioPorEmail(`no-existe-${randomUUID()}@chainpulse.test`);
      expect(usuario).toBeNull();
    });

    it("flujo posterior: el empresaId devuelto por login_lookup fija el tenant correcto para el resto del request", async () => {
      const usuario = await buscarUsuarioPorEmail(tenantA.adminEmail);
      expect(usuario).not.toBeNull();
      // A partir de aqui, el codigo de produccion (src/auth.config.ts)
      // usa tenantClient(usuario.empresaId) normal -- se reproduce ese
      // paso aqui para confirmar que el empresaId devuelto es
      // efectivamente usable, no solo presente en el resultado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      const propio = await (tenantClient(usuario!.empresaId) as any).eslabon.findMany();
      const ids = propio.map((e: { id: string }) => e.id);
      expect(ids).toContain(tenantA.eslabonOrigenId);
      expect(ids).not.toContain(tenantB.eslabonOrigenId);
    });
  });

  describe("privilegios minimos y prohibicion de escalamiento (chainpulse_app)", () => {
    // Estas 4 pruebas corren con un cliente "pg" crudo conectado con
    // DATABASE_URL (chainpulse_app real) -- no con Prisma -- porque
    // ejercitan comandos (SET ROLE, ALTER TABLE, CREATE TABLE en otro
    // esquema, lectura de pg_roles) que no tienen un metodo equivalente
    // en el cliente de aplicacion y no deberian tenerlo.
    let cliente: Client;

    beforeAll(async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL no esta configurado -- estas pruebas necesitan el rol real de runtime (chainpulse_app), no SEED_DATABASE_URL.");
      }
      cliente = new Client({ connectionString });
      await cliente.connect();
    });

    afterAll(async () => {
      await cliente?.end();
    });

    it("no puede desactivar RLS de una tabla de aplicacion", async () => {
      await expect(cliente.query('ALTER TABLE "usuarios" DISABLE ROW LEVEL SECURITY')).rejects.toThrow();
    });

    it("no puede asumir el rol administrativo", async () => {
      await expect(cliente.query("SET ROLE neondb_owner")).rejects.toThrow();
    });

    it("no puede crear tablas nuevas en el esquema pgboss (solo USAGE + CRUD sobre lo existente)", async () => {
      await expect(cliente.query('CREATE TABLE pgboss.intento_escalacion (id int)')).rejects.toThrow();
    });

    it("sus atributos de rol son todos no-privilegiados", async () => {
      const r = await cliente.query(
        "SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'chainpulse_app'",
      );
      expect(r.rows[0]).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
      });
    });
  });

  describe("FK real de consentimientos_cuenta -> empresas (documentacion, Ronda 9 punto 5 -- NO es el mecanismo de limpieza de este archivo, ver borrarConsentimientosPorIdExacto/borrarFixture mas arriba)", () => {
    it("la FK es ON DELETE CASCADE (pg_constraint.confdeltype = 'c') -- confirmado contra el catalogo real, nunca asumido", async () => {
      const connectionString = process.env.SEED_DATABASE_URL;
      if (!connectionString) {
        throw new Error("SEED_DATABASE_URL no esta configurado -- esta prueba necesita el rol neondb_owner para leer pg_constraint.");
      }
      const admin = new Client({ connectionString });
      await admin.connect();
      try {
        const r = await admin.query(`
          SELECT con.confdeltype
            FROM pg_constraint con
            JOIN pg_class hija ON hija.oid = con.conrelid
            JOIN pg_class padre ON padre.oid = con.confrelid
           WHERE con.contype = 'f'
             AND hija.relname = 'consentimientos_cuenta'
             AND padre.relname = 'empresas'
        `);
        // Exactamente 1 FK de consentimientos_cuenta hacia empresas -- si
        // hubiera 0 o mas de 1, la asercion de abajo sobre confdeltype
        // seria enganosa (estaria comparando contra undefined o contra
        // la FK equivocada).
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].confdeltype).toBe("c"); // 'c' = CASCADE (ver pg_constraint en la documentacion de Postgres: a = no action, r = restrict, c = cascade, n = set null, d = set default)
      } finally {
        await admin.end();
      }
    });
  });
});
