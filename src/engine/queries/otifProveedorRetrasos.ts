// Motor (PURO) -- I5-02: "¿Qué proveedor concentra más retrasos?".
// LIMITACION DE ESQUEMA DOCUMENTADA (ver
// docs/engineering/INCREMENTO5_CONSULTAS_DETERMINISTICAS_TRAZABILIDAD.md,
// fila I5-02): ObservacionKpi (la unica tabla que persiste OTIF
// proveedor, I4-07) NO tiene una columna de proveedor -- I4-07 esta en
// estado P precisamente porque nunca se construyo su persistencia/API/UI
// con desglose por proveedor (Programa ChainPulse 53+ v3, Punto 2). Este
// motor SI sabe rankear si se le dan filas por proveedor (ver
// FilaOtifProveedorAgregada) -- el ejecutor de infra (ejecutores/
// otifProveedorRetrasos.ts) hoy SIEMPRE le pasa un array vacio, porque no
// existe ninguna columna de la que leerlo; cuando I4-07 tenga su propia
// persistencia por proveedor, el ejecutor de infra se actualiza para
// alimentar filas reales SIN tocar este archivo.
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { construirComoComprobar, formatearPorcentaje, mensajeSinDatos } from "./plantillasExplicacion";

export interface FilaOtifProveedorAgregada {
  proveedorAlias: string;
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
      comoIngresarlos: "Esta desagregación por proveedor todavía no tiene un flujo de captura en el producto (I4-07 pendiente).",
    };
  }

  const peor = [...evaluables].sort((a, b) => (a.valor as number) - (b.valor as number))[0];
  if (!peor) {
    throw new Error("ejecutarOtifProveedorRetrasos: evaluables no vacio pero peor es undefined (invariante rota)");
  }

  return {
    ok: true,
    catalogoId: "OTIF_PROVEEDOR_RETRASOS",
    respuestaDirecta: `El proveedor que concentra más retrasos es "${peor.proveedorAlias}", con OTIF proveedor de ${formatearPorcentaje(peor.valor)}.`,
    periodo,
    filtros: {},
    fuente: "ObservacionKpi (OTIF proveedor, por proveedor)",
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
