// Motor (PURO) -- I5-02: "¿Qué proveedor concentra más retrasos?".
//
// Incremento 5 PR3 (Alex, 2026-11-18): el ejecutor de infra
// (ejecutores/otifProveedorRetrasos.ts) ya lee observaciones reales de
// OTIF proveedor (tabla dedicada ObservacionOtifProveedor) -- este motor
// sigue siendo el mismo: sabe rankear si se le dan filas por proveedor
// (ver FilaOtifProveedorAgregada), sin saber de donde vinieron. Cuando el
// periodo consultado no tiene ninguna observacion persistida (cadena
// nueva, o periodo sin datos todavia), el ejecutor simplemente pasa un
// array vacio y este motor responde SIN_DATOS_SUFICIENTES, igual que
// antes -- "sin datos" sigue siendo una respuesta correcta, ya no la
// UNICA posible.
//
// Desempate deterministico EXPLICITO (Alex, punto 15): menor OTIF
// primero; en caso de empate exacto de `valor`, `proveedorAliasClave`
// ascendente (src/domain/proveedorAlias.ts -- comparacion por puntos de
// codigo, NUNCA localeCompare). Esto NO depende del orden en el que el
// ejecutor de infra entregue las filas (su `orderBy` de Postgres es una
// conveniencia, nunca la unica garantia de determinismo) -- el propio
// motor ordena explicitamente antes de elegir el peor.
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { compararClavesProveedor } from "@/domain/proveedorAlias";
import { construirComoComprobar, formatearPorcentaje, mensajeSinDatos } from "./plantillasExplicacion";

export interface FilaOtifProveedorAgregada {
  proveedorAlias: string;
  proveedorAliasClave: string;
  valor: number | null; // fraccion 0..1 de cumplimiento OTIF proveedor
  ruleVersion: string;
}

export interface DatosOtifProveedorRetrasos {
  filas: readonly FilaOtifProveedorAgregada[];
  periodoConsultado: { inicio: Date; fin: Date };
}

function aIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function ejecutarOtifProveedorRetrasos(datos: DatosOtifProveedorRetrasos): RespuestaConsulta {
  const periodo = { inicio: aIso(datos.periodoConsultado.inicio), fin: aIso(datos.periodoConsultado.fin) };
  const evaluables = datos.filas.filter((f) => f.valor !== null);

  if (evaluables.length === 0) {
    return {
      ok: false,
      catalogoId: "OTIF_PROVEEDOR_RETRASOS",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: mensajeSinDatos(
        "no hay observaciones de OTIF proveedor con desglose por proveedor para este periodo",
      ),
      camposFaltantes: ["observaciones de OTIF proveedor, desglosadas por proveedor, para el periodo consultado"],
      comoIngresarlos: "Declara al menos una observación de OTIF proveedor para este período desde el panel de KPIs.",
    };
  }

  // Desempate deterministico explicito -- ver comentario de cabecera.
  // `valor` nunca es null aca (ya filtrado arriba): el cast es seguro.
  const ordenados = [...evaluables].sort((a, b) => {
    const diferenciaValor = (a.valor as number) - (b.valor as number);
    if (diferenciaValor !== 0) return diferenciaValor;
    return compararClavesProveedor(a.proveedorAliasClave, b.proveedorAliasClave);
  });
  const peor = ordenados[0];
  if (!peor) {
    throw new Error("ejecutarOtifProveedorRetrasos: evaluables no vacio pero peor es undefined (invariante rota)");
  }

  return {
    ok: true,
    catalogoId: "OTIF_PROVEEDOR_RETRASOS",
    respuestaDirecta: `El proveedor que concentra más retrasos es "${peor.proveedorAlias}", con OTIF proveedor de ${formatearPorcentaje(peor.valor)}.`,
    periodo,
    filtros: {},
    fuente: "ObservacionOtifProveedor (OTIF proveedor, por proveedor)",
    formula: "OTIF proveedor = recepciones completas y a tiempo / recepciones",
    numerador: null,
    denominador: null,
    calidad: { faltantes: [], cobertura: evaluables.length / datos.filas.length },
    hecho: `Proveedor con menor OTIF proveedor en el periodo: "${peor.proveedorAlias}" (${formatearPorcentaje(peor.valor)}), entre ${evaluables.length} proveedor(es) evaluado(s).`,
    interpretacion: `Este proveedor tiene la tasa de cumplimiento más baja del periodo; no se afirma una causa sin evidencia adicional sobre por qué retrasa sus entregas.`,
    accion: `Revisa el historial de recepciones de "${peor.proveedorAlias}" para identificar un patrón (entregas tardías, incompletas, o ambas).`,
    comoComprobar: construirComoComprobar(`revisa las observaciones de OTIF proveedor de "${peor.proveedorAlias}" en el periodo ${periodo.inicio} a ${periodo.fin}.`),
    ruleVersion: peor.ruleVersion,
  };
}
