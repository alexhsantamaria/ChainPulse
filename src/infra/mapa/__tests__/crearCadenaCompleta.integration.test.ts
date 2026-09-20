// Prueba de integracion — Incremento 3 Bloque A (RF27-RF29): valida
// crearCadenaCompleta() (src/infra/mapa/crearCadenaCompleta.ts) contra
// Neon real. Dos cosas que NO se pueden probar sin una base real:
//
//   1. Atomicidad -- que un fallo a mitad de la transaccion (P2002 por
//      conexion duplicada) no deje una Cadena ni Nodos huerfanos en la
//      base (el "todo o nada" que motiva usar tenantTransaction() en vez
//      de tenantClient(), ver el comentario de cabecera del propio
//      archivo).
//   2. Que la inyeccion automatica de empresaId (buildScopedTx(),
//      tenantTransaction.ts) efectivamente llena el campo empresaId (NOT
//      NULL) de Cadena/Nodo/ConexionCadena sin que crearCadenaCompleta()
//      lo pase a mano -- un error ahi no lo detecta tsc/eslint bajo
//      engineType="client" (todo tipado `any` en este entorno, ver
//      ADR-0003), solo una escritura real contra Postgres.
//
// Los tres errores de validación de forma (índice inválido,
// auto-referencia, sin flujos) también viven acá y no en un
// *.test.ts unitario aparte: crearCadenaCompleta.ts importa
// tenantTransaction.ts -> client.ts, y solo instanciar PrismaClient ya
// explota en la Mac sin "prisma generate" con red real (mismo motivo
// documentado en el comentario de cabecera de tenantScope.ts, confirmado
// empíricamente: un archivo *.test.ts que importe este módulo falla al
// cargar con "did not initialize yet", incluso si el propio test nunca
// llega a tocar la base). Por eso quedan atados a correr solo con
// `npm run test:integration` en Windows, nunca con `npm run test`, igual
// que el resto de este archivo.
//
// Corre SOLO con `npm run test:integration`, mismo criterio que
// aislamientoMultitenant.integration.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma/client";
import { tenantClient } from "../../prisma/tenantClient";
import {
  crearCadenaCompleta,
  type CadenaEntrada,
  ConexionCadenaAutoReferenciaError,
  ConexionCadenaDuplicadaError,
  ConexionCadenaIndiceInvalidoError,
  ConexionCadenaSinFlujosError,
} from "../crearCadenaCompleta";

const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

async function crearEmpresaDePrueba(): Promise<string> {
  const empresaId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.create({
      data: { id: empresaId, nombre: "Empresa de prueba (crearCadenaCompleta, borrar si queda huerfana)" },
    });
  }, TX_OPTIONS);
  return empresaId;
}

async function borrarEmpresaDePrueba(empresaId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    // Mismo hallazgo documentado en aislamientoMultitenant.integration.test.ts:
    // conexiones_cadena -> nodos es ON DELETE RESTRICT, borrar a mano
    // antes de la empresa para no depender del orden de cascade de
    // Postgres.
    await tx.conexionCadena.deleteMany({});
    await tx.empresa.delete({ where: { id: empresaId } });
  }, TX_OPTIONS);
}

function entradaBase(overrides: Partial<CadenaEntrada> = {}): CadenaEntrada {
  return {
    nombre: "Cadena de prueba",
    productoServicio: "Producto de prueba",
    periodoInicio: new Date("2026-01-01"),
    periodoFin: new Date("2026-03-31"),
    tipoOperacion: "manufactura",
    nodos: [
      { nombre: "Origen", tipo: "AREA" },
      { nombre: "Destino", tipo: "AREA" },
    ],
    conexiones: [{ origenIndex: 0, destinoIndex: 1, flujos: ["INFORMACION"] }],
    ...overrides,
  };
}

