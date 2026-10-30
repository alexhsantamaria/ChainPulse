import { type NextRequest, NextResponse } from "next/server";
import {
  COOKIE_PREAUTH_PLATAFORMA,
  verificarTokenPreauthPlataforma,
} from "@/auth.config.plataforma";
import {
  construirOtpauthUrlMfaPlataforma,
  enrolarMfaPlataforma,
  generarSecretoMfaPlataforma,
} from "@/infra/auth/mfaPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";

export async function POST(request: NextRequest) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const token = request.cookies.get(COOKIE_PREAUTH_PLATAFORMA)?.value;
  const preauth = token ? await verificarTokenPreauthPlataforma(token) : null;
  if (!preauth) {
    return NextResponse.json({ ok: false, error: "PREAUTH_INVALIDO" }, { status: 401 });
  }

  try {
    const candidato = generarSecretoMfaPlataforma(preauth.usuarioId);
    const resultado = await enrolarMfaPlataforma(preauth.usuarioId, candidato.secretoBase32);
    if (!resultado?.ok || !resultado.secretoEfectivo) {
      return NextResponse.json({ ok: false, error: resultado?.motivo ?? "ENROLAMIENTO_INVALIDO" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      otpauthUrl: construirOtpauthUrlMfaPlataforma(preauth.usuarioId, resultado.secretoEfectivo),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
