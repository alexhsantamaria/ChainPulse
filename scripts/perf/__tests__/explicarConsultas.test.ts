// Pruebas focalizadas (Incremento 5 PR4, ronda de revision 2026-11-19,
// punto 4 de Alex: "Usar una unica conexion para RLS y EXPLAIN. No
// ejecutar set_config() y los EXPLAIN mediante llamadas independientes
// a pool.query(). Adquirir un solo PoolClient, usar una transaccion,
// ejecutar set_config('app.tenant_id', ..., true) y todos los EXPLAIN
// en esa misma conexion, haciendo rollback/release en finally.").
//
// Solo prueban ejecutarExplainsEnTransaccion(), la funcion PURA
// respecto a la conexion extraida de medirConRolDeAplicacion() para
// este proposito, con un cliente SQL FALSO en memoria (mismo patron ya
// establecido en
// scripts/rf20/calibrarExtractor23505RamaTemporal.ts/__tests__: cliente
// inyectado, nunca pg mockeado globalmente). Nunca ejecuta main() ni
// medirConRolDeAplicacion() completos, que exigen variables de entorno
// reales, confirmacion de destino y una conexion Postgres real --
// fuera de alcance de una prueba unitaria, y expresamente prohibido en
// esta ronda ("Sigue detenido antes de... Neon").
import { describe, expect, it } from "vitest";

import {
  ejecutarExplainsEnTransaccion,
  type ClienteSqlExplain,
} from "../explicarConsultas";
import type { IdsResueltosParaExplain } from "../../../src/infra/queries/rendimiento/casosExplainConsultas";

const IDS_DE_PRUEBA: IdsResueltosParaExplain = {
  empresaId: "empresa-falsa-1",
  cadenaId: "cadena-falsa-1",
  definicionOtifId: "def-otif-falsa-1",
  definicionOtifProveedorId: "def-otif-proveedor-falsa-1",
  definicionFillRateId: "def-fill-rate-falsa-1",
};

/**
 * Cliente falso: registra cada `query()` (texto + params) en orden, y
 * devuelve una fila EXPLAIN minima para cualquier consulta que empiece
 * con "EXPLAIN". Si `fallarEnLlamadaNumero` coincide con el numero de
 * llamada (1-based) de una consulta EXPLAIN, lanza en esa llamada en
 * vez de responder -- para probar que ROLLBACK corre igual cuando un
 * EXPLAIN falla a mitad del bucle.
 */
function clienteFalsoExplain(opciones: { fallarEnLlamadaNumero?: number } = {}): {
  cliente: ClienteSqlExplain;
  llamadas: { texto: string; params: unknown[] | undefined }[];
} {
  const { fallarEnLlamadaNumero } = opciones;
  const llamadas: { texto: string; params: unknown[] | undefined }[] = [];
  let numeroDeLlamada = 0;
  const cliente: ClienteSqlExplain = {
    async query(texto: string, params?: unknown[]) {
      numeroDeLlamada += 1;
      llamadas.push({ texto, params });
      if (fallarEnLlamadaNumero !== undefined && numeroDeLlamada === fallarEnLlamadaNumero) {
        throw new Error("EXPLAIN_FALLO_SINTETICO_DE_PRUEBA");
      }
      if (texto.startsWith("EXPLAIN")) {
        return { rows: [{ "QUERY PLAN": "Seq Scan sintetico (prueba)" }] };
      }
      return { rows: [] };
    },
  };
  return { cliente, llamadas };
}

