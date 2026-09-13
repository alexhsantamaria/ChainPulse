// Ruta API — un administrador invita a un responsable de eslabon por correo (RF4).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { buscarUsuarioPorEmail } from "@/infra/auth/loginLookup";
import { crearTokenInvitacion } from "@/infra/auth/invitacion";
import { enviarInvitacionResponsable } from "@/infra/email/resend";

const invitarSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  eslabonId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }
  // RF4 es una accion de administrador -- un RESPONSABLE no invita a otros.
  if (session.user.rol !== "ADMINISTRADOR") {
    return NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = invitarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const client = tenantClient(session.user.empresaId);
  const [eslabon, empresa, usuarioExistente] = await Promise.all([
    client.eslabon.findUnique({ where: { id: parsed.data.eslabonId } }),
    client.empresa.findUnique({ where: { id: session.user.empresaId } }),
    buscarUsuarioPorEmail(parsed.data.email),
  ]);

  if (!eslabon || !empresa) {
    return NextResponse.json({ ok: false, error: "ESLABON_INEXISTENTE" }, { status: 400 });
  }
  if (usuarioExistente) {
    return NextResponse.json({ ok: false, error: "EMAIL_YA_REGISTRADO" }, { status: 409 });
  }

  const token = await crearTokenInvitacion({
    empresaId: session.user.empresaId,
    eslabonId: eslabon.id,
    email: parsed.data.email,
  });

  const origen = request.headers.get("origin") ?? new URL(request.url).origin;
  const linkInvitacion = `${origen}/invitacion/aceptar?token=${encodeURIComponent(token)}`;

  try {
    await enviarInvitacionResponsable({
      email: parsed.data.email,
      empresaNombre: empresa.nombre,
      eslabonNombre: eslabon.nombre,
      linkInvitacion,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_ENVIO_CORREO" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
