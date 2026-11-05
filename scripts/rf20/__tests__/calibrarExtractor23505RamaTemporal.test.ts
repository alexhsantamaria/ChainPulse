// Pruebas focalizadas (ronda de revision sobre la correccion del
// extractor de 23505) -- solo prueban las dos funciones de limpieza
// extraidas de main() (borrarFilaCalibracionConVerificacion,
// desconectarConSenalDeFallo), con un cliente FALSO en memoria. Nunca
// ejecuta main() completo, que exige variables de entorno reales,
// confirmacion de destino y una conexion Postgres real -- fuera de
// alcance de una prueba unitaria, y expresamente prohibido ("No
// ejecutes Neon ni produccion").
import { describe, expect, it, vi } from "vitest";

// El script bajo prueba importa generarCuid() (src/infra/ids/cuid.ts),
// que a su vez importa el paquete npm "cuid" -- no instalado en este
// entorno de pruebas (bloqueo de red preexistente, no relacionado con
// esta correccion; ver tambien gobernanzaVersiones.test.ts, que falla
// igual por el mismo motivo). Ninguna de las pruebas de este archivo
// ejercita generarCuid() (solo prueban las funciones de limpieza,
// extraidas de main()), asi que mockearlo aqui es seguro y evita ese
// bloqueo sin tocar nada del codigo bajo prueba.
vi.mock("cuid", () => ({ default: () => "id-falso-no-usado-en-estas-pruebas" }));

import {
  borrarFilaCalibracionConVerificacion,
  desconectarConSenalDeFallo,
} from "../calibrarExtractor23505RamaTemporal";

/**
 * Cliente falso para borrarFilaCalibracionConVerificacion():
 * `presenciaPorIntento[i]` (0-based, un valor por intento) dice si la
 * fila SIGUE presente despues del intento i+1 -- el ultimo valor se
 * repite si se agotan los intentos declarados. `fallaDeleteEnIntentos`
 * (1-based) lista en que intentos el DELETE debe lanzar.
 */
function clienteFalsoLimpieza(opciones: { presenciaPorIntento: boolean[]; fallaDeleteEnIntentos?: number[] }) {
  const { presenciaPorIntento, fallaDeleteEnIntentos = [] } = opciones;
  let intento = 0;
  const executeRawMock = vi.fn();
  const queryRawMock = vi.fn();
  const cliente = {
    async $executeRaw(...args: unknown[]) {
      executeRawMock(...args);
      if (fallaDeleteEnIntentos.includes(intento + 1)) {
        throw new Error("DELETE_FALLO_SINTETICO_TRANSITORIO");
      }
    },
    async $queryRaw(...args: unknown[]) {
      queryRawMock(...args);
      const siguePresente = presenciaPorIntento[intento] ?? presenciaPorIntento[presenciaPorIntento.length - 1];
      intento += 1;
      return siguePresente ? [{ existe: 1 }] : [];
    },
  };
  return { cliente, executeRawMock, queryRawMock };
}

describe("borrarFilaCalibracionConVerificacion", () => {
  it("eliminacion confirmada en el primer intento -- devuelve true", async () => {
    const { cliente, executeRawMock, queryRawMock } = clienteFalsoLimpieza({ presenciaPorIntento: [false] });

    const resultado = await borrarFilaCalibracionConVerificacion(cliente, "id-confirmado", 3, 0);

    expect(resultado).toBe(true);
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("DELETE transitoriamente fallido en el primer intento, confirmado en el segundo -- devuelve true", async () => {
    const { cliente, executeRawMock, queryRawMock } = clienteFalsoLimpieza({
      presenciaPorIntento: [true, false],
      fallaDeleteEnIntentos: [1],
    });

    const resultado = await borrarFilaCalibracionConVerificacion(cliente, "id-reintentado", 3, 0);

    expect(resultado).toBe(true);
    expect(executeRawMock).toHaveBeenCalledTimes(2);
    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });

  it("fila persistente tras agotar los 3 intentos -- devuelve false (nunca lanza)", async () => {
    const { cliente, executeRawMock, queryRawMock } = clienteFalsoLimpieza({
      presenciaPorIntento: [true, true, true],
    });

    const resultado = await borrarFilaCalibracionConVerificacion(cliente, "id-persistente", 3, 0);

    expect(resultado).toBe(false);
    expect(executeRawMock).toHaveBeenCalledTimes(3);
    expect(queryRawMock).toHaveBeenCalledTimes(3);
  });

  it("tambien devuelve false si la propia verificacion (no solo el DELETE) falla en todos los intentos", async () => {
    const cliente = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockRejectedValue(new Error("VERIFICACION_FALLO_SINTETICO")),
    };

    const resultado = await borrarFilaCalibracionConVerificacion(cliente, "id-verificacion-rota", 3, 0);

    expect(resultado).toBe(false);
  });
});

describe("desconectarConSenalDeFallo", () => {
  it("desconexion exitosa -- devuelve true", async () => {
    const cliente = { $disconnect: vi.fn().mockResolvedValue(undefined) };

    const resultado = await desconectarConSenalDeFallo(cliente, "calibrarExtractor23505");

    expect(resultado).toBe(true);
    expect(cliente.$disconnect).toHaveBeenCalledTimes(1);
  });

  it("fallo de desconexion -- devuelve false, nunca lanza, y nunca registra el mensaje crudo del error", async () => {
    const MENSAJE_CRUDO_TRAMPA = "MENSAJE_CRUDO_DE_DESCONEXION_NUNCA_DEBE_APARECER_EN_EL_LOG";
    const cliente = { $disconnect: vi.fn().mockRejectedValue(new Error(MENSAJE_CRUDO_TRAMPA)) };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let resultado: boolean | undefined;
    try {
      resultado = await desconectarConSenalDeFallo(cliente, "calibrarExtractor23505");
    } finally {
      const todoLoRegistrado = consoleErrorSpy.mock.calls.map((llamada) => llamada.join(" ")).join("\n");
      expect(todoLoRegistrado).not.toContain(MENSAJE_CRUDO_TRAMPA);
      consoleErrorSpy.mockRestore();
    }

    expect(resultado).toBe(false);
  });
});
