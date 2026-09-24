// Infraestructura — invitacion de un responsable de eslabon por correo
// (RF4), y desde 2026-09-24 tambien invitacion a una Cadena/ConexionCadena
// puntual (RF36, ver crearTokenInvitacionCadena() mas abajo) -- mismo
// mecanismo stateless, audience de JWT distinta para que un token de un
// tipo nunca sirva como del otro.
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

// Bloque C (RF36) -- invitacion a una Cadena o a una ConexionCadena
// puntual, extension del mismo mecanismo de arriba (JWT stateless
// firmado con "jose", vigencia de 7 dias). AUDIENCE propia y distinta de
// la de invitacion de responsable: sin esto, un token de invitacion de
// eslabon (que tambien trae un "empresaId"/"email") pasaria la
// verificacion de firma de esta funcion igual, solo que sin
// "cadenaId" -- jwtVerify() ya rechaza por audience antes de llegar a esa
// revision de campos, asi que un token de un tipo nunca es aceptado como
// del otro (RNF15: "mismo estandar de no reutilizacion... que RF4").
// "conexionCadenaId" ausente = invitacion a la Cadena completa; presente
// = acotada a esa conexion (RF36, "una cadena o una conexion concreta").
const AUDIENCE_CADENA = "chainpulse:invitacion-cadena";

export interface PayloadInvitacionCadena {
  empresaId: string;
  cadenaId: string;
  conexionCadenaId: string | null;
  email: string;
}

export async function crearTokenInvitacionCadena(datos: PayloadInvitacionCadena): Promise<string> {
  return new SignJWT({
    empresaId: datos.empresaId,
    cadenaId: datos.cadenaId,
    conexionCadenaId: datos.conexionCadenaId,
    email: datos.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE_CADENA)
    .setIssuedAt()
    .setExpirationTime(VIGENCIA)
    .sign(obtenerSecreto());
}

export async function verificarTokenInvitacionCadena(token: string): Promise<PayloadInvitacionCadena | null> {
  try {
    const { payload } = await jwtVerify(token, obtenerSecreto(), { issuer: ISSUER, audience: AUDIENCE_CADENA });
    if (
      typeof payload.empresaId !== "string" ||
      typeof payload.cadenaId !== "string" ||
      typeof payload.email !== "string" ||
      (payload.conexionCadenaId !== null && typeof payload.conexionCadenaId !== "string")
    ) {
      return null;
    }
    return {
      empresaId: payload.empresaId,
      cadenaId: payload.cadenaId,
      conexionCadenaId: (payload.conexionCadenaId as string | null) ?? null,
      email: payload.email,
    };
  } catch {
    return null;
  }
}
