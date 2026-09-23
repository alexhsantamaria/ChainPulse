// Ruta API — agrega un Nodo a una Cadena ya existente, directamente desde
// el canvas del mapa (RF28/RF34, requirements.md Seccion 14). Escritura a
// un solo modelo tenant-scoped -> tenantClient() alcanza, no hace falta
// tenantTransaction() (ver el comentario de cabecera de
// tenantTransaction.ts sobre cuando usar cada uno).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { logError } from "@/infra/log";

// Mismos 6 valores que TipoNodo (prisma/schema.prisma) -- no importados
// de "@prisma/client", mismo criterio que crearCadenaCompleta.ts
// (ADR-0003, engineType="client" en este entorno).
const TIPOS_NODO = ["ORGANIZACION", "AREA", "INSTALACION", "PROCESO", "PERSONA_DECISORA", "SISTEMA"] as const;

const nodoSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  tipo: z.enum(TIPOS_NODO),
  // RF28 -- puente opcional a un Eslabon ya existente, nunca exigido.
  eslabonRefId: z.string().min(1).optional().nullable(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { id: cadenaId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = nodoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const client = tenantClient(sesion.empresaId);

  // Confirma que la Cadena existe Y pertenece a este tenant --
  // tenantClient ya inyecta el filtro de empresaId (RNF1).
  const cadena = await client.cadena.findUnique({ where: { id: cadenaId } });
  if (!cadena) {
    return NextResponse.json({ ok: false, error: "CADENA_INEXISTENTE" }, { status: 404 });
  }

  if (parsed.data.eslabonRefId) {
    const eslabon = await client.eslabon.findUnique({ where: { id: parsed.data.eslabonRefId } });
    if (!eslabon) {
      return NextResponse.json({ ok: false, error: "ESLABON_INEXISTENTE" }, { status: 400 });
    }
  }

  try {
    const nodo = await client.nodo.create({
      data: {
        // empresaId explicito, del lado del servidor (sesion autenticada,
        // nunca del payload) -- injectTenantFilter() lo sobrescribe igual
        // en runtime, pero sin pasarlo acá el tipo generado real de
        // Prisma (Windows) exige empresaId como campo no opcional en el
        // create -- mismo patron ya usado en conexiones/route.ts.
        empresaId: sesion.empresaId,
        cadenaId,
        nombre: parsed.data.nombre,
        tipo: parsed.data.tipo,
        eslabonRefId: parsed.data.eslabonRefId ?? null,
      },
    });
    return NextResponse.json({ ok: true, nodo });
  } catch (err) {
    logError("api/cadenas/[id]/nodos POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
