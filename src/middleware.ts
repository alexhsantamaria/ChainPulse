// Middleware — protege rutas privadas: sin sesion, redirige a /login (ADR-0003).
//
// Corre en el Edge runtime de Next.js antes de renderizar la pagina. Usa
// la sesion JWT de Auth.js (session.strategy: "jwt" en src/auth.ts), que
// se decodifica sin tocar la base de datos -- por eso puede correr aca
// (el Edge runtime no soporta el driver de Postgres, ver ADR-0001).
//
// Es la primera capa de proteccion, no la unica: /activar-mfa (y
// cualquier pagina protegida futura) tambien valida su propia sesion del
// lado del servidor -- mismo criterio de "cinturon y tirantes" que el
// aislamiento multi-tenant (tenantClient() + RLS).
import { NextResponse } from "next/server";
import { auth } from "@/auth";

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
