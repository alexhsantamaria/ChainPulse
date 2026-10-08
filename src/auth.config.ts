// Infraestructura — configuracion "edge-safe" de Auth.js, sin el proveedor
// Credentials (ADR-0003, adenda middleware).
//
// El middleware (src/middleware.ts) corre en el Edge runtime de Next.js,
// que no soporta modulos nativos de Node. Concretamente, @node-rs/argon2
// (usado por src/infra/auth/password.ts, importado indirectamente desde
// src/auth.ts) rompe el bundle del Edge runtime: intenta resolver su
// variante wasm32-wasi y falla con "Module not found:
// @node-rs/argon2-wasm32-wasi".
//
// La solucion recomendada por Auth.js v5 para este caso ("Edge
// compatibility") es separar la configuracion en dos partes:
//
// - auth.config.ts (este archivo): sin el proveedor Credentials, sin
//   nada que dependa de @node-rs/argon2 o del driver de Postgres. Lo usa
//   el middleware para decodificar el JWT de la sesion, nada mas — no
//   necesita consultar la base de datos ni verificar contraseñas.
// - auth.ts: importa este config, le agrega el proveedor Credentials
//   completo (con Argon2 y Prisma), y es lo que usan las rutas de API y
//   los Server Components (Node runtime, sin la restriccion del Edge).
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.empresaId = user.empresaId;
        token.rol = user.rol;
        token.eslabonId = user.eslabonId ?? null;
        // A3 -- ver el comentario de autorizar() en auth.ts. Se fija solo
        // en el login (igual que el resto de estos campos): activar MFA
        // exige volver a iniciar sesion para que el JWT quede al dia (ver
        // ActivarMfaForm.tsx), en vez de mantener un mecanismo de refresco
        // de sesion en caliente que este proyecto no tiene en ningun otro
        // lado.
        token.mfaHabilitado = user.mfaHabilitado;
        // Mecanismo acotado de revocacion de sesiones (Alex, 2026-10-03,
        // diagnostico-eliminacion-cuenta-prueba.md Seccion 8) -- PREPARADO
        // PARA REVISION, no aplicado todavia. Mismo criterio que
        // mfaHabilitado arriba: se fija solo en el login, con el valor
        // vigente en ese momento (user.sessionVersion, leido en
        // autorizar() via leerSessionVersionParaLogin()). Un JWT emitido
        // antes de este campo no trae esta propiedad en absoluto -- ver
        // sessionVerification.ts (SESSION_VERSION_POR_DEFECTO) para como
        // se trata esa ausencia, a proposito, para no desloguear a nadie
        // al desplegar esto.
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.empresaId = token.empresaId;
      session.user.rol = token.rol;
      session.user.eslabonId = token.eslabonId;
      session.user.mfaHabilitado = token.mfaHabilitado;
      session.user.sessionVersion = token.sessionVersion;
      return session;
    },
  },
} satisfies NextAuthConfig;
