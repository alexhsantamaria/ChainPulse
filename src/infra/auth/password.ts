// Infraestructura — hash y verificacion de contraseñas con Argon2id (ADR-0003).
// Nunca contraseñas en texto plano ni algoritmos obsoletos (MD5/SHA-1),
// segun los apuntes de Seguridad citados en ADR-0003.
//
// @node-rs/argon2 en vez de "argon2" (node-argon2): esta ultima requiere
// compilar un binario nativo con node-gyp si no hay un prebuilt para la
// plataforma exacta (fallo real en Windows ARM64 sin Visual Studio
// instalado); @node-rs/argon2 publica un binario prebuilt para
// win32-arm64-msvc (y el resto de plataformas comunes), sin node-gyp ni
// postinstall. Argon2id es el algoritmo por defecto de esta libreria.
import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
