// Prueba de integracion — Incremento 3 Bloque B (RF29/RF34): valida
// agregarConexionCadenaAtomico() (src/infra/mapa/agregarConexionCadena.ts)
// contra Neon real. Mismo motivo que crearCadenaCompleta.integration.test.ts
// para no vivir en un *.test.ts unitario: este modulo importa
// tenantTransaction.ts -> client.ts, que ya explota al cargar en la Mac
// sin "prisma generate" con red real. Corre SOLO con
// `npm run test:integration`, nunca con `npm run test`.
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma/client";
import { tenantClient } from "../../prisma/tenantClient";
import { crearCadenaCompleta } from "../crearCadenaCompleta";
import {
  agregarConexionCadenaAtomico,
  ConexionCadenaAutoReferenciaError,
  ConexionCadenaDuplicadaError,
  ConexionCadenaNodoInvalidoError,
  ConexionCadenaSinFlujosError,
} from "../agregarConexionCadena";

const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

// FlujoConexionCadena NO esta en TENANT_SCOPED_MODELS -- se consulta bajo
// un set_config manual, mismo patron que crearCadenaCompleta.integration.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
async function bajoTenant(empresaId: string, fn: (tx: any) => Promise<any>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

async function crearEmpresaDePrueba(): Promise<string> {
  const empresaId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.create({
      data: { id: empresaId, nombre: "Empresa de prueba (agregarConexionCadena, borrar si queda huerfana)" },
    });
  }, TX_OPTIONS);
  return empresaId;
}

async function borrarEmpresaDePrueba(empresaId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    // conexiones_cadena -> nodos es ON DELETE RESTRICT, borrar a mano
    // antes de la empresa, mismo hallazgo ya documentado en los otros dos
    // tests de integracion de este proyecto.
    await tx.conexionCadena.deleteMany({});
    await tx.empresa.delete({ where: { id: empresaId } });
  }, TX_OPTIONS);
}

// Crea una Cadena con dos Nodos y SIN conexiones -- el punto de partida
// que estas pruebas necesitan (agregarConexionCadenaAtomico() agrega una
// conexion a una Cadena que ya existe, nunca crea la Cadena en si).
//
// nodoIds se devuelve como tupla fija (no string[]) para que indexar
// nodoIds[0]/nodoIds[1] en cada test de a continuacion sea `string`, no
// `string | undefined` bajo noUncheckedIndexedAccess -- mismo hallazgo ya
// documentado en claude/lecciones-aprendidas.md ("cache tsconfig.tsbuildinfo
// desactualizada", que en su momento tapo este mismo tipo de error en
// aislamientoMultitenant.integration.test.ts).
async function crearCadenaConDosNodos(empresaId: string): Promise<{ cadenaId: string; nodoIds: [string, string] }> {
  const resultado = await crearCadenaCompleta(empresaId, {
    nombre: "Cadena de prueba (agregarConexionCadena)",
    productoServicio: "Producto de prueba",
    periodoInicio: new Date("2026-01-01"),
    periodoFin: new Date("2026-03-31"),
    tipoOperacion: "manufactura",
    nodos: [
      { nombre: "Origen", tipo: "AREA" },
      { nombre: "Destino", tipo: "AREA" },
    ],
    conexiones: [],
  });
  const [nodoOrigenId, nodoDestinoId] = resultado.nodoIds;
  if (!nodoOrigenId || !nodoDestinoId) {
    throw new Error("crearCadenaConDosNodos: crearCadenaCompleta() no devolvio los 2 nodoIds esperados");
  }
  return { cadenaId: resultado.cadenaId, nodoIds: [nodoOrigenId, nodoDestinoId] };
}

