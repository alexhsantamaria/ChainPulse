// Ruta API — persiste la posicion (x, y) que el usuario elige al
// arrastrar un Nodo sobre el canvas del mapa (RF34, extension post-
// lanzamiento -- ver el comentario de cabecera de la migracion
// 20260923050000_nodo_posicion_canvas). Escritura a un solo modelo
// tenant-scoped -> tenantClient() alcanza, mismo criterio que
// nodos/route.ts (POST).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { logError } from "@/infra/log";

const posicionSchema = z.object({
  posX: z.number().finite(),
  posY: z.number().finite(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string; nodoId: string }> }) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { id: cadenaId, nodoId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = posicionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const client = tenantClient(sesion.empresaId);

  // Confirma que el Nodo existe, pertenece a este tenant (tenantClient ya
  // inyecta el filtro de empresaId, RNF1) Y pertenece a la Cadena indicada
  // en la URL -- un nodo de OTRA Cadena de la misma empresa pasaria el
  // filtro de tenant igual, mismo criterio que agregarConexionCadena.ts.
  const nodo = await client.nodo.findUnique({ where: { id: nodoId } });
  if (!nodo || nodo.cadenaId !== cadenaId) {
    return NextResponse.json({ ok: false, error: "NODO_INEXISTENTE" }, { status: 404 });
  }

  try {
    await client.nodo.update({
      where: { id: nodoId },
      data: { posX: parsed.data.posX, posY: parsed.data.posY },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("api/cadenas/[id]/nodos/[nodoId] PATCH", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