describe("crearCadenaCompleta (integración contra Neon real)", () => {
  const empresasCreadas: string[] = [];

  afterEach(async () => {
    while (empresasCreadas.length > 0) {
      const empresaId = empresasCreadas.pop();
      if (empresaId) {
        await borrarEmpresaDePrueba(empresaId);
      }
    }
  }, 60000);

  it("crea la Cadena, los Nodos y la ConexionCadena con sus Flujos en una sola operación atómica", async () => {
    const empresaId = await crearEmpresaDePrueba();
    empresasCreadas.push(empresaId);

    const resultado = await crearCadenaCompleta(
      empresaId,
      entradaBase({
        conexiones: [{ origenIndex: 0, destinoIndex: 1, flujos: ["INFORMACION", "PRODUCTO_SERVICIO"] }],
      }),
    );

    expect(resultado.nodoIds).toHaveLength(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    const cliente = tenantClient(empresaId) as any;

    // Prueba directa de la inyección automática de empresaId (razón #2
    // del comentario de cabecera): ninguna de las tres creates de abajo
    // pasa empresaId a mano en crearCadenaCompleta.ts.
    const cadena = await cliente.cadena.findUniqueOrThrow({ where: { id: resultado.cadenaId } });
    expect(cadena.empresaId).toBe(empresaId);
    expect(cadena.nombre).toBe("Cadena de prueba");

    const nodos = await cliente.nodo.findMany({ where: { cadenaId: resultado.cadenaId } });
    expect(nodos).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    expect(nodos.every((n: any) => n.empresaId === empresaId)).toBe(true);

    const conexion = await cliente.conexionCadena.findFirstOrThrow({ where: { cadenaId: resultado.cadenaId } });
    expect(conexion.empresaId).toBe(empresaId);
    expect(conexion.origenNodoId).toBe(resultado.nodoIds[0]);
    expect(conexion.destinoNodoId).toBe(resultado.nodoIds[1]);

    // FlujoConexionCadena no está en TENANT_SCOPED_MODELS (tabla hija sin
    // empresaId propio, mismo patrón que RespuestaCruda) -- se consulta
    // sin pasar por tenantClient(), filtrada solo por la FK ya conocida.
    const flujos = await cliente.flujoConexionCadena.findMany({ where: { conexionCadenaId: conexion.id } });
    expect(flujos).toHaveLength(2);
  }, 30000);

  it("no deja Cadena ni Nodos huérfanos si una conexión duplicada hace fallar la transacción a mitad de camino", async () => {
    const empresaId = await crearEmpresaDePrueba();
    empresasCreadas.push(empresaId);

    await expect(
      crearCadenaCompleta(
        empresaId,
        entradaBase({
          // Misma pareja (origen, destino) dos veces: la primera
          // ConexionCadena se crea sin problema, la segunda viola
          // @@unique([origenNodoId, destinoNodoId]) -- P2002 a mitad de
          // la transacción, después de que la Cadena y los dos Nodos ya
          // se insertaron dentro de esa misma transacción.
          conexiones: [
            { origenIndex: 0, destinoIndex: 1, flujos: ["INFORMACION"] },
            { origenIndex: 0, destinoIndex: 1, flujos: ["DINERO"] },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ConexionCadenaDuplicadaError);

    // Si tenantTransaction() no fuera atómica, la Cadena y los dos Nodos
    // creados antes del fallo quedarían huérfanos en la base. Se
    // verifica que el rollback los borró a todos.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    const cliente = tenantClient(empresaId) as any;
    expect(await cliente.cadena.findMany({})).toHaveLength(0);
    expect(await cliente.nodo.findMany({})).toHaveLength(0);
    expect(await cliente.conexionCadena.findMany({})).toHaveLength(0);
  }, 30000);

  it("rechaza un índice de conexión que no existe en la lista de nodos, sin tocar la base", async () => {
    await expect(
      crearCadenaCompleta(
        "empresa-nunca-usada",
        entradaBase({ conexiones: [{ origenIndex: 0, destinoIndex: 5, flujos: ["INFORMACION"] }] }),
      ),
    ).rejects.toBeInstanceOf(ConexionCadenaIndiceInvalidoError);
  });

  it("rechaza una conexión que referencia el mismo nodo como origen y destino", async () => {
    await expect(
      crearCadenaCompleta(
        "empresa-nunca-usada",
        entradaBase({ conexiones: [{ origenIndex: 0, destinoIndex: 0, flujos: ["INFORMACION"] }] }),
      ),
    ).rejects.toBeInstanceOf(ConexionCadenaAutoReferenciaError);
  });

  it("rechaza una conexión sin ningún flujo declarado", async () => {
    await expect(
      crearCadenaCompleta(
        "empresa-nunca-usada",
        entradaBase({ conexiones: [{ origenIndex: 0, destinoIndex: 1, flujos: [] }] }),
      ),
    ).rejects.toBeInstanceOf(ConexionCadenaSinFlujosError);
  });
});
