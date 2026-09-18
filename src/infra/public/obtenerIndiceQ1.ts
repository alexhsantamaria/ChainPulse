// Infraestructura publica — resuelve el indiceOpcion de Q1 ya persistido
// para una evaluacion (necesario para reordenar hallazgos ya guardados,
// ver ordenarHallazgosPersistidos.ts). `client` tipado ancho a proposito
// (Prisma.TransactionClient) para poder pasar tanto el cliente base como
// un `tx` dentro de una transaccion -- mismo criterio de inyeccion
// explicita que src/infra/rateLimit/limiteTasa.ts.
import type { Prisma } from "@prisma/client";
import { parsearOpciones, resolverOrdenPorValor } from "./opciones";

export async function obtenerIndiceOpcionQ1(
  client: Prisma.TransactionClient,
  evaluacionExpresV2Id: string,
): Promise<number | null> {
  const respuesta = await client.respuesta.findFirst({
    where: { evaluacionExpresV2Id, preguntaVersion: { codigo: "Q1" } },
    include: { preguntaVersion: true },
  });
  if (!respuesta) return null;
  if (respuesta.opcionSeleccionada === null) return 0;
  const opciones = parsearOpciones(respuesta.preguntaVersion.opciones, "PreguntaVersion Q1");
  return resolverOrdenPorValor(opciones, respuesta.opcionSeleccionada) ?? 0;
}
