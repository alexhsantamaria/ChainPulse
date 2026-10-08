// Infraestructura — amplia los tipos de Auth.js con empresaId, rol y eslabonId (ADR-0003).
//
// NextAuth v5 reexporta tipos desde @auth/core; las interfaces que
// consumen los callbacks (jwt/session) resuelven contra los modulos de
// @auth/core, no contra los re-exports de next-auth — por eso se amplian
// los cuatro modulos, no solo "next-auth".
//
// eslabonId (RF6): un RESPONSABLE necesita su propio eslabonId en la
// sesion para saber que conexiones le corresponde responder en un ciclo
// (src/infra/ciclos/registrarRespuestas.ts) sin volver a consultar la
// base de datos solo para eso.
import type { RolUsuario } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      empresaId: string;
      rol: RolUsuario;
      eslabonId: string | null;
      mfaHabilitado: boolean;
      // Mecanismo acotado de revocacion de sesiones (Alex, 2026-10-03,
      // diagnostico-eliminacion-cuenta-prueba.md Seccion 8) -- preparado
      // para revision, no aplicado todavia.
      sessionVersion: number;
    } & DefaultSession["user"];
  }

  interface User {
    empresaId: string;
    rol: RolUsuario;
    eslabonId?: string | null;
    mfaHabilitado: boolean;
    sessionVersion: number;
  }
}

declare module "@auth/core/types" {
  interface Session {
    user: {
      id: string;
      empresaId: string;
      rol: RolUsuario;
      eslabonId: string | null;
      mfaHabilitado: boolean;
      // Mecanismo acotado de revocacion de sesiones (Alex, 2026-10-03,
      // diagnostico-eliminacion-cuenta-prueba.md Seccion 8) -- preparado
      // para revision, no aplicado todavia.
      sessionVersion: number;
    } & DefaultSession["user"];
  }

  interface User {
    empresaId: string;
    rol: RolUsuario;
    eslabonId?: string | null;
    mfaHabilitado: boolean;
    sessionVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    empresaId: string;
    rol: RolUsuario;
    eslabonId: string | null;
    mfaHabilitado: boolean;
    sessionVersion: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    empresaId: string;
    rol: RolUsuario;
    eslabonId: string | null;
    mfaHabilitado: boolean;
    sessionVersion: number;
  }
}
