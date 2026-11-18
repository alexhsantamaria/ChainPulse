// Pruebas FOCALIZADAS (prisma mockeado, SIN Postgres real) sobre la FORMA
// de la sentencia que usa registrarIntento() -- Incremento 5 PR1, ronda
// de revision de Alex, 2026-11-17: la correccion de la condicion de
// carrera en limiteTasa.ts (ver su docstring) depende de que el contador
// del bucket ACTUAL salga SIEMPRE del RETURNING de la propia sentencia
// UPSERT atomica, nunca de una lectura separada posterior. Estas pruebas
// verifican esa forma exacta con un prisma mockeado -- NUNCA podrian
// reproducir la condicion de carrera real bajo concurrencia genuina de
// Postgres (bloqueo de fila, serializacion del UPSERT en conflicto):
// esa verificacion sigue siendo responsabilidad exclusiva de
// concurrenciaConsultaEjecutar.integration.test.ts, contra Postgres real
// (preparada en esta misma ronda, NO ejecutada todavia).
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { registrarIntento } from "../limiteTasa";

interface LlamadaRegistrada {
  textoSql: string;
}

function crearPrismaMock(
  filaReturning: { contador: number },
  filasAnteriores: { ventanaInicio: Date; contador: number }[],
) {
  const llamadas: LlamadaRegistrada[] = [];
  const queryRaw = vi.fn(async (strings: readonly string[]) => {
    const texto = Array.from(strings).join("?");
    llamadas.push({ textoSql: texto });
    // La sentencia INSERT...RETURNING del bucket actual es siempre la
    // PRIMERA llamada (ver registrarIntento() en limiteTasa.ts) -- se
    // distingue de la segunda (SELECT de buckets anteriores) por
    // contener "RETURNING", que nunca aparece en la segunda.
    if (texto.includes("RETURNING")) {
      return [filaReturning];
    }
    return filasAnteriores;
  });
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
  return { prisma, llamadas };
}

describe("registrarIntento() -- forma de la sentencia (mock, sin Postgres real)", () => {
  it(
    "ronda de revision de Alex, 2026-11-17 -- usa UNA sola sentencia " +
      "INSERT...ON CONFLICT...RETURNING para el contador del bucket " +
      "actual; la segunda consulta nunca vuelve a traer ese bucket " +
      '(filtra con "<" estricto, nunca "<=")',
    async () => {
      const { prisma, llamadas } = crearPrismaMock({ contador: 31 }, []);

      const resultado = await registrarIntento(
        "huella-de-prueba",
        "CONSULTA_EJECUTAR",
        30,
        new Date("2026-11-17T10:00:00.000Z"),
        prisma,
      );

      expect(llamadas).toHaveLength(2);
      expect(llamadas[0]?.textoSql).toContain("INSERT INTO");
      expect(llamadas[0]?.textoSql).toContain("ON CONFLICT");
      expect(llamadas[0]?.textoSql).toContain("RETURNING");
      expect(llamadas[1]?.textoSql).toContain("SELECT");
      expect(llamadas[1]?.textoSql).not.toContain("RETURNING");
      // Nunca "<=" en el filtro de buckets anteriores -- eso volveria a
      // incluir el bucket actual y reintroduciria la condicion de
      // carrera que corrige esta ronda.
      expect(llamadas[1]?.textoSql).not.toContain("<=");

      // El contador final es EXACTAMENTE el valor del RETURNING (31) --
      // nunca se recalcula ni se vuelve a leer desde otra fuente (no hay
      // buckets anteriores en este caso).
      expect(resultado.contador).toBe(31);
      expect(resultado.permitido).toBe(false); // 31 > 30
      expect(resultado.buckets).toHaveLength(1);
      expect(resultado.buckets[0]?.contador).toBe(31);
    },
  );

  it(
    "combina el RETURNING del bucket actual con los buckets anteriores " +
      "de la ventana deslizante, sin volver a leer el actual",
    async () => {
      const ventanaInicioAnterior = new Date("2026-11-17T09:45:00.000Z");
      const { prisma, llamadas } = crearPrismaMock({ contador: 12 }, [
        { ventanaInicio: ventanaInicioAnterior, contador: 8 },
      ]);

      const resultado = await registrarIntento(
        "huella-de-prueba",
        "CONSULTA_EJECUTAR",
        30,
        new Date("2026-11-17T10:00:00.000Z"),
        prisma,
        2, // ventanaEnBuckets = 2 (bucket actual + 1 anterior)
      );

      expect(llamadas).toHaveLength(2);
      // 12 (RETURNING, actual) + 8 (bucket anterior) = 20.
      expect(resultado.contador).toBe(20);
      expect(resultado.permitido).toBe(true); // 20 <= 30
      expect(resultado.buckets).toHaveLength(2);
      // El bucket actual es siempre el primer elemento del arreglo, con
      // el valor EXACTO del RETURNING -- nunca recalculado.
      expect(resultado.buckets[0]?.contador).toBe(12);
      expect(resultado.buckets[1]?.contador).toBe(8);
      expect(resultado.buckets[1]?.ventanaInicio).toEqual(ventanaInicioAnterior);
    },
  );

  it(
    "ronda de revision de Alex, 2026-11-17 -- dos invocaciones con " +
      "RETURNING distintos (simulando la serializacion REAL de Postgres " +
      "en la frontera 29->31) producen permitido/contador INDEPENDIENTES, " +
      "cada una a partir de SU PROPIO RETURNING -- nunca de una lectura " +
      "compartida entre ambas",
    async () => {
      const { prisma: prismaA } = crearPrismaMock({ contador: 30 }, []);
      const { prisma: prismaB } = crearPrismaMock({ contador: 31 }, []);
      const ahora = new Date("2026-11-17T10:00:00.000Z");

      const [resultadoA, resultadoB] = await Promise.all([
        registrarIntento("huella-frontera", "CONSULTA_EJECUTAR", 30, ahora, prismaA),
        registrarIntento("huella-frontera", "CONSULTA_EJECUTAR", 30, ahora, prismaB),
      ]);

      expect(resultadoA.contador).toBe(30);
      expect(resultadoA.permitido).toBe(true);
      expect(resultadoB.contador).toBe(31);
      expect(resultadoB.permitido).toBe(false);
    },
  );
});