describe("agregarConexionCadenaAtomico (integración contra Neon real)", () => {
  const empresasCreadas: string[] = [];

  afterEach(async () => {
    while (empresasCreadas.length > 0) {
      const empresaId = empresasCreadas.pop();
      if (empresaId) {
        await borrarEmpresaDePrueba(empresaId);
      }
    }
  }, 60000);

  it("agrega la ConexionCadena y sus Flujos a una Cadena ya existente", async () => {
    const empresaId = await crearEmpresaDePrueba();
    empresasCreadas.push(empresaId);
    const { cadenaId, nodoIds } = await crearCadenaConDosNodos(empresaId);

    const resultado = await agregarConexionCadenaAtomico(empresaId, {
      cadenaId,
      origenNodoId: nodoIds[0],
      destinoNodoId: nodoIds[1],
      flujos: ["INFORMACION", "DINERO"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    const cliente = tenantClient(empresaId) as any;
    const conexion = await cliente.conexionCadena.findUniqueOrThrow({
      where: { id: resultado.conexionCadenaId },
    });
    expect(conexion.empresaId).toBe(empresaId);
    expect(conexion.cadenaId).toBe(cadenaId);
    expect(conexion.origenNodoId).toBe(nodoIds[0]);
    expect(conexion.destinoNodoId).toBe(nodoIds[1]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    const flujos = await bajoTenant(empresaId, (tx: any) =>
      tx.flujoConexionCadena.findMany({ where: { conexionCadenaId: conexion.id } }),
    );
    expect(flujos).toHaveLength(2);
  }, 30000);

  it("rechaza un nodo que pertenece a otra Cadena, sin crear nada", async () => {
    const empresaId = await crearEmpresaDePrueba();
    empresasCreadas.push(empresaId);
    const { cadenaId, nodoIds } = await crearCadenaConDosNodos(empresaId);
    const otraCadena = await crearCadenaConDosNodos(empresaId);

    await expect(
      agregarConexionCadenaAtomico(empresaId, {
        cadenaId,
        origenNodoId: nodoIds[0],
        // Nodo real, pero de "otraCadena" -- no de "cadenaId".
        destinoNodoId: otraCadena.nodoIds[0],
        flujos: ["INFORMACION"],
      }),
    ).rejects.toBeInstanceOf(ConexionCadenaNodoInvalidoError);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    const cliente = tenantClient(empresaId) as any;
    expect(await cliente.conexionCadena.findMany({ where: { cadenaId } })).toHaveLength(0);
  }, 30000);

  it("rechaza una segunda conexion entre el mismo par de nodos (P2002) sin dejar flujos huerfanos", async () => {
    const empresaId = await crearEmpresaDePrueba();
    empresasCreadas.push(empresaId);
    const { cadenaId, nodoIds } = await crearCadenaConDosNodos(empresaId);

    await agregarConexionCadenaAtomico(empresaId, {
      cadenaId,
      origenNodoId: nodoIds[0],
      destinoNodoId: nodoIds[1],
      flujos: ["INFORMACION"],
    });

    await expect(
      agregarConexionCadenaAtomico(empresaId, {
        cadenaId,
        origenNodoId: nodoIds[0],
        destinoNodoId: nodoIds[1],
        flujos: ["DINERO"],
      }),
    ).rejects.toBeInstanceOf(ConexionCadenaDuplicadaError);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    const cliente = tenantClient(empresaId) as any;
    expect(await cliente.conexionCadena.findMany({ where: { cadenaId } })).toHaveLength(1);
  }, 30000);

  it("rechaza una conexion que referencia el mismo nodo como origen y destino", async () => {
    const empresaId = await crearEmpresaDePrueba();
    empresasCreadas.push(empresaId);
    const { cadenaId, nodoIds } = await crearCadenaConDosNodos(empresaId);

    await expect(
      agregarConexionCadenaAtomico(empresaId, {
        cadenaId,
        origenNodoId: nodoIds[0],
        destinoNodoId: nodoIds[0],
        flujos: ["INFORMACION"],
      }),
    ).rejects.toBeInstanceOf(ConexionCadenaAutoReferenciaError);
  });

  it("rechaza una conexion sin ningun flujo declarado", async () => {
    const empresaId = await crearEmpresaDePrueba();
    empresasCreadas.push(empresaId);
    const { cadenaId, nodoIds } = await crearCadenaConDosNodos(empresaId);

    await expect(
      agregarConexionCadenaAtomico(empresaId, {
        cadenaId,
        origenNodoId: nodoIds[0],
        destinoNodoId: nodoIds[1],
        flujos: [],
      }),
    ).rejects.toBeInstanceOf(ConexionCadenaSinFlujosError);
  });
});