describe("ejecutarExplainsEnTransaccion", () => {
  it("corre BEGIN, un unico set_config('app.tenant_id', empresaId, true), los 8 EXPLAIN y ROLLBACK -- todos en el MISMO cliente", async () => {
    const { cliente, llamadas } = clienteFalsoExplain();

    const resultado = await ejecutarExplainsEnTransaccion(cliente, 100, IDS_DE_PRUEBA);

    // BEGIN + set_config + 8 EXPLAIN + ROLLBACK = 11 llamadas, todas
    // sobre el unico `cliente` inyectado -- nunca una conexion
    // distinta por llamada (el bug que esta correccion elimina: el
    // Pool de `pg` no garantiza la misma conexion fisica entre
    // llamadas independientes a pool.query()).
    expect(llamadas).toHaveLength(11);
    expect(llamadas[0]).toEqual({ texto: "BEGIN", params: undefined });

    const llamadaSetConfig = llamadas[1];
    if (!llamadaSetConfig) throw new Error("llamadas[1] no existe -- la asercion de longitud de arriba ya deberia haber fallado antes");
    expect(llamadaSetConfig.texto).toContain("set_config('app.tenant_id'");
    // El 3er argumento de set_config debe ser `true` (local a ESTA
    // transaccion, nunca a la sesion/conexion completa) -- corrige el
    // `false` anterior, que fijaba el valor a nivel de sesion.
    expect(llamadaSetConfig.texto).toMatch(/,\s*true\s*\)/);
    expect(llamadaSetConfig.params).toEqual([IDS_DE_PRUEBA.empresaId]);

    const llamadasExplain = llamadas.slice(2, 10);
    expect(llamadasExplain).toHaveLength(8);
    for (const llamada of llamadasExplain) {
      expect(llamada.texto.startsWith("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)")).toBe(true);
    }

    expect(llamadas[10]).toEqual({ texto: "ROLLBACK", params: undefined });

    // 8 lineas de resultado, una por caso EXPLAIN.
    expect(resultado).toHaveLength(8);
  });

  it("nunca hace COMMIT -- este script es de solo lectura", async () => {
    const { llamadas, cliente } = clienteFalsoExplain();
    await ejecutarExplainsEnTransaccion(cliente, 100, IDS_DE_PRUEBA);
    expect(llamadas.some((l) => l.texto === "COMMIT")).toBe(false);
  });

  it("si un EXPLAIN falla a mitad del bucle, propaga el error original PERO igual ejecuta ROLLBACK en el mismo cliente (finally)", async () => {
    // BEGIN=1, set_config=2, 1er EXPLAIN=3, 2do EXPLAIN=4 -- falla en
    // la llamada 4 (el segundo de los 8 EXPLAIN).
    const { cliente, llamadas } = clienteFalsoExplain({ fallarEnLlamadaNumero: 4 });

    await expect(ejecutarExplainsEnTransaccion(cliente, 100, IDS_DE_PRUEBA)).rejects.toThrow(
      "EXPLAIN_FALLO_SINTETICO_DE_PRUEBA",
    );

    // BEGIN, set_config, 2 EXPLAIN (el 2do fallo), ROLLBACK -- nunca se
    // enmascara el error original, y ROLLBACK corre igual, en el MISMO
    // cliente (nunca uno nuevo).
    expect(llamadas).toHaveLength(5);
    const [primeraLlamada, , , , quintaLlamada] = llamadas;
    if (!primeraLlamada || !quintaLlamada) throw new Error("llamadas[0]/[4] no existen -- la asercion de longitud de arriba ya deberia haber fallado antes");
    expect(primeraLlamada.texto).toBe("BEGIN");
    expect(quintaLlamada.texto).toBe("ROLLBACK");
  });

  it("si BEGIN mismo falla, ROLLBACK (sin transaccion abierta) se intenta y se ignora sin enmascarar el error original", async () => {
    const cliente: ClienteSqlExplain = {
      async query(texto: string) {
        if (texto === "BEGIN") throw new Error("CONEXION_CAIDA_SINTETICA");
        if (texto === "ROLLBACK") throw new Error("ROLLBACK_SIN_TRANSACCION_SINTETICO");
        return { rows: [] };
      },
    };

    await expect(ejecutarExplainsEnTransaccion(cliente, 100, IDS_DE_PRUEBA)).rejects.toThrow(
      "CONEXION_CAIDA_SINTETICA",
    );
  });

  it("las 6 preguntas del catalogo quedan efectivamente cubiertas (8 casos: OTIF_CAIDA y CAMBIOS_ULTIMO_PULSO con sus 2 lecturas reales cada una)", async () => {
    const { cliente, llamadas } = clienteFalsoExplain();
    await ejecutarExplainsEnTransaccion(cliente, 100, IDS_DE_PRUEBA);

    const textosExplain = llamadas.filter((l) => l.texto.startsWith("EXPLAIN")).map((l) => l.texto);
    expect(textosExplain.some((t) => t.includes("observaciones_kpi"))).toBe(true); // OTIF_CAIDA + FALTANTES_FILL_RATE
    expect(textosExplain.some((t) => t.includes("observaciones_otif_proveedor"))).toBe(true);
    expect(textosExplain.some((t) => t.includes("conexiones_cadena"))).toBe(true); // DEPENDENCIA_CRITICA
    expect(textosExplain.some((t) => t.includes("hallazgos_cadena"))).toBe(true); // ACCION_PRIORITARIA + CAMBIOS_ULTIMO_PULSO
  });
});
