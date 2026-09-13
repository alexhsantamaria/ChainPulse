// Ruta API — acepta una invitacion y crea la cuenta del responsable (RF4).
import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarTokenInvitacion } from "@/infra/auth/invitacion";
import { crearUsuarioResponsable } from "@/infra/auth/aceptarInvitacion";
import { EmailYaRegistradoError } from "@/infra/auth/errores";

const aceptarSchema = z.object({
  token: z.string().min(1),
  nombre: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = aceptarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const payload = await verificarTokenInvitacion(parsed.data.token);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "TOKEN_INVALIDO" }, { status: 400 });
  }

  try {
    await crearUsuarioResponsable({
      empresaId: payload.empresaId,
      eslabonId: payload.eslabonId,
      email: payload.email,
      nombre: parsed.data.nombre,
      password: parsed.data.password,
    });
  } catch (err) {
    if (err instanceof EmailYaRegistradoError) {
      return NextResponse.json({ ok: false, error: "EMAIL_YA_REGISTRADO" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
