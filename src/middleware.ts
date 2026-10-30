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
import type { NextFetchEvent } from "next/server";
import { type NextRequest, NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import {
  COOKIE_SESION_PLATAFORMA,
  verificarTokenSesionPlataforma,
} from "@/auth.config.plataforma";

const { auth } = NextAuth(authConfig);

const middlewareUsuario = auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  // A3 -- MFA es obligatorio para ADMINISTRADOR desde el Incremento 1
  // (prisma/schema.prisma, comentario de Usuario.mfaHabilitado), pero
  // hasta ahora el paso a /activar-mfa despues de /registro era solo un
  // redirect del lado del cliente (registro/page.tsx): nada del lado del
  // servidor impedia navegar directo a /dashboard con una cuenta que
  // nunca completo la activacion. Se cierra aca, en la primera capa de
  // proteccion, mismo criterio que el resto de este archivo. No aplica a
  // RESPONSABLE (MFA no es obligatorio para ese rol) ni a la propia
  // pagina /activar-mfa (evita el loop de redirect).
  const { rol, mfaHabilitado } = req.auth.user;
  if (rol === "ADMINISTRADOR" && !mfaHabilitado && req.nextUrl.pathname !== "/activar-mfa") {
    const activarMfaUrl = new URL("/activar-mfa", req.nextUrl.origin);
    return NextResponse.redirect(activarMfaUrl);
  }
});

async function middlewarePlataforma(req: NextRequest) {
  const ruta = req.nextUrl.pathname;
  if (ruta === "/plataforma/login") return NextResponse.next();

  if (ruta === "/plataforma/activar-mfa" || ruta === "/plataforma/verificar-mfa") {
    // El JWT preauth tiene Path=/api/plataforma/mfa para no viajar por el
    // resto del sitio. Estas paginas solo muestran formularios: la barrera
    // autoritativa esta en cada API MFA, que si recibe y valida la cookie.
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_SESION_PLATAFORMA)?.value;
  if (token && (await verificarTokenSesionPlataforma(token))) return NextResponse.next();
  return NextResponse.redirect(new URL("/plataforma/login", req.nextUrl.origin));
}

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (req.nextUrl.pathname.startsWith("/plataforma")) return middlewarePlataforma(req);
  return middlewareUsuario(req as never, event as never);
}

export const config = {
  // /dashboard todavia no existe (ver README "Proximo paso") -- se deja
  // ya en el matcher para que quede protegido desde el momento en que se
  // cree, sin tener que acordarse de volver a tocar este archivo.
  matcher: ["/activar-mfa", "/dashboard/:path*", "/plataforma/:path*"],
};
