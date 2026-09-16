// Ruta API — declara los eslabones de la cadena de suministro del tenant (RF2).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { logError } from "@/infra/log";

const eslabonSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  esProveedorExterno: z.boolean().optional().default(false),
});

export async function GET() {
  const resultado = await requireSession();
  if ("respuesta" in resultado) return resultado.respuesta;

  const eslabones = await tenantClient(resultado.sesion.empresaId).eslabon.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ ok: true, eslabones });
}

export async function POST(request: Request) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const body = await request.json().catch(() => null);
  const parsed = eslabonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  // R5-24 -- a diferencia del resto de las rutas de escritura, esta no
  // tenia try/catch: un error transitorio de conexion a Neon se
  // propagaba como 500 HTML no estructurado (que ademas disparaba R5-8
  // del lado del formulario cliente antes de esa correccion).
  try {
    const eslabon = await tenantClient(sesion.empresaId).eslabon.create({
      data: { ...parsed.data, empresaId: sesion.empresaId },
    });
    return NextResponse.json({ ok: true, eslabon });
  } catch (err) {
    logError("api/eslabones POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
