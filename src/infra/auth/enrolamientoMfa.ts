// Infraestructura — enrolamiento seguro de MFA para un administrador ya
// autenticado que todavia no tiene mfaSecret (ADR-0003).
//
// Caso real que motiva esto: un usuario creado con crearUsuarioResponsable()
// (aceptarInvitacion.ts) queda con rol RESPONSABLE y mfaSecret en null a
// proposito -- MFA para ese rol queda diferido, ver el comentario de ese
// archivo. Si mas tarde alguien cambia el campo `rol` de ese usuario a
// ADMINISTRADOR por fuera del flujo normal (Prisma Studio, un script, una
// migracion de datos) -- es decir, sin pasar por registrarEmpresaYAdmin()
// (registro.ts), que hasta ahora era el UNICO lugar que generaba un
// mfaSecret -- el usuario sigue sin secreto. El middleware (src/middleware.ts)
// lo manda de todos modos a /activar-mfa por ser ADMINISTRADOR sin
// mfaHabilitado, y esa pagina no tenia ningun camino para ese caso: antes
// de esta funcion, `!usuario.mfaSecret` redirigia derecho a /login sin
// explicar nada (el administrador quedaba sin forma de activar MFA).
//
// Esta funcion es el unico lugar, ademas de registro.ts, que genera un
// mfaSecret -- y lo hace de forma idempotente: si el usuario ya tiene uno
// (incluso a medio activar, con mfaHabilitado todavia en false), lo
// devuelve tal cual y NUNCA lo regenera. Regenerarlo invalidaria
// cualquier avance que el usuario ya hizo en su app de autenticador
// (requisito explicito: "sin regenerar secretos existentes").
//
// No toca nada mas del usuario -- password, empresaId, rol, eslabonId,
// etc. quedan exactamente como estaban: el update() de abajo escribe un
// solo campo. mfaHabilitado sigue en su valor actual (false) hasta que
// /api/mfa/activar valide un codigo TOTP real -- esta funcion nunca lo
// marca en true.
//
// Nunca loguea el secreto ni la URL otpauth:// que se construye a partir
// de el (ver ActivarMfaPage) -- ambos solo viajan hacia la respuesta que
// renderiza el QR para el propio usuario en sesion.
import { tenantClient } from "../prisma/tenantClient";
import { generarSecretoMfa } from "./mfa";

export interface UsuarioParaEnrolamientoMfa {
  id: string;
  email: string;
  mfaSecret: string | null;
}

export async function asegurarSecretoMfa(
  empresaId: string,
  usuario: UsuarioParaEnrolamientoMfa,
): Promise<string> {
  if (usuario.mfaSecret) {
    return usuario.mfaSecret;
  }

  const { secretoBase32 } = generarSecretoMfa(usuario.email);

  // Update, no upsert: este usuario ya existe (viene de una sesion
  // autenticada real via /activar-mfa) -- solo se agrega el secreto que
  // le faltaba, nada mas del registro cambia.
  await tenantClient(empresaId).usuario.update({
    where: { id: usuario.id },
    data: { mfaSecret: secretoBase32 },
  });

  return secretoBase32;
}
