// Infraestructura (PURA -- sin Prisma, mismo motivo que declarar.ts de
// OTIF) -- catalogo cerrado de las 6 preguntas de Incremento 5 (I5-08).
// Decision de producto ya aprobada por Alex (Seccion 4 de la
// autorizacion): el USUARIO elige directamente una entrada; nunca un
// modelo de lenguaje. "el modelo de lenguaje solo elige de este
// catalogo" se satisface de forma MAS FUERTE (es el usuario quien elige,
// nunca un modelo) -- ver fila I5-08 en
// docs/engineering/INCREMENTO5_CONSULTAS_DETERMINISTICAS_TRAZABILIDAD.md.
//
// Disponible para ADMINISTRADOR y RESPONSABLE (a diferencia del piloto de
// declaracion de OTIF, que es solo-ADMINISTRADOR durante su piloto): una
// consulta es de solo lectura, sin riesgo de corromper datos -- no hay
// restriccion equivalente documentada para este incremento, asi que se
// habilita a ambos roles con sesion valida (I5-10: requireSession(), no
// requireAdmin()).
import type { CatalogoConsultaId, MetadatosCatalogoConsulta } from "@/domain/queries/tipos";
import { CATALOGO_CONSULTA_IDS } from "@/domain/queries/tipos";

export const RULE_VERSION_CONSULTAS = "consultas-v1";

const AMBOS_ROLES = ["ADMINISTRADOR", "RESPONSABLE"] as const;

// Record indexado por CatalogoConsultaId -- TypeScript exige una entrada
// por cada miembro de la union (Record<K, V> es exhaustivo por
// construccion, a diferencia de un array): agregar un 7mo ID sin su
// entrada aca rompe el build.
const CATALOGO: Record<CatalogoConsultaId, MetadatosCatalogoConsulta> = {
  OTIF_CAIDA: {
    id: "OTIF_CAIDA",
    titulo: "¿Por qué cayó mi OTIF?",
    descripcion:
      "Compara el OTIF del periodo consultado contra el periodo inmediatamente anterior y señala la variación.",
    dependenciasDatos: ["ObservacionKpi (OTIF, periodo actual y anterior)"],
    requierePeriodo: true,
    permisos: AMBOS_ROLES,
    comportamientoSinDatos:
      "Si falta la observación de OTIF del periodo actual o del anterior, responde qué periodo falta declarar.",
    ruleVersion: RULE_VERSION_CONSULTAS,
  },
  OTIF_PROVEEDOR_RETRASOS: {
    id: "OTIF_PROVEEDOR_RETRASOS",
    titulo: "¿Qué proveedor concentra más retrasos?",
    descripcion: "Ranking de proveedores (alias) por tasa de incumplimiento de OTIF proveedor en el periodo.",
    dependenciasDatos: ["ObservacionKpi (OTIF proveedor, por proveedorAlias)"],
    requierePeriodo: true,
    permisos: AMBOS_ROLES,
    comportamientoSinDatos: "Si no hay observaciones de OTIF proveedor en el periodo, responde que no hay datos cargados.",
    ruleVersion: RULE_VERSION_CONSULTAS,
  },
  DEPENDENCIA_CRITICA: {
    id: "DEPENDENCIA_CRITICA",
    titulo: "¿Dónde se encuentra la dependencia más crítica?",
    descripcion: "Identifica el nodo con mayor impacto de falla y sin alternativa probada en el mapa de la cadena.",
    dependenciasDatos: ["ConexionCadena (impactoFalla, tieneAlternativa, alternativaProbada)"],
    requierePeriodo: false,
    permisos: AMBOS_ROLES,
    comportamientoSinDatos: "Si ninguna conexión tiene impactoFalla declarado, responde que falta completar el mapa de criticidad.",
    ruleVersion: RULE_VERSION_CONSULTAS,
  },
  FALTANTES_FILL_RATE: {
    id: "FALTANTES_FILL_RATE",
    titulo: "¿Qué información falta para calcular Fill Rate?",
    descripcion: "Compara los campos requeridos por el motor de Fill Rate contra los efectivamente presentes.",
    dependenciasDatos: ["ObservacionKpi (Fill Rate)", "Definición de campos requeridos por KPI"],
    requierePeriodo: true,
    permisos: AMBOS_ROLES,
    comportamientoSinDatos: "Esta pregunta siempre responde (su propósito es listar lo que falta); nunca cae en SIN_DATOS_SUFICIENTES.",
    ruleVersion: RULE_VERSION_CONSULTAS,
  },
  ACCION_PRIORITARIA: {
    id: "ACCION_PRIORITARIA",
    titulo: "¿Qué acción debería evaluar primero?",
    descripcion: "Ordena los hallazgos vigentes de la cadena por prioridad (mismo orden de 6 niveles de prioridad.ts) y devuelve el más urgente.",
    dependenciasDatos: ["HallazgoCadena (vigentes del último ciclo)"],
    requierePeriodo: false,
    permisos: AMBOS_ROLES,
    comportamientoSinDatos: "Si no hay hallazgos vigentes, responde que todavía no hay un ciclo evaluado con hallazgos.",
    ruleVersion: RULE_VERSION_CONSULTAS,
  },
  CAMBIOS_ULTIMO_PULSO: {
    id: "CAMBIOS_ULTIMO_PULSO",
    titulo: "¿Qué cambió desde el último pulso?",
    descripcion:
      "Compara los hallazgos vigentes de la cadena antes y después de un corte explícito (ver limitación de esquema en engine/queries/cambiosUltimoPulso.ts: Cadena no tiene un concepto formal de ciclo como CicloPulso/ResultadoCiclo).",
    dependenciasDatos: ["HallazgoCadena (antes y después del corte)"],
    requierePeriodo: true, // periodo.inicio se usa como "el corte" -- ver ejecutarConsultaPermitida.ts
    permisos: AMBOS_ROLES,
    comportamientoSinDatos: "Si no hay hallazgos ni antes ni después del corte, responde que todavía no hay hallazgos registrados.",
    ruleVersion: RULE_VERSION_CONSULTAS,
  },
};

/** Devuelve el catalogo completo, en el orden de MVP-DEFINITIVO §12.1 --
 * usado por GET /api/consultas/catalogo (I5-08, expuesto a la UI). */
export function listarCatalogoConsultas(): MetadatosCatalogoConsulta[] {
  return CATALOGO_CONSULTA_IDS.map((id) => CATALOGO[id]);
}

/** Devuelve metadata de una entrada por ID, o null si el ID no existe en
 * el catalogo (nunca lanza -- un ID invalido de red es un dato de
 * usuario, no un error de programación). */
export function obtenerMetadatosCatalogo(id: string): MetadatosCatalogoConsulta | null {
  if (!esCatalogoConsultaId(id)) return null;
  return CATALOGO[id];
}

/** Type guard -- unico lugar que valida un string de red contra
 * CatalogoConsultaId (I5-08: "no permitir que el cliente envíe nombre de
 * tabla, columna, SQL, función interna, tenant o empresa" -- un ID que no
 * está en este Set exacto nunca llega a ningún ejecutor). */
export function esCatalogoConsultaId(valor: string): valor is CatalogoConsultaId {
  return (CATALOGO_CONSULTA_IDS as readonly string[]).includes(valor);
}
