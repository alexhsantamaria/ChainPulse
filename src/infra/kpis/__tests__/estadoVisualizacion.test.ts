// Pruebas (unitarias, sin DB) -- clasificarValorObservacionKpi(),
// clasificarFilaCobertura(), motivoFilaCobertura(), clasificarImportacion(),
// esCodigoConDetalleHabilitado(), resumirFilasCobertura(). Incremento 4
// PR1 (Alex, 2026-11-06): cubre exactamente los 4 estados pedidos ("sin
// datos", "cero real", "procesamiento pendiente", "procesamiento con
// errores") mas la guarda de alcance (solo OTIF/Fill Rate tienen pagina
// de detalle generica en este PR) y el resumen de filas validas/
// excluidas de Cobertura (incluido el caso de "estado vacio" -- una
// importacion sin ninguna fila persistida).
import { describe, expect, it } from "vitest";
import {
  clasificarValorObservacionKpi,
  clasificarFilaCobertura,
  motivoFilaCobertura,
  clasificarImportacion,
  esCodigoConDetalleHabilitado,
  resumirFilasCobertura,
} from "../estadoVisualizacion";

describe("clasificarValorObservacionKpi -- OTIF/Fill Rate", () => {
  it("valor null -> SIN_DATOS (nunca un cero disfrazado)", () => {
    expect(clasificarValorObservacionKpi(null)).toBe("SIN_DATOS");
  });

  it("valor 0 -> CERO_REAL, distinto de SIN_DATOS", () => {
    expect(clasificarValorObservacionKpi(0)).toBe("CERO_REAL");
  });

  it("valor positivo -> VALOR", () => {
    expect(clasificarValorObservacionKpi(0.873)).toBe("VALOR");
  });

  it("valor negativo (no deberia ocurrir para OTIF/Fill Rate, pero no debe caer en SIN_DATOS/CERO_REAL) -> VALOR", () => {
    expect(clasificarValorObservacionKpi(-0.1)).toBe("VALOR");
  });
});

describe("clasificarFilaCobertura -- Cobertura por SKU", () => {
  it("CALCULADA con coberturaDias 0 -> CERO_REAL (regla 2 del motor: inventario cero con consumo positivo)", () => {
    expect(clasificarFilaCobertura("CALCULADA", 0)).toBe("CERO_REAL");
  });

  it("CALCULADA con coberturaDias positivo -> VALOR", () => {
    expect(clasificarFilaCobertura("CALCULADA", 10)).toBe("VALOR");
  });

  it("SIN_CONSUMO_REFERENCIA -> SIN_DATOS", () => {
    expect(clasificarFilaCobertura("SIN_CONSUMO_REFERENCIA", null)).toBe("SIN_DATOS");
  });

  it("DATOS_INCOMPLETOS -> SIN_DATOS", () => {
    expect(clasificarFilaCobertura("DATOS_INCOMPLETOS", null)).toBe("SIN_DATOS");
  });

  it("VALOR_NEGATIVO -> CON_ERRORES", () => {
    expect(clasificarFilaCobertura("VALOR_NEGATIVO", null)).toBe("CON_ERRORES");
  });

  it("UNIDADES_INCOMPATIBLES -> CON_ERRORES", () => {
    expect(clasificarFilaCobertura("UNIDADES_INCOMPATIBLES", null)).toBe("CON_ERRORES");
  });
});

describe("motivoFilaCobertura -- texto por estado", () => {
  it("CALCULADA -> sin motivo (no es un estado especial)", () => {
    expect(motivoFilaCobertura("CALCULADA")).toBeNull();
  });

  it("cada estado especial trae su propio texto, distinguible entre si", () => {
    const sinConsumo = motivoFilaCobertura("SIN_CONSUMO_REFERENCIA");
    const incompletos = motivoFilaCobertura("DATOS_INCOMPLETOS");
    const negativo = motivoFilaCobertura("VALOR_NEGATIVO");
    const incompatibles = motivoFilaCobertura("UNIDADES_INCOMPATIBLES");
    expect(sinConsumo).toMatch(/consumo/i);
    expect(incompletos).toMatch(/incompleto|faltante/i);
    expect(negativo).toMatch(/negativo/i);
    expect(incompatibles).toMatch(/unidades/i);
    const todos = [sinConsumo, incompletos, negativo, incompatibles];
    expect(new Set(todos).size).toBe(4); // los 4 textos son distintos entre si
  });
});

