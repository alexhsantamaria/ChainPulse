// Ruta API publica — confirma la recuperacion, fija la contraseña nueva.
import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarTokenRecuperacion } from "@/infra/auth/recuperacion";
import { hashPassword } from "@/infra/auth/password";
import { tenantClient } from "@/infra/prisma/tenantClient";

const schema = z.object({ token: z.string().min(1), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const usuario = await verificarTokenRecuperacion(parsed.data.token);
  if (!usuario) {
    return NextResponse.json({ ok: false, error: "TOKEN_INVALIDO" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await tenantClient(usuario.empresaId).usuario.update({
    where: { id: usuario.id },
    data: {
      passwordHash,
      // Un reset exitoso es buena señal de que la cuenta volvio a manos de
      // su dueño -- se limpia cualquier bloqueo por intentos fallidos
      // previos, mismo espiritu que resetearIntentos() en el login.
      intentosFallidos: 0,
      bloqueadoHasta: null,
    },
  });

  return NextResponse.json({ ok: true });
}
