// Ruta API — declara Cadenas del mapa (RF27, requirements.md Seccion 14.1).
//
// Solo crea la Cadena en si (nombre/productoServicio/periodo/tipoOperacion)
// -- a proposito, sin nodos ni conexiones en el payload. RF34 exige que
// los nodos y conexiones se creen directamente sobre el mapa visual
// ("sin pasar por una pantalla de formulario separada para cada
// operacion"), asi que esta ruta llama a crearCadenaCompleta() (Bloque A)
// con nodos/conexiones vacios -- esa funcion soporta crear ambos a la vez
// porque el Bloque A la penso para el caso general, pero el unico
// llamador real hasta ahora es este, que siempre manda arrays vacios. La
// creacion de un Nodo o una ConexionCadena individual sobre una Cadena ya
// existente es responsabilidad de rutas propias del Bloque B (canvas).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { crearCadenaCompleta } from "@/infra/mapa/crearCadenaCompleta";
import { logError } from "@/infra/log";

// Mismos 5 valores que PLAN-DE-TRABAJO.md (Seccion "Diseno de
// Cadena/Nodo/ConexionCadena") -- tipoOperacion es String en el schema,
// no un enum de Prisma, pero se restringe igual a este catalogo cerrado
// en el borde (Zod), mismo criterio que el resto de las rutas del
// proyecto.
const TIPOS_OPERACION = ["manufactura", "distribucion", "comercio", "servicios", "otra"] as const;

const cadenaSchema = z
  .object({
    nombre: z.string().trim().min(2).max(160),
    productoServicio: z.string().trim().min(2).max(200),
    periodoInicio: z.coerce.date(),
    periodoFin: z.coerce.date(),
    tipoOperacion: z.enum(TIPOS_OPERACION),
  })
  .refine((datos) => datos.periodoFin > datos.periodoInicio, {
    message: "periodoFin debe ser posterior a periodoInicio",
    path: ["periodoFin"],
  });

export async function GET() {
  const resultado = await requireSession();
  if ("respuesta" in resultado) return resultado.respuesta;

  const cadenas = await tenantClient(resultado.sesion.empresaId).cadena.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ ok: true, cadenas });
}

export async function POST(request: Request) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const body = await request.json().catch(() => null);
  const parsed = cadenaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  try {
    const resultado = await crearCadenaCompleta(sesion.empresaId, {
      nombre: parsed.data.nombre,
      productoServicio: parsed.data.productoServicio,
      periodoInicio: parsed.data.periodoInicio,
      periodoFin: parsed.data.periodoFin,
      tipoOperacion: parsed.data.tipoOperacion,
      nodos: [],
      conexiones: [],
    });
    return NextResponse.json({ ok: true, cadenaId: resultado.cadenaId });
  } catch (err) {
    logError("api/cadenas POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
