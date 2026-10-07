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
//
// Correccion acotada (Alex, 2026-10-04, autorizada sobre
// diagnostico-eliminacion-cuenta-prueba.md Seccion 10 /
// revocacion-sesion-despliegue.md): esta ruta seguia con su propio chequeo
// manual de sesion (`session?.user?.empresaId` + `.email`), sin pasar por
// requireSession() -- era la unica ruta que quedaba fuera del mecanismo de
// revocacion de sesiones (ver el comentario de session.ts, R5-12: "estos
// dos helpers son el unico lugar que arma la respuesta 401/403"). Un JWT de
// un usuario eliminado o con la sesion revocada seguia pudiendo activar
// MFA. Corregido usando requireSession(), que ya decodifica el JWT,
// verifica sessionVersion contra la base (fail-closed,
// verificarSesionVigente() en sessionVerification.ts) y devuelve el mismo
// 401 generico sin distinguir el motivo al cliente (ELIMINADA / REVOCADA /
// ERROR_VERIFICACION) -- sin exigir que mfaHabilitado ya sea true, ese
// chequeo (usuario.mfaSecret) sigue igual mas abajo, sin cambios.
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { verificarCodigoMfa } from "@/infra/auth/mfa";
import { estaBloqueado, registrarIntentoFallido } from "@/infra/auth/rateLimit";
import { logError } from "@/infra/log";

export async function POST(request: Request) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  try {
    const body = await request.json().catch(() => null);
    const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : "";

    const usuario = await tenantClient(sesion.empresaId).usuario.findFirst({
      where: { email: sesion.email },
    });

    if (!usuario || !usuario.mfaSecret) {
      return NextResponse.json({ ok: false, error: "SIN_SECRETO" }, { status: 400 });
    }

    if (estaBloqueado(usuario.bloqueadoHasta)) {
      return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 400 });
    }

    if (!verificarCodigoMfa(usuario.mfaSecret, codigo)) {
      await registrarIntentoFallido(sesion.empresaId, usuario.id);
      return NextResponse.json({ ok: false, error: "CODIGO_INVALIDO" }, { status: 400 });
    }

    await tenantClient(sesion.empresaId).usuario.update({
      where: { id: usuario.id },
      data: { mfaHabilitado: true },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("api/mfa/activar", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
