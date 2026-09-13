// Ruta API — declara los eslabones de la cadena de suministro del tenant (RF2).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";

const eslabonSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  esProveedorExterno: z.boolean().optional().default(false),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  const eslabones = await tenantClient(session.user.empresaId).eslabon.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ ok: true, eslabones });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = eslabonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const eslabon = await tenantClient(session.user.empresaId).eslabon.create({
    data: parsed.data,
  });

  return NextResponse.json({ ok: true, eslabon });
}
