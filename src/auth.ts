// Infraestructura — configuracion de Auth.js / NextAuth v5 (ADR-0003).
//
// El campo "codigoMfa" del formulario de login es siempre visible pero
// opcional: no revelamos si una cuenta tiene MFA activado (evita
// enumeracion de cuentas, mismo criterio que un reset de contraseña —
// ADR-0003 / OWASP A07). Todas las fallas (email inexistente, password
// incorrecta, cuenta bloqueada, MFA faltante o invalido) devuelven el
// mismo resultado (null / "credenciales invalidas"), sin distinguir el
// motivo real al cliente.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { buscarUsuarioPorEmail } from "@/infra/auth/loginLookup";
import { verifyPassword } from "@/infra/auth/password";
import { verificarCodigoMfa } from "@/infra/auth/mfa";
import { estaBloqueado, registrarIntentoFallido, resetearIntentos } from "@/infra/auth/rateLimit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
        codigoMfa: { label: "Codigo MFA (si aplica)", type: "text" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        const codigoMfa = typeof credentials?.codigoMfa === "string" ? credentials.codigoMfa.trim() : "";

        if (!email || !password) return null;

        const usuario = await buscarUsuarioPorEmail(email);
        if (!usuario) return null;
        if (estaBloqueado(usuario.bloqueadoHasta)) return null;

        const passwordValida = await verifyPassword(usuario.passwordHash, password);
        if (!passwordValida) {
          await registrarIntentoFallido(usuario.empresaId, usuario.id, usuario.intentosFallidos);
          return null;
        }

        if (usuario.mfaHabilitado) {
          const mfaValido = usuario.mfaSecret ? verificarCodigoMfa(usuario.mfaSecret, codigoMfa) : false;
          if (!mfaValido) return null;
        }

        await resetearIntentos(usuario.empresaId, usuario.id);

        return {
          id: usuario.id,
          email: usuario.email,
          name: usuario.nombre,
          empresaId: usuario.empresaId,
          rol: usuario.rol,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.empresaId = user.empresaId;
        token.rol = user.rol;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.empresaId = token.empresaId;
      session.user.rol = token.rol;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
});
