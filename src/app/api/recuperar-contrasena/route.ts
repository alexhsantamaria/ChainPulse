// Ruta API publica — pide un enlace para recuperar la contraseña.
import { NextResponse } from "next/server";
import { z } from "zod";
import { buscarUsuarioPorEmail } from "@/infra/auth/loginLookup";
import { crearTokenRecuperacion } from "@/infra/auth/recuperacion";
import { enviarCorreoRecuperacion } from "@/infra/email/resend";

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  // Sin enumeracion de cuentas (mismo criterio que el login, ADR-0003): la
  // respuesta es exactamente la misma exista o no el email, y aunque el
  // envio de correo falle -- nunca revela por HTTP si la cuenta existe ni
  // si el correo salio. Los errores reales quedan solo en el log del
  // servidor, igual que abrirCiclo.ts con el aviso de ciclo.
  try {
    const usuario = await buscarUsuarioPorEmail(parsed.data.email);
    if (usuario) {
      const token = await crearTokenRecuperacion(usuario);
      const origen = request.headers.get("origin") ?? new URL(request.url).origin;
      const link = `${origen}/recuperar-contrasena/confirmar?token=${encodeURIComponent(token)}`;
      await enviarCorreoRecuperacion({ email: usuario.email, nombre: usuario.nombre, link });
    }
  } catch (err) {
    console.error(err);
  }

  return NextResponse.json({ ok: true });
}
