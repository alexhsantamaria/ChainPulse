// Infraestructura — busca un usuario por email sin conocer su tenant de
// antemano, via la funcion Postgres SECURITY DEFINER login_lookup()
// (prisma/auth_functions.sql). Unica excepcion deliberada y acotada al
// aislamiento por RLS (ADR-0003 + ADR-0001 RNF1): el resto de cada
// request, una vez resuelto el tenant, usa tenantClient() normal.
import { prisma } from "../prisma/client";

export interface UsuarioParaLogin {
  id: string;
  empresaId: string;
  email: string;
  nombre: string;
  rol: "ADMINISTRADOR" | "RESPONSABLE";
  passwordHash: string;
  mfaSecret: string | null;
  mfaHabilitado: boolean;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  // RF6: eslabonId del RESPONSABLE (null para ADMINISTRADOR). Requiere
  // haber vuelto a correr prisma/auth_functions.sql en Neon -- ver el
  // comentario agregado ahi.
  eslabonId: string | null;
}

export async function buscarUsuarioPorEmail(email: string): Promise<UsuarioParaLogin | null> {
  const filas = await prisma.$queryRaw<UsuarioParaLogin[]>`SELECT * FROM login_lookup(${email})`;
  return filas[0] ?? null;
}
