// Ruta API publica — pide un enlace para recuperar la contraseña.
import { NextResponse } from "next/server";
import { z } from "zod";
import { buscarUsuarioPorEmail } from "@/infra/auth/loginLookup";
import { crearTokenRecuperacion } from "@/infra/auth/recuperacion";
import { enviarCorreoRecuperacion } from "@/infra/email/resend";
import { logError } from "@/infra/log";
import { conPisoDeTiempo, PISO_TIEMPO_AUTENTICACION_MS } from "@/infra/timing";

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

async function procesarSolicitud(email: string, origen: string): Promise<void> {
  // Sin enumeracion de cuentas (mismo criterio que el login, ADR-0003): la
  // respuesta es exactamente la misma exista o no el email, y aunque el
  // envio de correo falle -- nunca revela por HTTP si la cuenta existe ni
  // si el correo salio. Los errores reales quedan solo en el log del
  // servidor, igual que abrirCiclo.ts con el aviso de ciclo.
  try {
    const usuario = await buscarUsuarioPorEmail(email);
    if (usuario) {
      const token = await crearTokenRecuperacion(usuario);
      const link = `${origen}/recuperar-contrasena/confirmar?token=${encodeURIComponent(token)}`;
      await enviarCorreoRecuperacion({ email: usuario.email, nombre: usuario.nombre, link });
    }
  } catch (err) {
    logError("api/recuperar-contrasena", err);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  // El origen se calcula aqui, a partir de la peticion entrante (igual que
  // en invitaciones/route.ts), y se pasa como parametro: procesarSolicitud
  // no depende de request.headers, solo de los valores que necesita.
  const origen = request.headers.get("origin") ?? new URL(request.url).origin;

  // R5-2 (Ronda 5, ALTO) -- timing attack de enumeracion de cuentas: antes
  // de esta correccion, si el email no existia la respuesta volvia casi
  // de inmediato; si existia, corria crearTokenRecuperacion() y llamaba a
  // la API de Resend antes de responder -- una diferencia de tiempo
  // medible que revelaba la existencia de la cuenta pese a que el CONTENIDO
  // de la respuesta ya era identico en ambos casos. Envuelto en el mismo
  // piso de tiempo fijo que src/auth.ts (ver src/infra/timing.ts).
  await conPisoDeTiempo(procesarSolicitud(parsed.data.email, origen), PISO_TIEMPO_AUTENTICACION_MS);

  return NextResponse.json({ ok: true });
}
