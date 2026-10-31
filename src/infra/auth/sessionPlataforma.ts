// Infraestructura de autenticacion para UsuarioPlataforma. Este actor no
// tiene empresaId y nunca pasa por tenantClient(): todas las operaciones
// usan las funciones SECURITY DEFINER creadas por el PR 3.
import type { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  COOKIE_SESION_PLATAFORMA,
  verificarTokenSesionPlataforma,
  type RolPlataforma,
  type SesionPlataformaToken,
} from "@/auth.config.plataforma";
import { prisma } from "../prisma/client";

type ClienteSql = Pick<PrismaClient, "$queryRaw">;

export interface UsuarioPlataformaParaLogin {
  id: string;
  passwordHash: string;
  mfaSecret: string | null;
  mfaHabilitado: boolean;
  rol: RolPlataforma;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  sessionVersion: number;
  activo: boolean;
}

export interface EstadoSesionPlataforma {
  activo: boolean;
  rol: RolPlataforma;
  sessionVersion: number;
}

export interface SesionPlataformaValida extends SesionPlataformaToken {
  activo: true;
}

export class SesionPlataformaInvalidaError extends Error {
  constructor() {
    super("SESION_PLATAFORMA_INVALIDA");
    this.name = "SesionPlataformaInvalidaError";
  }
}

export async function buscarUsuarioPlataformaPorEmail(
  email: string,
  cliente: ClienteSql = prisma,
): Promise<UsuarioPlataformaParaLogin | null> {
  const filas = await cliente.$queryRaw<UsuarioPlataformaParaLogin[]>`
    SELECT * FROM public.login_lookup_plataforma(${email})
  `;
  return filas[0] ?? null;
}

export async function registrarIntentoFallidoPlataforma(
  usuarioId: string,
  cliente: ClienteSql = prisma,
): Promise<{ intentosFallidos: number; bloqueadoHasta: Date | null } | null> {
  const filas = await cliente.$queryRaw<{ intentosFallidos: number; bloqueadoHasta: Date | null }[]>`
    SELECT * FROM public.registrar_intento_fallido_plataforma(${usuarioId})
  `;
  return filas[0] ?? null;
}

export async function restablecerIntentosPlataforma(
  usuarioId: string,
  cliente: ClienteSql = prisma,
): Promise<boolean> {
  const filas = await cliente.$queryRaw<{ restablecido: boolean }[]>`
    SELECT * FROM public.restablecer_intentos_plataforma(${usuarioId})
  `;
  return filas[0]?.restablecido === true;
}

export async function leerEstadoSesionPlataforma(
  usuarioId: string,
  cliente: ClienteSql = prisma,
): Promise<EstadoSesionPlataforma | null> {
  const filas = await cliente.$queryRaw<EstadoSesionPlataforma[]>`
    SELECT * FROM public.leer_estado_sesion_plataforma(${usuarioId})
  `;
  return filas[0] ?? null;
}

export async function incrementarVersionSesionPlataforma(
  usuarioId: string,
  cliente: ClienteSql = prisma,
): Promise<number | null> {
  const filas = await cliente.$queryRaw<{ sessionVersion: number | null }[]>`
    SELECT * FROM public.incrementar_version_sesion_plataforma(${usuarioId})
  `;
  return filas[0]?.sessionVersion ?? null;
}

export async function desactivarUsuarioPlataforma(
  usuarioId: string,
  actorId: string,
  cliente: ClienteSql = prisma,
): Promise<boolean> {
  const filas = await cliente.$queryRaw<{ desactivado: boolean }[]>`
    SELECT * FROM public.desactivar_usuario_plataforma(${usuarioId}, ${actorId})
  `;
  return filas[0]?.desactivado === true;
}

export async function reactivarUsuarioPlataforma(
  usuarioId: string,
  actorId: string,
  cliente: ClienteSql = prisma,
): Promise<boolean> {
  const filas = await cliente.$queryRaw<{ reactivado: boolean }[]>`
    SELECT * FROM public.reactivar_usuario_plataforma(${usuarioId}, ${actorId})
  `;
  return filas[0]?.reactivado === true;
}

async function leerTokenSesionDesdeCookie(): Promise<string | null> {
  const almacen = await cookies();
  return almacen.get(COOKIE_SESION_PLATAFORMA)?.value ?? null;
}

