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
// (para no interferir con trafico real).
//
// LIMPIEZA (ronda de revision de Alex, 2026-11-18): la limpieza vive
// UNICAMENTE en afterAll(), por PREFIJO (LIKE), nunca con un DELETE al
// final de cada `it` -- un DELETE al final de un test NUNCA corre si
// una expectativa anterior de ESE MISMO test lanza (vitest no ejecuta
// el resto del cuerpo de un test que falla), asi que una fila sintetica
// podia quedar huerfana con solo que una `expect()` fallara a mitad de
// camino. afterAll(), en cambio, SIEMPRE corre al terminar el archivo
// -- paso o no paso cada test -- y el filtro por PREFIJO (no igualdad
// exacta) cubre de una sola vez tanto `huellaSinteticaDePrueba` (usada
// tal cual en el primer test) como cualquier variante derivada
// `${huellaSinteticaDePrueba}:sufijo` que un test agregue en el futuro,
// sin tener que mantener una lista de sufijos sincronizada a mano.
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
  // Por PREFIJO, no por igualdad exacta -- ver el comentario de arriba.
  // `huellaSinteticaDePrueba` es siempre `prefijo-fijo:${randomUUID()}`
  // (sin "%" ni "_", los caracteres especiales de LIKE: un UUID v4 solo
  // tiene hex y guiones), asi que no hace falta escapar el patron.
  await prisma.$executeRaw`DELETE FROM "limite_tasa" WHERE "huellaOrigenHash" LIKE ${huellaSinteticaDePrueba + "%"}`;
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

    // Sin DELETE aca a proposito -- ver el comentario de LIMPIEZA al
    // inicio del archivo: afterAll() limpia esta huella (y cualquier
    // otra con el mismo prefijo) de forma garantizada, incluso si
    // alguna de las expectativas de arriba hubiera fallado.
  });

  it(
    "ronda de revision de Alex, 2026-11-17 -- frontera concurrente REAL: contador inicial 29 (bajo " +
      "el limite de 30), 2 solicitudes SIMULTANEAS (Promise.all, nunca secuenciales) sobre la MISMA " +
      "huella+bucket -- contador final EXACTO 31, y de esas 2 solicitudes, EXACTAMENTE UNA termina " +
      "permitida (la que ve 30 <= 30) y EXACTAMENTE UNA termina rechazada (la que ve 31 > 30); nunca " +
      "las 2 permitidas (fugaria un intento de mas sobre el limite) ni las 2 rechazadas (rechazaria " +
      "de mas un intento que todavia cabia)",
    async () => {
      const huellaFrontera = `${huellaSinteticaDePrueba}:frontera-29-mas-2`;
      const limite = 30;
      const ahora = new Date();

      // Siembra del estado inicial -- 29 intentos SECUENCIALES a
      // proposito (es la precondicion, no la parte que se quiere
      // probar bajo concurrencia): deja el contador en exactamente 29,
      // por debajo del limite (29 <= 30, permitido).
      let ultimoDeSiembra;
      for (let i = 0; i < 29; i++) {
        ultimoDeSiembra = await registrarIntento(huellaFrontera, "CONSULTA_EJECUTAR", limite, ahora, prisma);
      }
      expect(ultimoDeSiembra?.contador).toBe(29);
      expect(ultimoDeSiembra?.permitido).toBe(true);

      // Las 2 solicitudes que importan -- disparadas con Promise.all,
      // REALMENTE concurrentes (nunca un await secuencial que oculte la
      // condicion de carrera): son los intentos #30 y #31 sobre la
      // MISMA huella+bucket+ventana.
      const [resultadoA, resultadoB] = await Promise.all([
        registrarIntento(huellaFrontera, "CONSULTA_EJECUTAR", limite, ahora, prisma),
        registrarIntento(huellaFrontera, "CONSULTA_EJECUTAR", limite, ahora, prisma),
      ]);

      const contadores = [resultadoA.contador, resultadoB.contador].sort((a, b) => a - b);
      // El UPSERT atomico de Postgres serializa los 2 incrementos: uno
      // ve 30 (el que el motor aplico primero), el otro ve 31 (el que
      // aplico despues) -- nunca los 2 ven el mismo valor, nunca se
      // pierde un incremento. El mayor de los dos (31) ES el contador
      // final persistido en esa fila: ninguna otra escritura ocurre
      // entre que el segundo de los dos termina y este punto, asi que
      // no hace falta una lectura extra para confirmarlo.
      expect(contadores).toEqual([30, 31]);

      const permitidos = [resultadoA.permitido, resultadoB.permitido];
      // Contrato EXPLICITO sobre cuantos de los 2 quedan permitidos/
      // rechazados: exactamente 1 de cada.
      expect(permitidos.filter((p) => p === true)).toHaveLength(1);
      expect(permitidos.filter((p) => p === false)).toHaveLength(1);

      // El contador final (31) corresponde al resultado marcado como
      // NO permitido -- 31 > 30 -- y el 30 (bajo el limite) es el que
      // quedo permitido. Se verifica la correspondencia 1 a 1, no solo
      // los conteos agregados de arriba.
      const resultadoDe30 = resultadoA.contador === 30 ? resultadoA : resultadoB;
      const resultadoDe31 = resultadoA.contador === 30 ? resultadoB : resultadoA;
      expect(resultadoDe30.permitido).toBe(true);
      expect(resultadoDe31.permitido).toBe(false);

      // Sin DELETE aca a proposito -- mismo criterio que el test
      // anterior: afterAll() garantiza la limpieza de esta huella
      // (y de cualquier otra con el mismo prefijo) incluso si alguna
      // expectativa de arriba hubiera fallado a mitad de camino.
    },
  );
});
