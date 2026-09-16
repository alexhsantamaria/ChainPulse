// Infraestructura — configuracion de Auth.js / NextAuth v5 (ADR-0003).
//
// El campo "codigoMfa" del formulario de login es siempre visible pero
// opcional: no revelamos si una cuenta tiene MFA activado (evita
// enumeracion de cuentas, mismo criterio que un reset de contraseña —
// ADR-0003 / OWASP A07). Todas las fallas (email inexistente, password
// incorrecta, cuenta bloqueada, MFA faltante o invalido) devuelven el
// mismo resultado (null / "credenciales invalidas"), sin distinguir el
// motivo real al cliente.
//
// Ronda 5 de revision (R5-1, CRITICO): un codigo MFA incorrecto NO
// contaba como intento fallido -- solo la contraseña lo hacia. Con la
// contraseña ya comprometida (filtrada, phishing, reuso), el codigo TOTP
// de 6 digitos se podia fuerza-brutear sin ningun limite, anulando el
// proposito de MFA justo en el escenario que deberia frenar. Corregido:
// un MFA invalido pasa por el mismo registrarIntentoFallido() que una
// contraseña invalida, mismo contador y mismo bloqueo temporal.
//
// Ronda 5 (R5-2, ALTO): timing attack de enumeracion de cuentas -- cuando
// el email no existe, authorize() volvia casi de inmediato; cuando existe,
// corria Argon2id (lento a proposito) antes de responder, una diferencia
// de tiempo medible que contradecia el "sin enumeracion" de mas arriba.
// Corregido envolviendo todo el cuerpo en conPisoDeTiempo(): la respuesta
// nunca sale antes del piso fijo, exista o no la cuenta.
//
// La configuracion base (session, pages, callbacks jwt/session) vive en
// auth.config.ts, compartida con el middleware edge-safe — ver el
// comentario de ese archivo para el porque de la separacion.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { buscarUsuarioPorEmail } from "@/infra/auth/loginLookup";
import { verifyPassword } from "@/infra/auth/password";
import { verificarCodigoMfa } from "@/infra/auth/mfa";
import { estaBloqueado, registrarIntentoFallido, resetearIntentos } from "@/infra/auth/rateLimit";
import { conPisoDeTiempo, PISO_TIEMPO_AUTENTICACION_MS } from "@/infra/timing";

async function autorizar(credentials: Partial<Record<string, unknown>> | undefined) {
  const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const password = typeof credentials?.password === "string" ? credentials.password : "";
  const codigoMfa = typeof credentials?.codigoMfa === "string" ? credentials.codigoMfa.trim() : "";

  if (!email || !password) return null;

  const usuario = await buscarUsuarioPorEmail(email);
  if (!usuario) return null;
  if (estaBloqueado(usuario.bloqueadoHasta)) return null;

  const passwordValida = await verifyPassword(usuario.passwordHash, password);
  if (!passwordValida) {
    await registrarIntentoFallido(usuario.empresaId, usuario.id);
    return null;
  }

  if (usuario.mfaHabilitado) {
    const mfaValido = usuario.mfaSecret ? verificarCodigoMfa(usuario.mfaSecret, codigoMfa) : false;
    if (!mfaValido) {
      // R5-1 -- un TOTP incorrecto cuenta como intento fallido, mismo
      // contador/bloqueo que una contraseña incorrecta.
      await registrarIntentoFallido(usuario.empresaId, usuario.id);
      return null;
    }
  }

  await resetearIntentos(usuario.empresaId, usuario.id);

  return {
    id: usuario.id,
    email: usuario.email,
    name: usuario.nombre,
    empresaId: usuario.empresaId,
    rol: usuario.rol,
    eslabonId: usuario.eslabonId,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
        codigoMfa: { label: "Codigo MFA (si aplica)", type: "text" },
      },
      // R5-2 -- piso de tiempo fijo alrededor de todo el flujo (ver
      // src/infra/timing.ts) para que ninguna rama (email inexistente,
      // password incorrecta, MFA invalido, exito) sea distinguible por
      // cuanto tardo en responder.
      authorize: (credentials) => conPisoDeTiempo(autorizar(credentials), PISO_TIEMPO_AUTENTICACION_MS),
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
});
