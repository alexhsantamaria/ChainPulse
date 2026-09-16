// Infraestructura — helpers de sesion/rol compartidos por las rutas API
// (Ronda 5 de revision, R5-12: el chequeo `if (!session?.user?.empresaId)
// ...` y, en 5 rutas mas, el de rol ADMINISTRADOR, estaban copiados
// literalmente en cada route.ts -- ya causo una inconsistencia real
// (src/app/api/mfa/activar/route.ts verificaba `session?.user?.email` en
// vez de `empresaId`, ver R5-9). Estos dos helpers son el unico lugar que
// arma la respuesta 401/403, para que una futura ruta no pueda repetir el
// mismo desvio por accidente.
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export interface SesionValida {
  usuarioId: string;
  empresaId: string;
  email: string;
  nombre: string | null | undefined;
  rol: "ADMINISTRADOR" | "RESPONSABLE";
  eslabonId: string | null | undefined;
}

export type ResultadoSesion = { sesion: SesionValida } | { respuesta: NextResponse };

const SIN_SESION = () => NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
const NO_AUTORIZADO = () => NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });

function aSesionValida(user: {
  id?: string;
  empresaId?: string;
  email?: string | null;
  name?: string | null;
  rol?: string;
  eslabonId?: string | null;
}): SesionValida | null {
  if (!user.id || !user.empresaId || !user.email || !user.rol) return null;
  if (user.rol !== "ADMINISTRADOR" && user.rol !== "RESPONSABLE") return null;
  return {
    usuarioId: user.id,
    empresaId: user.empresaId,
    email: user.email,
    nombre: user.name,
    rol: user.rol,
    eslabonId: user.eslabonId,
  };
}

/** Exige una sesion valida (cualquier rol). Usar en toda ruta que no sea publica. */
export async function requireSession(): Promise<ResultadoSesion> {
  const session = await auth();
  const sesion = session?.user ? aSesionValida(session.user) : null;
  if (!sesion) return { respuesta: SIN_SESION() };
  return { sesion };
}

/** Exige una sesion valida Y rol ADMINISTRADOR. Usar en las acciones que RF exige solo para administradores (abrir/cerrar ciclo, invitar, marcar recomendacion ejecutada). */
export async function requireAdmin(): Promise<ResultadoSesion> {
  const resultado = await requireSession();
  if ("respuesta" in resultado) return resultado;
  if (resultado.sesion.rol !== "ADMINISTRADOR") return { respuesta: NO_AUTORIZADO() };
  return resultado;
}
