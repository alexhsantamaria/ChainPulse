// Pruebas (unitarias, sin DB) -- clasificarValorObservacionKpi(),
// clasificarFilaCobertura(), motivoFilaCobertura(), clasificarImportacion(),
// esCodigoConDetalleHabilitado(), resumirFilasCobertura(),
// tasaValidaDeResumen(), esCodigoConHistoricoHabilitado() (segundo corte
// de PR-A, 2026-11-23), esCodigoConAccionesHabilitado() (tercer corte de
// PR-A, 2026-11-23). Incremento 4 PR1 (Alex, 2026-11-06): cubre
// exactamente los 4 estados pedidos ("sin datos", "cero real",
// "procesamiento pendiente", "procesamiento con errores") mas la guarda
// de alcance (solo OTIF/Fill Rate tienen pagina de detalle generica en
// este PR) y el resumen de filas validas/excluidas de Cobertura
// (incluido el caso de "estado vacio" -- una importacion sin ninguna
// fila persistida).
import { describe, expect, it } from "vitest";
import {
  clasificarValorObservacionKpi,
  clasificarFilaCobertura,
  motivoFilaCobertura,
  clasificarImportacion,
  esCodigoConDetalleHabilitado,
  resumirFilasCobertura,
  tasaValidaDeResumen,
  esCodigoConHistoricoHabilitado,
  esCodigoConAccionesHabilitado,
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

describe("esCodigoConDetalleHabilitado -- puerta del detalle generico", () => {
  it("OTIF -> habilitado", () => {
    expect(esCodigoConDetalleHabilitado("OTIF")).toBe(true);
  });

  it("FILL_RATE -> habilitado", () => {
    expect(esCodigoConDetalleHabilitado("FILL_RATE")).toBe(true);
  });

  // Incremento 5 (Alex, 2026-11-27): Lead time activa `detalle:
  // "OBSERVACION_KPI"` en el catalogo -- reutiliza la misma pagina
  // generica que OTIF/Fill Rate (ver DetalleObservacionKpi.tsx, que
  // ensancha su tipo local CodigoHabilitado para admitir "LEAD_TIME").
  it("LEAD_TIME -> habilitado (incremento 5, primer KPI activado de los seis pendientes)", () => {
    expect(esCodigoConDetalleHabilitado("LEAD_TIME")).toBe(true);
  });

  // Corregido incremento 5: eran "los seis KPIs pendientes" -- Lead time
  // se activa arriba y queda fuera de este grupo.
  it("los detalles dedicados y los cinco KPIs todavia pendientes no abren la pagina generica", () => {
    for (const codigo of [
      "STOCKOUT",
      "COBERTURA",
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

describe("esCodigoConHistoricoHabilitado -- puerta del historico generico (segundo corte de PR-A)", () => {
  it("OTIF -> habilitado", () => {
    expect(esCodigoConHistoricoHabilitado("OTIF")).toBe(true);
  });

  it("FILL_RATE -> habilitado", () => {
    expect(esCodigoConHistoricoHabilitado("FILL_RATE")).toBe(true);
  });

  it("COBERTURA -> habilitado (adaptador dedicado, pero SI declara historico)", () => {
    expect(esCodigoConHistoricoHabilitado("COBERTURA")).toBe(true);
  });

  // Corregido 2026-11-23 (segundo corte de PR-A): el primer corte
  // (commit 7224e2c, ya en main) declaraba historico: "OTIF_PROVEEDOR"
  // en el catalogo sin que existiera ningun adaptador/analisis de
  // historico real para este KPI -- inconsistencia ya corregida en
  // catalogoPipelineKpi.ts (historico: null). OTIF Proveedor permanece
  // fuera del historico generico; su persistencia y su detalle
  // dedicados no cambian.
  it("OTIF_PROVEEDOR -> NO habilitado (permanece fuera del historico generico, solo tiene persistencia y detalle dedicados)", () => {
    expect(esCodigoConHistoricoHabilitado("OTIF_PROVEEDOR")).toBe(false);
  });

  // Incremento 5 (Alex, 2026-11-27): Lead time activa `historico:
  // "OBSERVACION_KPI"` -- reutiliza cargarHistoricoObservacionesKpi()
  // sin ningun cambio (es generico por cadenaId+definicionKpiId, nunca
  // por codigo).
  it("LEAD_TIME -> habilitado (incremento 5, primer KPI activado de los seis pendientes)", () => {
    expect(esCodigoConHistoricoHabilitado("LEAD_TIME")).toBe(true);
  });

  // Corregido incremento 5: eran "los seis KPIs pendientes".
  it("los cinco KPIs todavia pendientes -> no habilitados, no anuncian una capacidad inexistente", () => {
    for (const codigo of [
      "STOCKOUT",
      "VARIABILIDAD_LEAD_TIME",
      "TIEMPO_DETECCION",
      "TIEMPO_DECISION",
      "TIEMPO_RECUPERACION",
    ]) {
      expect(esCodigoConHistoricoHabilitado(codigo)).toBe(false);
    }
  });

  it("código desconocido o vacío -> no habilitado, nunca revienta (configuracion===null, no undefined!==null)", () => {
    expect(esCodigoConHistoricoHabilitado("")).toBe(false);
    expect(esCodigoConHistoricoHabilitado("ALGO_QUE_NO_EXISTE")).toBe(false);
  });
});

describe("esCodigoConAccionesHabilitado -- puerta de acciones genericas (tercer corte de PR-A)", () => {
  it("OTIF -> habilitado", () => {
    expect(esCodigoConAccionesHabilitado("OTIF")).toBe(true);
  });

  it("FILL_RATE -> habilitado", () => {
    expect(esCodigoConAccionesHabilitado("FILL_RATE")).toBe(true);
  });

  it("COBERTURA -> habilitado (acciones via IMPORTACION_CSV)", () => {
    expect(esCodigoConAccionesHabilitado("COBERTURA")).toBe(true);
  });

  // OTIF Proveedor nunca tuvo acciones habilitadas (a diferencia del
  // historico, donde el primer corte SI habia declarado una capacidad
  // inexistente por error) -- catalogoPipelineKpi.ts ya declara
  // acciones: null para OTIF_PROVEEDOR desde el primer corte, y
  // AccionesDecisionKpi.tsx nunca se importa en ninguna pagina de OTIF
  // Proveedor. Esta prueba fija ese estado actual como regresion.
  it("OTIF_PROVEEDOR -> NO habilitado (nunca tuvo acciones; su persistencia y detalle dedicados no cambian)", () => {
    expect(esCodigoConAccionesHabilitado("OTIF_PROVEEDOR")).toBe(false);
  });

  // Incremento 5 (Alex, 2026-11-27): Lead time activa `acciones:
  // "OBSERVACION_KPI"` -- AccionesDecisionKpi.tsx ya se monta sin
  // condicion dentro de DetalleObservacionKpi.tsx (ningun componente
  // consulta todavia esta puerta, ver comentario de
  // esCodigoConAccionesHabilitado() en estadoVisualizacion.ts), asi que
  // esto deja el catalogo consistente con lo que la UI ya hace, sin
  // cambiar ningun comportamiento visible adicional.
  it("LEAD_TIME -> habilitado (incremento 5, primer KPI activado de los seis pendientes)", () => {
    expect(esCodigoConAccionesHabilitado("LEAD_TIME")).toBe(true);
  });

  // Corregido incremento 5: eran "los seis KPIs pendientes".
  it("los cinco KPIs todavia pendientes -> no habilitados, no anuncian una capacidad inexistente", () => {
    for (const codigo of [
      "STOCKOUT",
      "VARIABILIDAD_LEAD_TIME",
      "TIEMPO_DETECCION",
      "TIEMPO_DECISION",
      "TIEMPO_RECUPERACION",
    ]) {
      expect(esCodigoConAccionesHabilitado(codigo)).toBe(false);
    }
  });

  it("código desconocido o vacío -> no habilitado, nunca revienta (configuracion===null, no undefined!==null)", () => {
    expect(esCodigoConAccionesHabilitado("")).toBe(false);
    expect(esCodigoConAccionesHabilitado("ALGO_QUE_NO_EXISTE")).toBe(false);
  });
});

describe("tasaValidaDeResumen -- formula canonica de tasa valida (segundo corte de PR-A)", () => {
  it("total 0 -> null, nunca se disfraza de 0% valido", () => {
    expect(tasaValidaDeResumen({ valor: 0, ceroReal: 0, sinDatos: 0, conErrores: 0, total: 0 })).toBeNull();
  });

  it("calcula (valor + ceroReal) / total", () => {
    const resumen = { valor: 7, ceroReal: 3, sinDatos: 2, conErrores: 1, total: 13 };
    expect(tasaValidaDeResumen(resumen)).toBeCloseTo(10 / 13);
  });

  it("0 filas validas sobre un total positivo -> 0 (un cero real, no una ausencia)", () => {
    const resumen = { valor: 0, ceroReal: 0, sinDatos: 4, conErrores: 1, total: 5 };
    expect(tasaValidaDeResumen(resumen)).toBe(0);
  });

  it("todas las filas validas -> 1", () => {
    const resumen = { valor: 5, ceroReal: 5, sinDatos: 0, conErrores: 0, total: 10 };
    expect(tasaValidaDeResumen(resumen)).toBe(1);
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
