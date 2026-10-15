// Motor (PURO) -- I5-03: "¿Dónde se encuentra la dependencia más
// crítica?". Recorrido determinista (no un modelo) sobre las conexiones
// ya declaradas del mapa: la conexion con mayor impactoFalla (NivelImpacto)
// y SIN alternativa probada es la dependencia mas critica -- mismo
// criterio que Programa ChainPulse 53+ v3 (Punto 2, fila I5-03).
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { construirComoComprobar, mensajeSinDatos } from "./plantillasExplicacion";

export type NivelImpactoConsulta = "BAJO" | "MEDIO" | "ALTO" | "CRITICO";

const ORDEN_IMPACTO: Record<NivelImpactoConsulta, number> = { BAJO: 0, MEDIO: 1, ALTO: 2, CRITICO: 3 };

export interface ConexionParaDependenciaCritica {
  id: string;
  origenNombre: string;
  destinoNombre: string;
  impactoFalla: NivelImpactoConsulta | null;
  tieneAlternativa: boolean | null;
  alternativaProbada: boolean | null;
}

export interface DatosDependenciaCritica {
  conexiones: readonly ConexionParaDependenciaCritica[];
}

export function ejecutarDependenciaCritica(datos: DatosDependenciaCritica): RespuestaConsulta {
  const conExcelenteEvidencia = datos.conexiones.filter((c) => c.impactoFalla !== null);

  if (conExcelenteEvidencia.length === 0) {
    return {
      ok: false,
      catalogoId: "DEPENDENCIA_CRITICA",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: mensajeSinDatos("ninguna conexión del mapa tiene declarado su impacto de falla"),
      camposFaltantes: ["impactoFalla de al menos una conexión del mapa"],
      comoIngresarlos: "Completa el formulario de criticidad (impacto de falla, alternativa) de las conexiones del mapa.",
    };
  }

  // Orden: mayor impactoFalla primero; entre iguales, sin alternativa
  // probada antes que con alternativa probada; desempate final por id
  // (determinismo estable, I5-26).
  const ordenadas = [...conExcelenteEvidencia].sort((a, b) => {
    const porImpacto = ORDEN_IMPACTO[b.impactoFalla as NivelImpactoConsulta] - ORDEN_IMPACTO[a.impactoFalla as NivelImpactoConsulta];
    if (porImpacto !== 0) return porImpacto;
    const aSinAlternativa = a.tieneAlternativa !== true || a.alternativaProbada !== true;
    const bSinAlternativa = b.tieneAlternativa !== true || b.alternativaProbada !== true;
    if (aSinAlternativa !== bSinAlternativa) return aSinAlternativa ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const masCritica = ordenadas[0];
  if (!masCritica) {
    throw new Error("ejecutarDependenciaCritica: conExcelenteEvidencia no vacio pero masCritica es undefined (invariante rota)");
  }
  const sinAlternativaProbada = masCritica.tieneAlternativa !== true || masCritica.alternativaProbada !== true;

  return {
    ok: true,
    catalogoId: "DEPENDENCIA_CRITICA",
    respuestaDirecta: `La dependencia más crítica es la conexión entre "${masCritica.origenNombre}" y "${masCritica.destinoNombre}" (impacto de falla: ${masCritica.impactoFalla}).`,
    periodo: { inicio: "no aplica", fin: "no aplica" },
    filtros: {},
    fuente: "ConexionCadena (impactoFalla, tieneAlternativa, alternativaProbada)",
    formula: "Mayor impactoFalla declarado, priorizando ausencia de alternativa probada",
    numerador: null,
    denominador: null,
    calidad: { faltantes: [], cobertura: conExcelenteEvidencia.length / datos.conexiones.length },
    hecho: `Conexión "${masCritica.origenNombre}" → "${masCritica.destinoNombre}": impactoFalla=${masCritica.impactoFalla}, tieneAlternativa=${masCritica.tieneAlternativa ?? "desconocido"}, alternativaProbada=${masCritica.alternativaProbada ?? "desconocido"}.`,
    interpretacion: sinAlternativaProbada
      ? "Esta conexión combina el mayor impacto de falla declarado con ausencia de una alternativa probada -- un punto único de falla sin respaldo verificado."
      : "Esta conexión tiene el mayor impacto de falla declarado, aunque ya cuenta con una alternativa probada.",
    accion: sinAlternativaProbada
      ? `Evalúa o construye una alternativa para la conexión "${masCritica.origenNombre}" → "${masCritica.destinoNombre}" antes de que falle.`
      : `Verifica periódicamente que la alternativa de "${masCritica.origenNombre}" → "${masCritica.destinoNombre}" siga vigente.`,
    comoComprobar: construirComoComprobar(`revisa la ficha de criticidad de la conexión "${masCritica.origenNombre}" → "${masCritica.destinoNombre}" en el mapa.`),
    ruleVersion: "consultas-v1",
  };
}
