import { type NextRequest, NextResponse } from "next/server";
import {
  COOKIE_PREAUTH_PLATAFORMA,
  COOKIE_SESION_PLATAFORMA,
  crearTokenSesionPlataforma,
  opcionesCookiePreauthPlataforma,
  opcionesCookieSesionPlataforma,
  verificarTokenPreauthPlataforma,
} from "@/auth.config.plataforma";
import {
  activarMfaPlataforma,
  consumirContadorTotpPlataforma,
  leerMfaPlataforma,
  verificarYCalcularContador,
} from "@/infra/auth/mfaPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { leerEstadoSesionPlataforma } from "@/infra/auth/sessionPlataforma";
import { prisma } from "@/infra/prisma/client";
import { extraerHuellaOrigenCruda } from "@/infra/public/huellaOrigen";
import { hashHuellaOrigen, registrarIntento } from "@/infra/rateLimit/limiteTasa";
import {
  LIMITE_MFA_PLATAFORMA_POR_HUELLA,
  calcularRetryAfterSegundos,
} from "@/infra/rateLimit/limitesPlataforma";

export async function POST(request: NextRequest) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const token = request.cookies.get(COOKIE_PREAUTH_PLATAFORMA)?.value;
  const preauth = token ? await verificarTokenPreauthPlataforma(token) : null;
  if (!preauth) return NextResponse.json({ ok: false, error: "PREAUTH_INVALIDO" }, { status: 401 });

  try {
    const ahora = new Date();
    const huellaHash = hashHuellaOrigen(extraerHuellaOrigenCruda(request.headers));
    const limite = await registrarIntento(
      huellaHash,
      "VERIFICACION_MFA_PLATAFORMA",
      LIMITE_MFA_PLATAFORMA_POR_HUELLA,
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

    const body = await request.json().catch(() => null);
    const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : "";
    const mfa = await leerMfaPlataforma(preauth.usuarioId);
    if (!mfa?.mfaSecret) return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 401 });

    const verificacion = verificarYCalcularContador(mfa.mfaSecret, codigo);
    if (!verificacion.valido || verificacion.contadorAceptado === null) {
      return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 401 });
    }

    const consumido = mfa.mfaHabilitado
      ? await consumirContadorTotpPlataforma(preauth.usuarioId, verificacion.contadorAceptado)
      : await activarMfaPlataforma(preauth.usuarioId, verificacion.contadorAceptado);
    if (!consumido) return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 401 });

    const estado = await leerEstadoSesionPlataforma(preauth.usuarioId);
    if (!estado?.activo) return NextResponse.json({ ok: false, error: "PREAUTH_INVALIDO" }, { status: 401 });

    const sesion = await crearTokenSesionPlataforma({
      usuarioId: preauth.usuarioId,
      rol: estado.rol,
      sessionVersion: estado.sessionVersion,
    });
    const respuesta = NextResponse.json({ ok: true });
    respuesta.cookies.set(COOKIE_SESION_PLATAFORMA, sesion, opcionesCookieSesionPlataforma);
    respuesta.cookies.set(COOKIE_PREAUTH_PLATAFORMA, "", {
      ...opcionesCookiePreauthPlataforma,
      maxAge: 0,
    });
    return respuesta;
  } catch {
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
