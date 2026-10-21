// Motor (PURO -- sin Prisma, sin infra, ADR-0002) -- I5-01: "¿Por qué
// cayó mi OTIF?". Compara el OTIF ya calculado del periodo consultado
// contra el periodo inmediatamente anterior (ambos ya persistidos como
// ObservacionKpi -- este motor NUNCA recalcula desde pedidos crudos, solo
// compara dos resultados ya calculados por calcularOtif(), mismo
// principio "el motor calcula, la tabla persiste el resultado" que
// ObservacionKpi ya documenta).
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { construirComoComprobar, formatearPorcentaje, formatearVariacionPuntos, mensajeSinDatos } from "./plantillasExplicacion";

/** Una observacion OTIF ya persistida, reducida a lo que este motor
 * necesita (nunca el registro Prisma completo -- el caller la proyecta). */
export interface ObservacionOtifParaConsulta {
  valor: number | null; // fraccion 0..1, ver ResultadoCalculoKpi
  numerador: number | null;
  denominador: number | null;
  periodoInicio: Date;
  periodoFin: Date;
  ruleVersion: string;
}

export interface DatosOtifCaida {
  actual: ObservacionOtifParaConsulta | null;
  anterior: ObservacionOtifParaConsulta | null;
  periodoConsultado: { inicio: Date; fin: Date };
}

function aIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * I5-01. `datos.actual`/`datos.anterior` ya vienen cargados por el caller
 * (ejecutores/otifCaida.ts, con Prisma) -- este motor nunca decide COMO
 * se consiguen, solo que hacer con ellos. Caso sin datos (I5-25): falta
 * `actual` o falta `anterior` -- nunca inventa una variacion con un solo
 * punto de dato.
 */
export function ejecutarOtifCaida(datos: DatosOtifCaida): RespuestaConsulta {
  const periodo = { inicio: aIso(datos.periodoConsultado.inicio), fin: aIso(datos.periodoConsultado.fin) };

  if (!datos.actual) {
    return {
      ok: false,
      catalogoId: "OTIF_CAIDA",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: mensajeSinDatos(`no hay una observación de OTIF declarada para el periodo ${periodo.inicio} a ${periodo.fin}`),
      camposFaltantes: ["observación de OTIF del periodo consultado"],
      comoIngresarlos: "Declara el OTIF de este periodo desde el panel de KPIs (OTIF) antes de consultar esta pregunta.",
    };
  }

  if (!datos.anterior) {
    return {
      ok: false,
      catalogoId: "OTIF_CAIDA",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: mensajeSinDatos("no hay una observación de OTIF del periodo inmediatamente anterior para comparar"),
      camposFaltantes: ["observación de OTIF del periodo anterior"],
      comoIngresarlos: "Declara el OTIF del periodo inmediatamente anterior desde el panel de KPIs (OTIF) antes de consultar esta pregunta.",
    };
  }

  const variacion = formatearVariacionPuntos(datos.actual.valor, datos.anterior.valor);
  const cayo = datos.actual.valor !== null && datos.anterior.valor !== null && datos.actual.valor < datos.anterior.valor;

  const respuestaDirecta = datos.actual.valor === null
    ? "El OTIF del periodo consultado no tiene filas evaluables (cobertura 0)."
    : `Tu OTIF de este periodo es ${formatearPorcentaje(datos.actual.valor)} (periodo anterior: ${formatearPorcentaje(datos.anterior.valor)}), una variación de ${variacion}.`;

  const hecho = `OTIF actual: ${formatearPorcentaje(datos.actual.valor)} (numerador ${datos.actual.numerador ?? "—"}, denominador ${datos.actual.denominador ?? "—"}). OTIF anterior: ${formatearPorcentaje(datos.anterior.valor)}.`;

  const interpretacion = cayo
    ? `El OTIF bajó respecto al periodo anterior (${variacion}). Esto indica una menor proporción de pedidos completos y a tiempo en este periodo; no se atribuye a una causa específica sin evidencia adicional.`
    : `El OTIF se mantuvo o mejoró respecto al periodo anterior (${variacion}).`;

  return {
    ok: true,
    catalogoId: "OTIF_CAIDA",
    respuestaDirecta,
    periodo,
    filtros: {},
    fuente: "ObservacionKpi (OTIF)",
    formula: "OTIF = pedidos completos y a tiempo / pedidos evaluados",
    numerador: datos.actual.numerador,
    denominador: datos.actual.denominador,
    calidad: { faltantes: [], cobertura: datos.actual.denominador !== null ? 1 : 0 },
    hecho,
    interpretacion,
    accion: cayo
      ? "Revisa las observaciones de OTIF proveedor del mismo periodo para identificar si la caída se concentra en un proveedor específico (pregunta '¿Qué proveedor concentra más retrasos?')."
      : "Ninguna acción urgente relacionada a OTIF para este periodo.",
    comoComprobar: construirComoComprobar(
      `revisa la observación de OTIF del periodo ${periodo.inicio} a ${periodo.fin} y la del periodo anterior en el panel de KPIs.`,
    ),
    ruleVersion: datos.actual.ruleVersion,
  };
}
