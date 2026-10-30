// Infraestructura de autenticacion para UsuarioPlataforma. Este actor no
// tiene empresaId y nunca pasa por tenantClient(): todas las operaciones
// usan las funciones SECURITY DEFINER creadas por el PR 3.
import type { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
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
