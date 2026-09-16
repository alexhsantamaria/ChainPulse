// Ruta API — confirma el codigo TOTP y activa MFA para el usuario en sesion (ADR-0003).
//
// Ronda 5 de revision (R5-9, MEDIO): esta ruta verificaba
// `session?.user?.email` en vez de `session?.user?.empresaId` como el
// resto de las rutas (una sesion sin empresaId, que no deberia poder
// pasar en la practica, hubiera roto tenantClient() sin capturarse), y no
// tenia try/catch -- corregido para seguir el mismo patron que el resto
// de la API. Ademas, mismo fix que R5-1 (src/auth.ts): un codigo invalido
// aca tambien cuenta como intento fallido -- esta ruta exige sesion
// valida, pero un token de sesion robado igual podria usarse para
// fuerza-brutear el codigo de activacion sin este limite.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { verificarCodigoMfa } from "@/infra/auth/mfa";
import { estaBloqueado, registrarIntentoFallido } from "@/infra/auth/rateLimit";
import { logError } from "@/infra/log";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : "";

    const usuario = await tenantClient(session.user.empresaId).usuario.findFirst({
      where: { email: session.user.email },
    });

    if (!usuario || !usuario.mfaSecret) {
      return NextResponse.json({ ok: false, error: "SIN_SECRETO" }, { status: 400 });
    }

    if (estaBloqueado(usuario.bloqueadoHasta)) {
      return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 400 });
    }

    if (!verificarCodigoMfa(usuario.mfaSecret, codigo)) {
      await registrarIntentoFallido(session.user.empresaId, usuario.id);
      return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 400 });
    }

    await tenantClient(session.user.empresaId).usuario.update({
      where: { id: usuario.id },
      data: { mfaHabilitado: true },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("api/mfa/activar", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
