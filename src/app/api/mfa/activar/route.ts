// Ruta API — confirma el codigo TOTP y activa MFA para el usuario en sesion (ADR-0003).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { verificarCodigoMfa } from "@/infra/auth/mfa";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : "";

  const usuario = await tenantClient(session.user.empresaId).usuario.findFirst({
    where: { email: session.user.email },
  });

  if (!usuario || !usuario.mfaSecret) {
    return NextResponse.json({ ok: false, error: "SIN_SECRETO" }, { status: 400 });
  }

  if (!verificarCodigoMfa(usuario.mfaSecret, codigo)) {
    return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 400 });
  }

  await tenantClient(session.user.empresaId).usuario.update({
    where: { id: usuario.id },
    data: { mfaHabilitado: true },
  });

  return NextResponse.json({ ok: true });
}
