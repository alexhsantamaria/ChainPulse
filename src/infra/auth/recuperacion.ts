// Infraestructura — recuperacion de contraseña. ADR-0003 asume este flujo
// junto a RF1/RF4 (no tiene un RF numerado propio en requirements.md,
// pero es estandar de cualquier sistema con login+password).
//
// Mismo criterio que invitacion.ts: token JWT firmado, no una tabla
// nueva -- evita otra migracion para un flujo que no la necesita. La
// diferencia con una invitacion es que este token tiene que dejar de
// servir despues de un solo uso (o si la contraseña ya cambio de
// cualquier otra forma mientras tanto). Se logra sin persistir nada: el
// payload lleva una huella corta del passwordHash vigente en el momento
// de generar el token; al confirmar, se recalcula esa huella contra el
// passwordHash actual -- si no coincide (porque la contraseña ya cambio,
// con este token o cualquier otro medio), se trata como vencido. Efecto
// practico: cambiar la contraseña invalida de una sola vez cualquier
// enlace de recuperacion que hubiera quedado pendiente, sin necesidad de
// una lista de tokens usados.
//
// Vigencia mas corta que una invitacion (1 hora vs. 7 dias) por ser un
// flujo mas sensible: quien tiene el link puede tomar control de la
// cuenta.
//
// Sin limitacion de tasa propia todavia (a diferencia de RF15/RF17, que
// sí la exigen para la evaluacion expres anonima, RF11-RF18, fuera de
// alcance por ahora): el peor abuso posible sin ella es mandar correos de
// mas a una bandeja de entrada ajena, no un riesgo de cuenta -- el token
// solo lo puede usar quien controle ese correo. Si mas adelante hace
// falta, se puede sumar sin romper este mecanismo.
import { createHash } from "crypto";
import { SignJWT, jwtVerify } from "jose";
// Import de tipo solamente (se borra en la compilacion, sin efecto en
// runtime) -- el import del valor buscarUsuarioPorEmail es dinamico, ver
// verificarTokenRecuperacion() mas abajo.
import type { UsuarioParaLogin } from "./loginLookup";

const ISSUER = "chainpulse";
const AUDIENCE = "chainpulse:recuperacion-contrasena";
const VIGENCIA = "1h";

function obtenerSecreto(): Uint8Array {
  const secreto = process.env.NEXTAUTH_SECRET;
  if (!secreto) {
    throw new Error("Falta NEXTAUTH_SECRET en .env");
  }
  return new TextEncoder().encode(secreto);
}

// No necesita ser una huella criptografica fuerte: solo tiene que cambiar
// cuando el passwordHash cambia. sha256 truncado alcanza y mantiene el
// JWT chico.
function huellaPassword(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export async function crearTokenRecuperacion(
  usuario: Pick<UsuarioParaLogin, "email" | "passwordHash">,
): Promise<string> {
  return new SignJWT({ email: usuario.email, fp: huellaPassword(usuario.passwordHash) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(VIGENCIA)
    .sign(obtenerSecreto());
}

// Devuelve el usuario vigente si el token es valido: firma correcta, sin
// vencer, y la huella coincide con el passwordHash actual. Reutiliza
// buscarUsuarioPorEmail() (login_lookup(), la unica excepcion a RLS ya
// existente, ver ADR-0003) -- no hace falta ninguna funcion SQL nueva.
export async function verificarTokenRecuperacion(token: string): Promise<UsuarioParaLogin | null> {
  try {
    const { payload } = await jwtVerify(token, obtenerSecreto(), { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.email !== "string" || typeof payload.fp !== "string") {
      return null;
    }

    // Import dinamico a proposito, no arriba del archivo: loginLookup.ts
    // importa el cliente de Prisma (src/infra/prisma/client.ts), que se
    // construye al importar el modulo -- si fuera un import estatico,
    // cualquier prueba unitaria que importe este archivo (incluso solo
    // para crearTokenRecuperacion(), que no toca la base) rompería en
    // este entorno de Mac sin "prisma generate" corrido. Con el import
    // dinamico, ese costo solo se paga cuando esta funcion realmente se
    // llama (siempre con la base disponible, en runtime real).
    const { buscarUsuarioPorEmail } = await import("./loginLookup");
    const usuario = await buscarUsuarioPorEmail(payload.email);
    if (!usuario) return null;
    if (huellaPassword(usuario.passwordHash) !== payload.fp) return null;

    return usuario;
  } catch {
    // Firma invalida, vencido, issuer/audience incorrectos, etc. -- todo
    // se trata igual, sin distinguir el motivo (mismo criterio de "no dar
    // pistas" que el resto de ADR-0003).
    return null;
  }
}
