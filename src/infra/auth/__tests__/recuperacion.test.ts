// Solo prueba crearTokenRecuperacion() y las propiedades criptograficas
// del token que genera (firma, huella). verificarTokenRecuperacion()
// tambien consulta la base (buscarUsuarioPorEmail(), via login_lookup())
// para comparar la huella contra el passwordHash vigente -- no se puede
// ejercitar sin red hacia Neon, mismo limite que el resto de infra/ en
// este entorno. Se probo a mano en Windows (ver README) y queda como
// candidato para una prueba de integracion propia junto con el resto de
// flujos criticos de autenticacion (item pendiente de la lista acordada
// con Alex).
import { beforeAll, describe, expect, it } from "vitest";
import { jwtVerify } from "jose";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "secreto-de-pruebas-no-es-real";
});

function secreto(valor = "secreto-de-pruebas-no-es-real"): Uint8Array {
  return new TextEncoder().encode(valor);
}

describe("crearTokenRecuperacion", () => {
  it("firma un token con el email y una huella del passwordHash, nunca el hash completo", async () => {
    const { crearTokenRecuperacion } = await import("../recuperacion");
    const token = await crearTokenRecuperacion({
      email: "admin@example.com",
      passwordHash: "hash-secreto-de-argon2id",
    });

    const { payload } = await jwtVerify(token, secreto(), {
      issuer: "chainpulse",
      audience: "chainpulse:recuperacion-contrasena",
    });

    expect(payload.email).toBe("admin@example.com");
    expect(typeof payload.fp).toBe("string");
    expect(payload.fp).not.toContain("hash-secreto-de-argon2id");
  });

  it("la huella cambia si el passwordHash cambia (asi invalida tokens viejos al resetear)", async () => {
    const { crearTokenRecuperacion } = await import("../recuperacion");
    const tokenA = await crearTokenRecuperacion({ email: "admin@example.com", passwordHash: "hash-1" });
    const tokenB = await crearTokenRecuperacion({ email: "admin@example.com", passwordHash: "hash-2" });

    const { payload: payloadA } = await jwtVerify(tokenA, secreto());
    const { payload: payloadB } = await jwtVerify(tokenB, secreto());

    expect(payloadA.fp).not.toBe(payloadB.fp);
  });

  it("un token con la firma alterada no pasa jwtVerify", async () => {
    const { crearTokenRecuperacion } = await import("../recuperacion");
    const token = await crearTokenRecuperacion({ email: "admin@example.com", passwordHash: "hash-1" });
    // Anteultimo caracter, no el ultimo -- ver el comentario del mismo
    // fix en invitacion.test.ts (el ultimo caracter de una firma HS256 en
    // base64url puede tener bits de relleno sin significado real).
    const pos = token.length - 2;
    const tokenAlterado = token.slice(0, pos) + (token[pos] === "A" ? "B" : "A") + token.slice(pos + 1);

    await expect(jwtVerify(tokenAlterado, secreto())).rejects.toThrow();
  });

  it("un token firmado con otro secreto no pasa jwtVerify con el secreto real", async () => {
    process.env.NEXTAUTH_SECRET = "otro-secreto-distinto";
    const { crearTokenRecuperacion } = await import("../recuperacion");
    const token = await crearTokenRecuperacion({ email: "admin@example.com", passwordHash: "hash-1" });
    process.env.NEXTAUTH_SECRET = "secreto-de-pruebas-no-es-real";

    await expect(jwtVerify(token, secreto())).rejects.toThrow();
  });
});
