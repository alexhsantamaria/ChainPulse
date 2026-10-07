// Pruebas LOCALES (sin conexion real) para prepararEsquemaLimpio()/
// limpiarEsquemaSiCorresponde() (esquemaDescartableRamas.ts) -- RONDA 19,
// Alex 2026-10-07: demuestra, con un doble de Client (solo el metodo
// query() que estas 2 funciones usan, nunca pg real), los 4
// comportamientos pedidos:
//
//   1. Esquema ausente -> se crea.
//   2. Esquema preexistente -> aborta sin borrarlo.
//   3. La limpieza solo borra cuando esta suite lo creo.
//   4. Un fallo parcial de preparacion no habilita el borrado.
//
// Corre con `npm run test` (nombre ".test.ts", no ".integration.test.ts")
// -- nunca abre una conexion, nunca necesita DATABASE_URL/SEED_DATABASE_URL.
import { describe, expect, it, vi } from "vitest";
import { prepararEsquemaLimpio, limpiarEsquemaSiCorresponde, type ClienteSoloQuery } from "./esquemaDescartableRamas";

/**
 * Doble minimo de Client -- responde segun un guion fijo (un resultado,
 * o un Error a lanzar, por cada llamada esperada en orden) y registra el
 * texto de cada consulta recibida. Nunca abre nada real.
 */
function crearClienteFalso(guion: Array<{ rows: unknown[]; rowCount: number | null } | Error>): {
  cliente: ClienteSoloQuery;
  consultasRecibidas: string[];
} {
  const consultasRecibidas: string[] = [];
  let indice = 0;
  const cliente: ClienteSoloQuery = {
    query: vi.fn(async (texto: string) => {
      consultasRecibidas.push(texto);
      const resultado = guion[indice];
      indice++;
      if (resultado === undefined) {
        throw new Error(`cliente falso: consulta de mas, sin guion para ella (#${indice}): ${texto}`);
      }
      if (resultado instanceof Error) {
        throw resultado;
      }
      return resultado;
    }),
  };
  return { cliente, consultasRecibidas };
}

describe("prepararEsquemaLimpio() -- abortar-si-existe, sin conexion real", () => {
  it("1. esquema ausente -> se crea (CREATE SCHEMA + las 10 CREATE TABLE, en ese orden, despues del chequeo de existencia)", async () => {
    const { cliente, consultasRecibidas } = crearClienteFalso([
      { rows: [], rowCount: 0 }, // SELECT de existencia -- 0 filas, no existe
      ...Array.from({ length: 11 }, () => ({ rows: [], rowCount: null })), // CREATE SCHEMA + 10 CREATE TABLE
    ]);

    await expect(prepararEsquemaLimpio(cliente)).resolves.toBeUndefined();

    expect(consultasRecibidas).toHaveLength(12); // 1 chequeo + 1 CREATE SCHEMA + 10 CREATE TABLE
    expect(consultasRecibidas[0]).toContain("information_schema.schemata");
    expect(consultasRecibidas[1]).toBe("CREATE SCHEMA _test_ramas");
    expect(consultasRecibidas.slice(2)).toHaveLength(10);
    expect(consultasRecibidas.slice(2).every((sql) => sql.startsWith('CREATE TABLE _test_ramas."'))).toBe(true);
  });

  it("2. esquema preexistente -> aborta con ESQUEMA_TEST_RAMAS_YA_EXISTE, sin intentar NINGUN DROP ni CREATE", async () => {
    const { cliente, consultasRecibidas } = crearClienteFalso([
      { rows: [{}], rowCount: 1 }, // SELECT de existencia -- 1 fila, SI existe
    ]);

    await expect(prepararEsquemaLimpio(cliente)).rejects.toThrow(/ESQUEMA_TEST_RAMAS_YA_EXISTE/);

    // La UNICA consulta emitida fue el chequeo de existencia -- ni un
    // DROP ni un CREATE -- justamente lo que esta prueba demuestra.
    expect(consultasRecibidas).toHaveLength(1);
    expect(consultasRecibidas[0]).toContain("information_schema.schemata");
  });

  it("4. un fallo a mitad de la creacion de las 10 tablas (fallo parcial de preparacion) se propaga, sin completar", async () => {
    const { cliente, consultasRecibidas } = crearClienteFalso([
      { rows: [], rowCount: 0 }, // SELECT de existencia -- no existe
      { rows: [], rowCount: null }, // CREATE SCHEMA -- ok
      { rows: [], rowCount: null }, // CREATE TABLE empresas -- ok
      new Error("conexion perdida a mitad de la creacion de tablas (simulado)"), // CREATE TABLE usuarios -- falla
    ]);

    await expect(prepararEsquemaLimpio(cliente)).rejects.toThrow(/conexion perdida a mitad de la creacion/);

    // Se detuvo en la 4ta consulta -- nunca llego a intentar las 9
    // CREATE TABLE restantes. El llamador real (ver el uso en
    // reconstruccionRlsAuthGrantsRamas.integration.test.ts) nunca pone
    // creadoPorEstaSuite en true si este await rechaza -- el bloque de
    // abajo demuestra que, con ese flag en false, limpiarEsquemaSi
    // Corresponde() no borra nada.
    expect(consultasRecibidas).toHaveLength(4);
  });
});

describe("limpiarEsquemaSiCorresponde() -- borrado condicionado a la bandera de propiedad, sin conexion real", () => {
  it("3a. creadoPorEstaSuite=true -> emite el DROP SCHEMA", async () => {
    const { cliente, consultasRecibidas } = crearClienteFalso([{ rows: [], rowCount: null }]);

    await limpiarEsquemaSiCorresponde(cliente, true);

    expect(consultasRecibidas).toEqual(["DROP SCHEMA IF EXISTS _test_ramas CASCADE"]);
  });

  it("3b. creadoPorEstaSuite=false -> no emite NINGUNA consulta (la limpieza solo borra lo que esta suite creo)", async () => {
    const { cliente, consultasRecibidas } = crearClienteFalso([]);

    await limpiarEsquemaSiCorresponde(cliente, false);

    expect(consultasRecibidas).toHaveLength(0);
  });

  it("4b. combinado con el test 4 de arriba: un fallo parcial de preparacion (creadoPorEstaSuite nunca llega a true) nunca habilita el borrado", async () => {
    // Reproduce el flujo real: prepararEsquemaLimpio() fallo a mitad de
    // camino (test 4 de arriba), asi que el llamador real nunca ejecuta
    // "creadoPorEstaSuite = true" -- el flag queda en false, que es
    // exactamente lo que el afterAll real invoca en ese escenario.
    const { cliente, consultasRecibidas } = crearClienteFalso([]);
    const creadoPorEstaSuite = false;

    await limpiarEsquemaSiCorresponde(cliente, creadoPorEstaSuite);

    expect(consultasRecibidas).toHaveLength(0);
  });
});
