// Infraestructura — invitacion de un responsable de eslabon por correo (RF4).
//
// Decision de implementacion: la invitacion NO se persiste en una tabla
// propia. Se codifica como un JWT firmado (misma libreria "jose" que usa
// next-auth por debajo) con el email, el eslabon y el tenant, y ese token
// viaja en el link del correo -- quien lo abre confirma su cuenta recien
// en ese momento, creando el Usuario con su contraseña ya elegida (nunca
// hay una fila de Usuario con passwordHash vacio, que de todas formas el
// schema no permite: es NOT NULL). Se eligio este camino en vez de
// agregar una tabla "Invitacion" porque este entorno no puede correr
// `prisma migrate dev` (binaries.prisma.sh bloqueado, ver ADR-0003
// addendum de Prisma sin motor Rust) -- una tabla nueva hubiese quedado
// sin poder aplicarse hasta la proxima sesion en Windows. Tradeoff
// aceptado y documentado: el administrador no puede ver ni revocar
// invitaciones ya enviadas antes de que se acepten (no hay fila que
// listar) -- si hace falta mas adelante, se puede agregar una tabla de
// auditoria sin romper este mecanismo (el token seguiria siendo valido
// igual).
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "chainpulse";
const AUDIENCE = "chainpulse:invitacion-responsable";
// Valor de calibracion inicial (mismo criterio que otros plazos del
// proyecto, ver Seccion 12 de requirements.md): 7 dias es tiempo de sobra
// para revisar un correo, sin dejar el link valido indefinidamente.
const VIGENCIA = "7d";

function obtenerSecreto(): Uint8Array {
  const secreto = process.env.NEXTAUTH_SECRET;
  if (!secreto) {
    throw new Error("Falta NEXTAUTH_SECRET en .env");
  }
  return new TextEncoder().encode(secreto);
}

export interface PayloadInvitacion {
  empresaId: string;
  eslabonId: string;
  email: string;
}

export async function crearTokenInvitacion(datos: PayloadInvitacion): Promise<string> {
  return new SignJWT({ empresaId: datos.empresaId, eslabonId: datos.eslabonId, email: datos.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(VIGENCIA)
    .sign(obtenerSecreto());
}

export async function verificarTokenInvitacion(token: string): Promise<PayloadInvitacion | null> {
  try {
    const { payload } = await jwtVerify(token, obtenerSecreto(), { issuer: ISSUER, audience: AUDIENCE });
    if (
      typeof payload.empresaId !== "string" ||
      typeof payload.eslabonId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return { empresaId: payload.empresaId, eslabonId: payload.eslabonId, email: payload.email };
  } catch {
    // Firma invalida, vencido, issuer/audience incorrectos, etc. -- todo
    // se trata igual, como "invitacion invalida", sin distinguir el
    // motivo al cliente (mismo criterio de no dar pistas que ADR-0003 usa
    // en el login).
    return null;
  }
}
