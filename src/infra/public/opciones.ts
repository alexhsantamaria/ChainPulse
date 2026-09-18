// Infraestructura publica — helpers puros sobre PreguntaVersion.opciones
// (Json en el schema, sin tabla propia -- ver comentario en
// prisma/schema.prisma). El motor v2 solo consume la posicion ordinal
// (RespuestaPreguntaV2.indiceOpcion), asi que esta es la unica pieza del
// proyecto que traduce entre el "valor" (slug) que ve el cliente HTTP y el
// "orden" (0-based) que espera el motor.
export interface OpcionPregunta {
  valor: string;
  texto: string;
  orden: number;
}

/** Type guard minimo -- el campo es Json en Prisma, sin tipo propio en runtime. */
export function esOpcionPregunta(valor: unknown): valor is OpcionPregunta {
  return (
    typeof valor === "object" &&
    valor !== null &&
    typeof (valor as OpcionPregunta).valor === "string" &&
    typeof (valor as OpcionPregunta).texto === "string" &&
    typeof (valor as OpcionPregunta).orden === "number"
  );
}

export function parsearOpciones(opciones: unknown, contexto: string): OpcionPregunta[] {
  if (!Array.isArray(opciones) || !opciones.every(esOpcionPregunta)) {
    throw new Error(`PreguntaVersion.opciones con forma invalida para ${contexto}.`);
  }
  return opciones;
}

/** Devuelve el "orden" (0-based) de la opcion cuyo "valor" coincide, o undefined si no existe. */
export function resolverOrdenPorValor(opciones: OpcionPregunta[], valor: string): number | undefined {
  return opciones.find((opcion) => opcion.valor === valor)?.orden;
}