describe("clasificarImportacion -- Cobertura (nivel importación)", () => {
  it("PENDIENTE_REVISION -> PENDIENTE_REVISION (todavía no confirmada)", () => {
    expect(clasificarImportacion("PENDIENTE_REVISION", null, null)).toBe("PENDIENTE_REVISION");
  });

  it("DESCARTADA -> DESCARTADA", () => {
    expect(clasificarImportacion("DESCARTADA", null, null)).toBe("DESCARTADA");
  });

  it("ERROR -> CON_ERRORES, incluso si confirmadaEn está seteado", () => {
    expect(clasificarImportacion("ERROR", new Date(), null)).toBe("CON_ERRORES");
  });

  it("CONFIRMADA con confirmadaEn pero sin procesadaEn -> PROCESANDO (procesamiento pendiente)", () => {
    expect(clasificarImportacion("CONFIRMADA", new Date(), null)).toBe("PROCESANDO");
  });

  it("CONFIRMADA con procesadaEn seteado -> PROCESADA", () => {
    expect(clasificarImportacion("CONFIRMADA", new Date(), new Date())).toBe("PROCESADA");
  });

  it("CONFIRMADA sin confirmadaEn ni procesadaEn (viola el invariante de la transaccion de confirmar) -> INCONSISTENTE, NUNCA PROCESADA", () => {
    // Correccion de Alex (2026-11-06): antes de esta correccion, este caso
    // caia por descarte al "return PROCESADA" de clasificarImportacion()
    // -- un estado que viola el invariante de la transaccion (ver
    // confirmar/route.ts, punto 1 de su cabecera) terminaba mostrandose
    // como un resultado exitoso. Ahora es su propia categoria.
    expect(clasificarImportacion("CONFIRMADA", null, null)).toBe("INCONSISTENTE");
  });

  it("CONFIRMADA con procesadaEn pero SIN confirmadaEn -> tambien INCONSISTENTE (procesar sin haber confirmado antes es la misma violacion)", () => {
    expect(clasificarImportacion("CONFIRMADA", null, new Date())).toBe("INCONSISTENTE");
  });
});

describe("esCodigoConDetalleHabilitado -- alcance de PR1", () => {
  it("OTIF -> habilitado", () => {
    expect(esCodigoConDetalleHabilitado("OTIF")).toBe(true);
  });

  it("FILL_RATE -> habilitado", () => {
    expect(esCodigoConDetalleHabilitado("FILL_RATE")).toBe(true);
  });

  it("los 7 KPIs restantes -> NO habilitados (sin flujo de ingesta propio todavía)", () => {
    for (const codigo of [
      "STOCKOUT",
      "COBERTURA",
      "LEAD_TIME",
      "VARIABILIDAD_LEAD_TIME",
      "OTIF_PROVEEDOR",
      "TIEMPO_DETECCION",
      "TIEMPO_DECISION",
      "TIEMPO_RECUPERACION",
    ]) {
      expect(esCodigoConDetalleHabilitado(codigo)).toBe(false);
    }
  });

  it("código desconocido o vacío -> no habilitado, nunca revienta", () => {
    expect(esCodigoConDetalleHabilitado("")).toBe(false);
    expect(esCodigoConDetalleHabilitado("ALGO_QUE_NO_EXISTE")).toBe(false);
  });
});

describe("resumirFilasCobertura -- resumen de filas validas/excluidas por importacion", () => {
  it("importacion sin ninguna fila persistida (estado vacio) -> todos los conteos en cero", () => {
    expect(resumirFilasCobertura({}, 0)).toEqual({ valor: 0, ceroReal: 0, sinDatos: 0, conErrores: 0, total: 0 });
  });

  it("separa CERO_REAL de VALOR dentro del mismo estado CALCULADA de la BD", () => {
    const resumen = resumirFilasCobertura({ CALCULADA: 10 }, 3);
    expect(resumen).toEqual({ valor: 7, ceroReal: 3, sinDatos: 0, conErrores: 0, total: 10 });
  });

  it("agrupa SIN_CONSUMO_REFERENCIA + DATOS_INCOMPLETOS como sinDatos", () => {
    const resumen = resumirFilasCobertura({ SIN_CONSUMO_REFERENCIA: 2, DATOS_INCOMPLETOS: 5 }, 0);
    expect(resumen).toEqual({ valor: 0, ceroReal: 0, sinDatos: 7, conErrores: 0, total: 7 });
  });

  it("agrupa VALOR_NEGATIVO + UNIDADES_INCOMPATIBLES como conErrores", () => {
    const resumen = resumirFilasCobertura({ VALOR_NEGATIVO: 1, UNIDADES_INCOMPATIBLES: 4 }, 0);
    expect(resumen).toEqual({ valor: 0, ceroReal: 0, sinDatos: 0, conErrores: 5, total: 5 });
  });

  it("caso mixto con los 5 estados a la vez -- total es la suma exacta de las filas persistidas", () => {
    const resumen = resumirFilasCobertura(
      {
        CALCULADA: 8,
        SIN_CONSUMO_REFERENCIA: 2,
        DATOS_INCOMPLETOS: 1,
        VALOR_NEGATIVO: 1,
        UNIDADES_INCOMPATIBLES: 1,
      },
      3,
    );
    expect(resumen).toEqual({ valor: 5, ceroReal: 3, sinDatos: 3, conErrores: 2, total: 13 });
  });
});
