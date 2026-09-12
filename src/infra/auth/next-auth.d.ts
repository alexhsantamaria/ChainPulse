// Infraestructura — amplia los tipos de Auth.js con empresaId y rol (ADR-0003).
//
// NextAuth v5 reexporta tipos desde @auth/core; las interfaces que
// consumen los callbacks (jwt/session) resuelven contra los modulos de
// @auth/core, no contra los re-exports de next-auth — por eso se amplian
// los cuatro modulos, no solo "next-auth".
import type { RolUsuario } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      empresaId: string;
      rol: RolUsuario;
    } & DefaultSession["user"];
  }

  interface User {
    empresaId: string;
    rol: RolUsuario;
  }
}

declare module "@auth/core/types" {
  interface Session {
    user: {
      empresaId: string;
      rol: RolUsuario;
    } & DefaultSession["user"];
  }

  interface User {
    empresaId: string;
    rol: RolUsuario;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    empresaId: string;
    rol: RolUsuario;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    empresaId: string;
    rol: RolUsuario;
  }
}
