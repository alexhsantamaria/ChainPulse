// Middleware — protege rutas privadas: sin sesion, redirige a /login (ADR-0003).
//
// Corre en el Edge runtime de Next.js antes de renderizar la pagina. Usa
// la sesion JWT de Auth.js (session.strategy: "jwt"), que se decodifica
// sin tocar la base de datos — por eso puede correr aca (el Edge runtime
// no soporta el driver de Postgres, ver ADR-0001).
//
// Importa auth.config.ts (sin el proveedor Credentials), no auth.ts
// completo: auth.ts arrastra @node-rs/argon2 (verificacion de password) y
// el driver de Postgres, que no corren en el Edge runtime y rompen el
// build ("Module not found: @node-rs/argon2-wasm32-wasi"). El middleware
// solo necesita leer el JWT, no verificar credenciales — para eso alcanza
// la configuracion base.
//
// Es la primera capa de proteccion, no la unica: /activar-mfa (y
// cualquier pagina protegida futura) tambien valida su propia sesion del
// lado del servidor -- mismo criterio de "cinturon y tirantes" que el
// aislamiento multi-tenant (tenantClient() + RLS).
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // /dashboard todavia no existe (ver README "Proximo paso") -- se deja
  // ya en el matcher para que quede protegido desde el momento en que se
  // cree, sin tener que acordarse de volver a tocar este archivo.
  matcher: ["/activar-mfa", "/dashboard/:path*"],
};