export async function requireSesionPlataforma(
  token?: string,
  cliente: ClienteSql = prisma,
): Promise<SesionPlataformaValida> {
  const tokenEfectivo = token ?? (await leerTokenSesionDesdeCookie());
  if (!tokenEfectivo) throw new SesionPlataformaInvalidaError();

  const payload = await verificarTokenSesionPlataforma(tokenEfectivo);
  if (!payload) throw new SesionPlataformaInvalidaError();

  let estado: EstadoSesionPlataforma | null;
  try {
    estado = await leerEstadoSesionPlataforma(payload.usuarioId, cliente);
  } catch {
    // Fail-closed y sin registrar el error de Postgres: puede contener
    // fragmentos de consulta o del DSN.
    throw new SesionPlataformaInvalidaError();
  }
  if (
    !estado?.activo ||
    estado.sessionVersion !== payload.sessionVersion ||
    estado.rol !== payload.rol
  ) {
    throw new SesionPlataformaInvalidaError();
  }

  return { ...payload, activo: true };
}

// Guardas de ruta para RF20 (PR 8) -- mismo patron que requireSession()/
// requireAdmin() en src/infra/auth/session.ts (el actor tenant): un unico
// lugar que arma la respuesta 401/403 para que ninguna ruta nueva pueda
// repetir el chequeo a mano y desviarse por accidente. No duplica logica
// SQL: solo envuelve requireSesionPlataforma(), que ya hace la lectura de
// estado contra Postgres via leer_estado_sesion_plataforma().
export type ResultadoSesionPlataforma =
  | { sesion: SesionPlataformaValida }
  | { respuesta: NextResponse };

const SESION_PLATAFORMA_INVALIDA_RESPUESTA = () =>
  NextResponse.json({ ok: false, error: "SESION_PLATAFORMA_INVALIDA" }, { status: 401 });
const NO_AUTORIZADO_PLATAFORMA_RESPUESTA = () =>
  NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });

/** Exige una sesion de plataforma vigente (cualquier rol). Usar en toda ruta de /api/plataforma que no sea login/MFA. */
export async function requireSesionPlataformaRuta(
  cliente: ClienteSql = prisma,
): Promise<ResultadoSesionPlataforma> {
  try {
    const sesion = await requireSesionPlataforma(undefined, cliente);
    return { sesion };
  } catch {
    // Mismo criterio de no distinguir el motivo (token ausente, invalido,
    // usuario inactivo, sessionVersion desfasada) que el resto de este
    // modulo: siempre la misma respuesta generica.
    return { respuesta: SESION_PLATAFORMA_INVALIDA_RESPUESTA() };
  }
}

/** Exige una sesion de plataforma vigente Y rol ADMINISTRADOR_PLATAFORMA. Usar en publicar/retirar (RF20, §7) -- decision de autorizacion fina tomada en PR 8, ver informe de entrega. */
export async function requireAdministradorPlataformaRuta(
  cliente: ClienteSql = prisma,
): Promise<ResultadoSesionPlataforma> {
  const resultado = await requireSesionPlataformaRuta(cliente);
  if ("respuesta" in resultado) return resultado;
  if (resultado.sesion.rol !== "ADMINISTRADOR_PLATAFORMA") {
    return { respuesta: NO_AUTORIZADO_PLATAFORMA_RESPUESTA() };
  }
  return resultado;
}

// Equivalentes para Server Components (paginas RF20 de PR 8) -- mismo
// patron que requireSessionOrRedirect()/requireAdminOrRedirect() en
// src/infra/auth/session.ts (el actor tenant): un Server Component no
// puede devolver NextResponse, asi que en vez de eso redirige. No
// duplica logica: ambas envuelven requireSesionPlataforma(), que ya hace
// la lectura de estado contra Postgres.
//
// "/plataforma/login" existe (ronda 2 de revision, Alex: paginas de
// login, activacion de MFA y verificacion de MFA para UsuarioPlataforma,
// reutilizando las APIs de RF19) -- la redireccion de abajo apunta a una
// ruta real, no a un placeholder.
export async function requireSesionPlataformaOrRedirect(
  rutaSinSesion = "/plataforma/login",
): Promise<SesionPlataformaValida> {
  try {
    return await requireSesionPlataforma();
  } catch {
    redirect(rutaSinSesion);
  }
}

/** Equivalente a requireAdministradorPlataformaRuta() para Server Components -- ver requireSesionPlataformaOrRedirect(). */
export async function requireAdministradorPlataformaOrRedirect(
  rutaNoAutorizado = "/plataforma/rf20/cuestionarios",
  rutaSinSesion = "/plataforma/login",
): Promise<SesionPlataformaValida> {
  const sesion = await requireSesionPlataformaOrRedirect(rutaSinSesion);
  if (sesion.rol !== "ADMINISTRADOR_PLATAFORMA") redirect(rutaNoAutorizado);
  return sesion;
}
