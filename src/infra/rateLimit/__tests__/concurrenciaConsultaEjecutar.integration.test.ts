// Prueba de integracion -- PREPARADA, NO EJECUTADA EN ESTA RONDA
// (Incremento 5 PR1, Alex 2026-11-17: "identificar/preparar para
// ejecucion obligatoria posterior... nunca declarar validado via
// mocks"). Corre SOLO con `npm run test:integration`, contra una base
// real (Neon, idealmente una rama temporal dedicada -- ver el protocolo
// de validacion de este PR1), NUNCA con `npm run test` (vitest.config.ts
// solo recolecta "*.test.ts", nunca "*.integration.test.ts" -- ver
// vitest.integration.config.ts).
//
// QUE prueba: que registrarIntento() (limiteTasa.ts) incrementa el
// contador de forma atomica bajo concurrencia REAL -- N llamadas
// disparadas con Promise.all (nunca secuenciales: lo que debe
// serializar los incrementos es el propio UPSERT atomico de Postgres,
// nunca un mock ni un await secuencial que oculte una condicion de
// carrera) sobre la MISMA huella+bucket+ventana deben terminar en
// contador === N exacto, sin incrementos perdidos por una condicion de
// carrera lectura-luego-escritura (el riesgo que el propio comentario
// de registrarIntento() en limiteTasa.ts dice evitar con un UPSERT de
// una sola sentencia).
//
// Mismo patron de concurrencia real que
// infra/rf24/__tests__/rf24Concurrencia.integration.test.ts y
// infra/kpis/cobertura/__tests__/confirmarConcurrencia.integration.test.ts.
// A diferencia de esos dos, LimiteTasa no tiene ninguna FK a tablas de
// tenant (huellaOrigenHash+bucket+ventanaInicio son las unicas columnas
// de identidad -- ver el comentario de ResultadoLimiteTasa en
// limiteTasa.ts) -- por eso esta prueba no necesita fixtures de
// empresa/usuario/cadena, solo una huella SINTETICA unica por corrida
// (para no interferir con trafico real) que se limpia en afterAll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma/client";
import { registrarIntento } from "../limiteTasa";

let huellaSinteticaDePrueba: string;

beforeAll(() => {
  const connectionString = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Esta prueba necesita SEED_DATABASE_URL o DATABASE_URL (conexion real a Postgres) -- no deberia correr en este entorno. Usar `npm run test:integration`, idealmente contra una rama temporal de Neon (ver protocolo de validacion de Incremento 5 PR1), nunca `npm run test`.",
    );
  }
  // Prefijo reconocible (nunca una huella real de produccion) para que
  // cualquier fila que quede por un corte abrupto de la corrida sea
  // identificable y segura de borrar a mano si afterAll no llega a
  // correr.
  huellaSinteticaDePrueba = `prueba-integracion-pr1-consulta-ejecutar:${randomUUID()}`;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "limite_tasa" WHERE "huellaOrigenHash" = ${huellaSinteticaDePrueba}`;
});

describe("registrarIntento() -- concurrencia real sobre CONSULTA_EJECUTAR (sin mocks)", () => {
  it("N llamadas concurrentes (Promise.all, nunca secuenciales) sobre la misma huella+bucket -- el contador final es exactamente N, ningun incremento perdido", async () => {
    const N = 25;
    const ahora = new Date();

    const resultados = await Promise.all(
      Array.from({ length: N }, () => registrarIntento(huellaSinteticaDePrueba, "CONSULTA_EJECUTAR", 1_000_000, ahora, prisma)),
    );

    // Cada respuesta individual debe traer un contador entre 1 y N (no
    // se afirma UN orden especifico -- eso dependeria del scheduler de
    // Postgres -- solo que la SUMA final, leida de nuevo, sea N).
    for (const r of resultados) {
      expect(r.contador).toBeGreaterThanOrEqual(1);
      expect(r.contador).toBeLessThanOrEqual(N);
    }

    const verificacion = await registrarIntento(huellaSinteticaDePrueba, "CONSULTA_EJECUTAR", 1_000_000, ahora, prisma);
    // La llamada de verificacion suma 1 mas -- el contador que devuelve
    // debe ser N+1 exacto (las N anteriores se contaron todas, ninguna
    // se perdio).
    expect(verificacion.contador).toBe(N + 1);
  });

  it("no permitido (limite excedido) -- buckets devuelto describe exactamente la fila real insertada (ventanaInicio truncada, contador real), no un valor inventado", async () => {
    const huellaPropia = `${huellaSinteticaDePrueba}:limite`;
    const ahora = new Date();

    let ultimo;
    for (let i = 0; i < 3; i++) {
      ultimo = await registrarIntento(huellaPropia, "CONSULTA_EJECUTAR", 2, ahora, prisma);
    }

    expect(ultimo?.permitido).toBe(false);
    expect(ultimo?.contador).toBe(3);
    expect(ultimo?.buckets).toHaveLength(1); // misma ventanaInicio truncada (15 min) para las 3 llamadas
    expect(ultimo?.buckets[0]?.contador).toBe(3);

    await prisma.$executeRaw`DELETE FROM "limite_tasa" WHERE "huellaOrigenHash" = ${huellaPropia}`;
  });
});
