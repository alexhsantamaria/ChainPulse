// Motor (PURO) -- I5-04: "¿Qué información falta para calcular Fill
// Rate?". Esta pregunta SIEMPRE responde (su proposito es informar que
// falta) -- nunca cae en SIN_DATOS_SUFICIENTES, a diferencia de las
// demas preguntas del catalogo (Programa ChainPulse 53+ v3, Punto 2,
// fila I5-04; ver tambien la fila I5-04 de
// docs/engineering/INCREMENTO5_CONSULTAS_DETERMINISTICAS_TRAZABILIDAD.md).
//
// LIMITACION DE ESQUEMA DOCUMENTADA: ObservacionKpi persiste solo el
// AGREGADO {valor, numerador, denominador} de un periodo -- nunca las
// filas crudas por SKU (igual que OTIF, que tampoco persiste pedidos
// individuales). Por eso esta pregunta informa, al nivel de agregado,
// si existe o no una observacion declarada para el periodo -- no puede
// listar SKUs faltantes porque esa granularidad nunca se persiste.
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { construirComoComprobar } from "./plantillasExplicacion";

export interface DatosFaltantesFillRate {
  observacionExiste: boolean;
  valor: number | null;
  ruleVersion: string;
  periodoConsultado: { inicio: Date; fin: Date };
}

function aIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function ejecutarFaltantesFillRate(datos: DatosFaltantesFillRate): RespuestaConsulta {
  const periodo = { inicio: aIso(datos.periodoConsultado.inicio), fin: aIso(datos.periodoConsultado.fin) };

  const faltantes: string[] = [];
  if (!datos.observacionExiste) {
    faltantes.push("ninguna observación de Fill Rate declarada para este periodo");
  } else if (datos.valor === null) {
    faltantes.push("la observación existe pero no tiene filas evaluables (sin unidades solicitadas/servidas válidas)");
  }

  const respuestaDirecta = faltantes.length === 0
    ? `El Fill Rate del periodo ${periodo.inicio} a ${periodo.fin} ya está completo (no falta información conocida a nivel de agregado).`
    : `Para calcular el Fill Rate de este periodo falta: ${faltantes.join("; ")}.`;

  return {
    ok: true,
    catalogoId: "FALTANTES_FILL_RATE",
    respuestaDirecta,
    periodo,
    filtros: {},
    fuente: "ObservacionKpi (Fill Rate)",
    formula: "Fill Rate = unidades servidas / unidades solicitadas",
    numerador: null,
    denominador: null,
    calidad: { faltantes, cobertura: faltantes.length === 0 ? 1 : 0 },
    hecho: datos.observacionExiste
      ? `Existe una observación de Fill Rate para el periodo (valor=${datos.valor ?? "sin filas evaluables"}).`
      : "No existe ninguna observación de Fill Rate para el periodo consultado.",
    interpretacion: faltantes.length === 0
      ? "No hay brechas conocidas a nivel de agregado para este periodo."
      : "La brecha identificada impide calcular o confiar en el Fill Rate de este periodo hasta que se declare la información faltante.",
    accion: faltantes.length === 0
      ? "Ninguna acción pendiente para Fill Rate en este periodo."
      : "Declara la observación de Fill Rate del periodo desde el panel de KPIs.",
    comoComprobar: construirComoComprobar(`revisa si existe una observación de Fill Rate para el periodo ${periodo.inicio} a ${periodo.fin} en el panel de KPIs.`),
    ruleVersion: datos.ruleVersion,
  };
}
