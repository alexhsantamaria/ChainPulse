// Infraestructura — hash y verificacion de contraseñas con Argon2id (ADR-0003).
// Nunca contraseñas en texto plano ni algoritmos obsoletos (MD5/SHA-1),
// segun los apuntes de Seguridad citados en ADR-0003.
import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
