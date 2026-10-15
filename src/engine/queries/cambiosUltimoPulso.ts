// Motor (PURO) -- I5-06: "¿Qué cambió desde el último pulso?".
//
// CONTRADICCION DOCUMENTADA (Seccion 3 de la autorizacion): Programa
// ChainPulse 53+ v3 (Punto 2, fila I5-06) propone reutilizar
// "inmutabilidad ya garantizada (ResultadoConexion/ResultadoCiclo,
// S10-12)". Esos modelos pertenecen al flujo V1 (Eslabon/Conexion/
// CicloPulso) -- Cadena (Incremento 3+, el flujo que usan las otras 5
// preguntas de este catalogo) NO tiene un concepto formal de "ciclo":
// sus observaciones/hallazgos se timestampean por periodo (ObservacionKpi)
// o por createdAt (HallazgoCadena), sin un cierre de ciclo explicito
// equivalente a CicloPulso.estado=CERRADO. Este motor por lo tanto NO
// reutiliza ResultadoCiclo -- define "el ultimo pulso" como el corte
// explicito que entrega el parametro `periodo.inicio` de la consulta
// (I5-10: el periodo lo valida la capa de infra antes de llegar aca):
// compara los hallazgos creados ANTES de ese corte contra los creados
// DESPUES (inclusive). Pendiente de decision de Alex: si prefiere que
// esta pregunta espere a que exista un concepto formal de "ciclo" para
// Cadena antes de contar como INV.
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { construirComoComprobar, mensajeSinDatos } from "./plantillasExplicacion";

export interface HallazgoCadenaParaCambios {
  id: string;
  dimension: string;
  resultado: string;
  createdAt: Date;
}

export interface DatosCambiosUltimoPulso {
  antesDelCorte: readonly HallazgoCadenaParaCambios[];
  desdeElCorte: readonly HallazgoCadenaParaCambios[];
  corte: Date;
}

export function ejecutarCambiosUltimoPulso(datos: DatosCambiosUltimoPulso): RespuestaConsulta {
  if (datos.antesDelCorte.length === 0 && datos.desdeElCorte.length === 0) {
    return {
      ok: false,
      catalogoId: "CAMBIOS_ULTIMO_PULSO",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: mensajeSinDatos("todavía no hay hallazgos registrados antes ni después del corte consultado"),
      camposFaltantes: ["hallazgos vigentes (HallazgoCadena) en al menos uno de los dos periodos"],
      comoIngresarlos: "Completa comparaciones de cadena/conexión para que el sistema registre hallazgos.",
    };
  }

  const idsAntes = new Set(datos.antesDelCorte.map((h) => h.id));
  const idsDespues = new Set(datos.desdeElCorte.map((h) => h.id));
  const nuevos = datos.desdeElCorte.filter((h) => !idsAntes.has(h.id));
  const resueltos = datos.antesDelCorte.filter((h) => !idsDespues.has(h.id));

  const resumen = `${nuevos.length} hallazgo(s) nuevo(s), ${resueltos.length} resuelto(s) desde el corte (${datos.corte.toISOString().slice(0, 10)}).`;

  return {
    ok: true,
    catalogoId: "CAMBIOS_ULTIMO_PULSO",
    respuestaDirecta: `Desde el último pulso: ${resumen}`,
    periodo: { inicio: datos.corte.toISOString().slice(0, 10), fin: "ahora" },
    filtros: {},
    fuente: "HallazgoCadena (comparación antes/después del corte)",
    formula: "Diferencia de conjuntos de hallazgos vigentes (por id) entre antes y después del corte",
    numerador: nuevos.length,
    denominador: datos.antesDelCorte.length + datos.desdeElCorte.length,
    calidad: { faltantes: [], cobertura: 1 },
    hecho: resumen,
    interpretacion: nuevos.length > 0
      ? "Aparecieron hallazgos nuevos desde el corte -- revisa si corresponden a cambios reales en la cadena o a nueva información capturada."
      : "No aparecieron hallazgos nuevos desde el corte.",
    accion: nuevos.length > 0
      ? "Revisa los hallazgos nuevos listados en el mapa de la cadena."
      : "Ninguna acción nueva derivada de este corte.",
    comoComprobar: construirComoComprobar("compara el mapa de hallazgos vigentes de hoy contra el registrado antes del corte consultado."),
    ruleVersion: "consultas-v1",
  };
}
