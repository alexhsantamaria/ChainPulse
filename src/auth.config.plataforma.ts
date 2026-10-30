// Configuracion edge-safe de la autenticacion separada de UsuarioPlataforma.
// Este modulo solo depende de Web Crypto (via jose): nunca importa Prisma,
// Argon2 ni modulos nativos de Node, por lo que tambien puede usarse desde
// middleware.ts cuando se implemente el PR 5 de RF19/RF20.
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const EMISOR_PLATAFORMA = "chainpulse-plataforma";
export const AUDIENCIA_PREAUTH_PLATAFORMA = "plataforma-preauth";
export const AUDIENCIA_SESION_PLATAFORMA = "plataforma-session";
export const COOKIE_PREAUTH_PLATAFORMA = "chainpulse_plataforma_preauth";
export const COOKIE_SESION_PLATAFORMA = "chainpulse_plataforma_session";
export const TTL_PREAUTH_PLATAFORMA_SEGUNDOS = 10 * 60;
export const TTL_SESION_PLATAFORMA_SEGUNDOS = 8 * 60 * 60;

export type RolPlataforma = "CURADOR_METODOLOGICO" | "ADMINISTRADOR_PLATAFORMA";

export interface PreauthPlataforma {
  usuarioId: string;
}

export interface SesionPlataformaToken {
  usuarioId: string;
  rol: RolPlataforma;
  sessionVersion: number;
}

function obtenerSecretoPlataforma(): Uint8Array {
  const secreto = process.env.AUTH_PLATAFORMA_SECRET;
  if (!secreto) throw new Error("Falta AUTH_PLATAFORMA_SECRET");
  return new TextEncoder().encode(secreto);
}

function ahoraEnSegundos(ahora: number): number {
  return Math.floor(ahora / 1000);
}

function esRolPlataforma(valor: unknown): valor is RolPlataforma {
  return valor === "CURADOR_METODOLOGICO" || valor === "ADMINISTRADOR_PLATAFORMA";
}

export async function crearTokenPreauthPlataforma(
  usuarioId: string,
  ahora: number = Date.now(),
): Promise<string> {
  const emitidoEn = ahoraEnSegundos(ahora);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(usuarioId)
    .setIssuer(EMISOR_PLATAFORMA)
    .setAudience(AUDIENCIA_PREAUTH_PLATAFORMA)
    .setIssuedAt(emitidoEn)
    .setExpirationTime(emitidoEn + TTL_PREAUTH_PLATAFORMA_SEGUNDOS)
    .sign(obtenerSecretoPlataforma());
}

export async function crearTokenSesionPlataforma(
  datos: SesionPlataformaToken,
  ahora: number = Date.now(),
): Promise<string> {
  if (!Number.isInteger(datos.sessionVersion) || datos.sessionVersion < 1) {
    throw new RangeError("sessionVersion debe ser un entero positivo");
  }
  const emitidoEn = ahoraEnSegundos(ahora);
  return new SignJWT({ rol: datos.rol, sessionVersion: datos.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(datos.usuarioId)
    .setIssuer(EMISOR_PLATAFORMA)
    .setAudience(AUDIENCIA_SESION_PLATAFORMA)
    .setIssuedAt(emitidoEn)
    .setExpirationTime(emitidoEn + TTL_SESION_PLATAFORMA_SEGUNDOS)
    .sign(obtenerSecretoPlataforma());
}

async function verificarPayload(token: string, audiencia: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, obtenerSecretoPlataforma(), {
      issuer: EMISOR_PLATAFORMA,
      audience: audiencia,
      algorithms: ["HS256"],
    });
    return payload;
  } catch {
    return null;
  }
}

export async function verificarTokenPreauthPlataforma(token: string): Promise<PreauthPlataforma | null> {
  const payload = await verificarPayload(token, AUDIENCIA_PREAUTH_PLATAFORMA);
  if (!payload || typeof payload.sub !== "string") return null;
  // Un preauth nunca debe adquirir claims de una sesion completa.
  if (payload.rol !== undefined || payload.sessionVersion !== undefined) return null;
  return { usuarioId: payload.sub };
}

export async function verificarTokenSesionPlataforma(token: string): Promise<SesionPlataformaToken | null> {
  const payload = await verificarPayload(token, AUDIENCIA_SESION_PLATAFORMA);
  if (
    !payload ||
    typeof payload.sub !== "string" ||
    !esRolPlataforma(payload.rol) ||
    !Number.isInteger(payload.sessionVersion) ||
    (payload.sessionVersion as number) < 1
  ) {
    return null;
  }
  return {
    usuarioId: payload.sub,
    rol: payload.rol,
    sessionVersion: payload.sessionVersion as number,
  };
}

export const opcionesCookieSesionPlataforma = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: TTL_SESION_PLATAFORMA_SEGUNDOS,
};

export function opcionesCookiePreauthPlataforma(path: "/activar-mfa" | "/verificar-mfa") {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path,
    maxAge: TTL_PREAUTH_PLATAFORMA_SEGUNDOS,
  };
}
