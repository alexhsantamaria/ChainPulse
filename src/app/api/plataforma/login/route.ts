import { NextResponse } from "next/server";
import {
  COOKIE_PREAUTH_PLATAFORMA,
  crearTokenPreauthPlataforma,
  opcionesCookiePreauthPlataforma,
} from "@/auth.config.plataforma";
import { verifyPassword } from "@/infra/auth/password";
import {
  buscarUsuarioPlataformaPorEmail,
  registrarIntentoFallidoPlataforma,
  restablecerIntentosPlataforma,
} from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { prisma } from "@/infra/prisma/client";
import { extraerHuellaOrigenCruda } from "@/infra/public/huellaOrigen";
import { hashHuellaOrigen, registrarIntento } from "@/infra/rateLimit/limiteTasa";
import {
  LIMITE_LOGIN_PLATAFORMA_POR_HUELLA,
  calcularRetryAfterSegundos,
} from "@/infra/rateLimit/limitesPlataforma";
import { loginPlataformaSchema } from "./schema";

const RESPUESTA_CREDENCIALES_INVALIDAS = { ok: false, error: "CREDENCIALES_INVALIDAS" } as const;

// Generado una sola vez con Argon2id sobre una cadena aleatoria que no es
// contraseña de ninguna cuenta. Solo iguala el costo de la rama inexistente.
const HASH_SENUELO_LOGIN_PLATAFORMA =
  "$argon2id$v=19$m=19456,t=2,p=1$XV3o6WoNo3pYGv2Z7AaS1g$l5s9uK/QeL/UUu1fJ0XXE2eAE1XTPAyT/1gSe/UdPW4";

function credencialesInvalidas() {
  return NextResponse.json(RESPUESTA_CREDENCIALES_INVALIDAS, { status: 401 });
}

export async function POST(request: Request) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  try {
    const ahora = new Date();
    const huellaHash = hashHuellaOrigen(extraerHuellaOrigenCruda(request.headers));
    const limite = await registrarIntento(
      huellaHash,
      "LOGIN_PLATAFORMA",
      LIMITE_LOGIN_PLATAFORMA_POR_HUELLA,
      ahora,
      prisma,
      1,
    );
    if (!limite.permitido) {
      return NextResponse.json(
        { ok: false, error: "LIMITE_TASA_EXCEDIDO" },
        { status: 429, headers: { "Retry-After": String(calcularRetryAfterSegundos(ahora)) } },
      );
    }

    const parsed = loginPlataformaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return credencialesInvalidas();

    const fila = await buscarUsuarioPlataformaPorEmail(parsed.data.email);
    if (!fila) {
      await verifyPassword(HASH_SENUELO_LOGIN_PLATAFORMA, parsed.data.password);
      return credencialesInvalidas();
    }

    const passwordOk = await verifyPassword(fila.passwordHash, parsed.data.password);
    const bloqueada = fila.bloqueadoHasta !== null && fila.bloqueadoHasta > ahora;
    if (bloqueada) return credencialesInvalidas();
    if (!passwordOk) {
      await registrarIntentoFallidoPlataforma(fila.id);
      return credencialesInvalidas();
    }
    if (!fila.activo) return credencialesInvalidas();

    if (!(await restablecerIntentosPlataforma(fila.id))) return credencialesInvalidas();
    const token = await crearTokenPreauthPlataforma(fila.id);
    const respuesta = NextResponse.json({
      ok: true,
      siguiente: fila.mfaHabilitado ? "/plataforma/verificar-mfa" : "/plataforma/activar-mfa",
    });
    respuesta.cookies.set(COOKIE_PREAUTH_PLATAFORMA, token, opcionesCookiePreauthPlataforma);
    return respuesta;
  } catch {
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
