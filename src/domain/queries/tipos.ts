// Dominio — contratos de Incremento 5 (Consultas deterministicas mediante
// catalogo cerrado). Producto 1 unico autorizado (Alex, 2026-10-15): el
// usuario SELECCIONA directamente una de 6 preguntas predefinidas -- nunca
// escribe texto libre, nunca hay clasificador de intencion ni modelo de
// lenguaje (I5-07 permanece NI por diseño, no por incompletitud -- ver
// docs/engineering/INCREMENTO5_CONSULTAS_DETERMINISTICAS_TRAZABILIDAD.md).
//
// Union discriminada en vez de un string abierto (Seccion 6 de la
// autorizacion: "usar uniones discriminadas y exhaustividad en vez de
// strings abiertos") -- agregar una 7ma pregunta sin su rama en el
// dispatcher exhaustivo (ejecutarConsultaPermitida.ts) rompe el build,
// nunca cae en un default silencioso.
export type CatalogoConsultaId =
  | "OTIF_CAIDA" // I5-01 -- "¿Por qué cayó mi OTIF?"
  | "OTIF_PROVEEDOR_RETRASOS" // I5-02 -- "¿Qué proveedor concentra más retrasos?"
  | "DEPENDENCIA_CRITICA" // I5-03 -- "¿Dónde se encuentra la dependencia más crítica?"
  | "FALTANTES_FILL_RATE" // I5-04 -- "¿Qué información falta para calcular Fill Rate?"
  | "ACCION_PRIORITARIA" // I5-05 -- "¿Qué acción debería evaluar primero?"
  | "CAMBIOS_ULTIMO_PULSO"; // I5-06 -- "¿Qué cambió desde el último pulso?"

// Las 6 entradas, en el mismo orden que MVP-DEFINITIVO.md §12.1 -- usado
// para iterar exhaustivamente en pruebas (catalogo.test.ts) sin duplicar
// la lista a mano.
export const CATALOGO_CONSULTA_IDS: readonly CatalogoConsultaId[] = [
  "OTIF_CAIDA",
  "OTIF_PROVEEDOR_RETRASOS",
  "DEPENDENCIA_CRITICA",
  "FALTANTES_FILL_RATE",
  "ACCION_PRIORITARIA",
  "CAMBIOS_ULTIMO_PULSO",
];

export interface PeriodoConsulta {
  inicio: Date;
  fin: Date;
}

// I5-10 -- cadenaId siempre se valida contra el tenant de la sesion (ver
// ejecutarConsultaPermitida.ts); empresaId NUNCA viaja en este tipo, sale
// siempre de requireSession() en la ruta API, nunca del cliente.
export interface EntradaConsultaPermitida {
  catalogoId: CatalogoConsultaId;
  cadenaId: string;
  periodo: PeriodoConsulta;
}

/**
 * Contrato de respuesta exitosa -- los 10 elementos obligatorios de
 * MVP-DEFINITIVO.md §12.3 (I5-15..I5-24), uno por campo. `hecho` e
 * `interpretacion` son campos DISTINTOS a proposito (I5-21/I5-29: la
 * separacion debe ser estructuralmente verificable, nunca solo textual).
 */
export interface RespuestaConsultaOk {
  ok: true;
  catalogoId: CatalogoConsultaId;
  respuestaDirecta: string; // I5-15
  periodo: { inicio: string; fin: string }; // I5-16 (ISO AAAA-MM-DD)
  filtros: Record<string, string | number | boolean>; // I5-16
  fuente: string; // I5-17
  formula: string; // I5-18
  numerador: number | null; // I5-19
  denominador: number | null; // I5-19
  calidad: { faltantes: string[]; cobertura: number }; // I5-20
  hecho: string; // I5-21 (el dato calculado, sin juicio)
  interpretacion: string; // I5-21 (lectura limitada y trazable del hecho, NUNCA una causa inventada)
  accion: string; // I5-22 (siguiente accion o verificacion sugerida)
  comoComprobar: string; // I5-23
  ruleVersion: string; // I5-24
}

/**
 * I5-25 -- caso sin datos suficientes. NUNCA coexiste con un campo
 * numerico de resultado (ver prueba negativa obligatoria en
 * ejecutarConsultaPermitida.test.ts): el tipo discriminado por `ok`
 * hace esta garantia estructural, no solo convencional.
 */
export interface RespuestaConsultaSinDatos {
  ok: false;
  catalogoId: CatalogoConsultaId;
  error: "SIN_DATOS_SUFICIENTES";
  mensaje: string; // siempre "No puedo responder todavía" o equivalente, nunca un numero
  camposFaltantes: string[];
  comoIngresarlos: string;
}

export type RespuestaConsulta = RespuestaConsultaOk | RespuestaConsultaSinDatos;

/**
 * I5-08 -- una entrada de catalogo. `ejecutor` NO vive aca (ver
 * CatalogoConsulta en infra/queries/catalogo.ts): este tipo es el
 * contrato PURO de metadata, sin importar Prisma ni el engine, para que
 * pueda exponerse tal cual via API/UI sin filtrar detalles de
 * implementacion.
 */
export interface MetadatosCatalogoConsulta {
  id: CatalogoConsultaId;
  titulo: string;
  descripcion: string;
  dependenciasDatos: readonly string[];
  requierePeriodo: boolean;
  permisos: readonly RolConsulta[];
  comportamientoSinDatos: string;
  ruleVersion: string;
}

export type RolConsulta = "ADMINISTRADOR" | "RESPONSABLE";

/** Helper de exhaustividad (Seccion 6: "uniones discriminadas y
 * exhaustividad en vez de strings abiertos") -- si un switch sobre
 * CatalogoConsultaId no cubre un caso, TypeScript marca `valor` como
 * `never` en la rama default y esta funcion no compila, nunca un
 * fallback silencioso en runtime. */
export function nuncaOcurre(valor: never, contexto: string): never {
  throw new Error(`${contexto}: valor inesperado ${JSON.stringify(valor)}`);
}
