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
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.empresaId = token.empresaId;
      session.user.rol = token.rol;
      session.user.eslabonId = token.eslabonId;
      return session;
    },
  },
} satisfies NextAuthConfig;
