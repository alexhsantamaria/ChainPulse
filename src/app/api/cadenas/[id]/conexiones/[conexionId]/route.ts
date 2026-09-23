// Ruta API — borra o edita los Flujos de una ConexionCadena YA EXISTENTE,
// directamente desde el canvas del mapa (RF34 extension post-lanzamiento:
// Alex probo el mapa 2026-09-23 y pidio poder borrar/cambiar una conexion
// ya creada, ver el comentario de cabecera de MapaCadenaCanvas.tsx).
//
// DELETE -- borra la conexion. Un solo modelo tenant-scoped
// (ConexionCadena) -> tenantClient() alcanza (mismo criterio que la ruta
// de nodos); FlujoConexionCadena.conexionCadena tiene onDelete: Cascade
// (prisma/schema.prisma) asi que sus filas hijas se borran solas, sin
// necesidad de limpieza manual.
//
// PATCH -- reemplaza los flujos de la conexion (borrar + crear no puede
// quedar a medio camino) -> actualizarFlujosConexionCadenaAtomico()
// (tenantTransaction), mismo criterio que agregarConexionCadenaAtomico().
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import {
  actualizarFlujosConexionCadenaAtomico,
  ConexionCadenaInexistenteError,
  ConexionCadenaSinFlujosError,
} from "@/infra/mapa/actualizarFlujosConexionCadena";
import { logError } from "@/infra/log";

// Mismos 5 valores que TipoFlujoV2 (prisma/schema.prisma), no importados
// de "@prisma/client" -- mismo criterio que el resto de las rutas de
// Bloque B (ADR-0003).
const TIPOS_FLUJO = ["PRODUCTO_SERVICIO", "INFORMACION", "DINERO", "DECISION", "DEVOLUCION"] as const;

const flujosSchema = z.object({
  flujos: z.array(z.enum(TIPOS_FLUJO)).min(1),
});

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; conexionId: string }> }) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { id: cadenaId, conexionId } = await context.params;
  const client = tenantClient(sesion.empresaId);

  // Confirma que la conexion existe, pertenece a este tenant (tenantClient
  // ya inyecta el filtro de empresaId, RNF1) Y pertenece a la Cadena
  // indicada en la URL, mismo criterio que la ruta de nodos.
  const conexion = await client.conexionCadena.findUnique({ where: { id: conexionId } });
  if (!conexion || conexion.cadenaId !== cadenaId) {
    return NextResponse.json({ ok: false, error: "CONEXION_CADENA_INEXISTENTE" }, { status: 404 });
  }

  try {
    await client.conexionCadena.delete({ where: { id: conexionId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("api/cadenas/[id]/conexiones/[conexionId] DELETE", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; conexionId: string }> }) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { id: cadenaId, conexionId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = flujosSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  try {
    await actualizarFlujosConexionCadenaAtomico(sesion.empresaId, {
      cadenaId,
      conexionCadenaId: conexionId,
      flujos: parsed.data.flujos,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ConexionCadenaInexistenteError) {
      return NextResponse.json({ ok: false, error: "CONEXION_CADENA_INEXISTENTE" }, { status: 404 });
    }
    if (err instanceof ConexionCadenaSinFlujosError) {
      return NextResponse.json({ ok: false, error: "CONEXION_CADENA_SIN_FLUJOS" }, { status: 400 });
    }
    logError("api/cadenas/[id]/conexiones/[conexionId] PATCH", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
