// Ruta API — agrega una ConexionCadena a una Cadena ya existente,
// directamente desde el canvas del mapa (RF29/RF34, requirements.md
// Seccion 14). Dos modelos (ConexionCadena + FlujoConexionCadena) deben
// confirmarse juntos -> agregarConexionCadenaAtomico() (tenantTransaction),
// mismo criterio que crearCadenaCompleta.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import {
  agregarConexionCadenaAtomico,
  ConexionCadenaNodoInvalidoError,
  ConexionCadenaDuplicadaError,
} from "@/infra/mapa/agregarConexionCadena";
import { logError } from "@/infra/log";

// Mismos 5 valores que TipoFlujoV2 (prisma/schema.prisma), no importados
// de "@prisma/client" -- mismo criterio que el resto de las rutas de
// Bloque B (ADR-0003).
const TIPOS_FLUJO = ["PRODUCTO_SERVICIO", "INFORMACION", "DINERO", "DECISION", "DEVOLUCION"] as const;

// Ids de los 4 Handle de NodoCadenaVisual (MapaCadenaCanvas.tsx) -- ver el
// comentario de cabecera de la migracion
// 20260923070000_conexion_cadena_handle_lados.
const LADOS_HANDLE = ["top", "right", "bottom", "left"] as const;

const conexionCadenaSchema = z
  .object({
    origenNodoId: z.string().min(1),
    destinoNodoId: z.string().min(1),
    flujos: z.array(z.enum(TIPOS_FLUJO)).min(1),
    origenHandleId: z.enum(LADOS_HANDLE).nullish(),
    destinoHandleId: z.enum(LADOS_HANDLE).nullish(),
  })
  .refine((datos) => datos.origenNodoId !== datos.destinoNodoId, {
    message: "origenNodoId y destinoNodoId no pueden ser el mismo nodo",
    path: ["destinoNodoId"],
  });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { id: cadenaId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = conexionCadenaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  // Confirma que la Cadena existe Y pertenece a este tenant antes de
  // entrar a la transaccion -- mismo criterio que la ruta de nodos.
  const cadena = await tenantClient(sesion.empresaId).cadena.findUnique({ where: { id: cadenaId } });
  if (!cadena) {
    return NextResponse.json({ ok: false, error: "CADENA_INEXISTENTE" }, { status: 404 });
  }

  try {
    const resultado = await agregarConexionCadenaAtomico(sesion.empresaId, {
      cadenaId,
      origenNodoId: parsed.data.origenNodoId,
      destinoNodoId: parsed.data.destinoNodoId,
      flujos: parsed.data.flujos,
      origenHandleId: parsed.data.origenHandleId,
      destinoHandleId: parsed.data.destinoHandleId,
    });
    return NextResponse.json({ ok: true, conexionCadenaId: resultado.conexionCadenaId });
  } catch (err) {
    if (err instanceof ConexionCadenaNodoInvalidoError) {
      return NextResponse.json({ ok: false, error: "NODO_INVALIDO" }, { status: 400 });
    }
    if (err instanceof ConexionCadenaDuplicadaError) {
      return NextResponse.json({ ok: false, error: "CONEXION_CADENA_DUPLICADA" }, { status: 409 });
    }
    logError("api/cadenas/[id]/conexiones POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
