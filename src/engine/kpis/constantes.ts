// Motor de KPIs -- version de reglas del catalogo de calculo (Incremento
// 4 Bloque A, MVP-DEFINITIVO Seccion 6.3/Especificacion V2 Seccion 11.1).
// Sube este numero cuando cambie cualquier formula de este archivo o de
// los demas engine/kpis/*.ts -- nunca se reescribe una ObservacionKpi ya
// persistida con otra version (mismo principio "versionado inmutable" que
// RULE_VERSION/RULE_VERSION_V2 de los otros dos motores).
export const RULE_VERSION_KPIS = "kpis-v1";

// Resultado comun de las 10 funciones de calculo (MVP-DEFINITIVO §21:
// "Se calcula OTIF con formula, periodo, numerador y denominador
// visibles" + "Datos incompletos producen advertencia y cobertura" +
// "El mismo conjunto y version produce el mismo resultado").
//
// `valor` refleja siempre la formula literal de MVP-DEFINITIVO sin
// formatear: para los KPIs cuya unidad es "%" (OTIF, Fill Rate, Stockout,
// OTIF proveedor) es una FRACCION en el rango 0..1, nunca 0..100 -- la
// capa de UI multiplica por 100, mismo criterio ya usado en el proyecto
// de mantener el dato crudo en el motor y el formato/etiqueta en la UI
// (ej. los estados de DimensionDiagnosticoV2 son claves crudas, ETIQUETA_*
// vive en infra/UI). Cobertura es la excepcion: su unidad es "dias", asi
// que `valor` ya esta en dias (inventario/consumo), no una fraccion.
//
// `valor` es null UNICAMENTE cuando no hay ninguna fila evaluable
// (filasEvaluadas === 0) -- nunca un 0 disfrazado de "sin datos".
export interface ResultadoCalculoKpi {
  valor: number | null;
  numerador: number | null;
  denominador: number | null;
  filasEvaluadas: number;
  filasExcluidas: number;
  // filasEvaluadas / (filasEvaluadas + filasExcluidas); 0 si no hay
  // ninguna fila de entrada (ni evaluada ni excluida).
  cobertura: number;
  advertencias: string[];
  ruleVersion: string;
}
