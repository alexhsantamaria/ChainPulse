// Pruebas -- sesionSinteticaHelpers.ts (Incremento 5 PR4, ronda de
// revision 2 de Alex, 2026-11-19, punto 1: "crear usuarios y sesiones
// sinteticas reproducibles... mediante un mecanismo seguro y
// reproducible; no imprimir, persistir ni incluir cookies en
// resultados").
//
// Todo PURO salvo mintarCookieSesionSintetica(), que solo hace
// criptografia local (next-auth/jwt encode()/decode(), sin red ni
// Postgres) -- se prueba con un secreto DESCARTABLE generado en el
// propio test, nunca el secreto real de ningun deployment.
import { describe, expect, it } from "vitest";
import { decode } from "next-auth/jwt";
import {
  construirClaimsSesionSintetica,
  construirFilasUsuariosSinteticosCarga,
  emailUsuarioSinteticoCarga,
  emailsUsuariosSinteticosCarga,
  mintarCookieSesionSintetica,
  NOMBRE_COOKIE_SESION_HTTPS,
  ROL_USUARIO_SINTETICO_CARGA,
  sufijoEmailUsuariosSinteticosCarga,
  VIGENCIA_SESION_SINTETICA_SEGUNDOS,
} from "../sesionSinteticaHelpers";
import { MARCA_SINTETICA_RENDIMIENTO_PR4 } from "../configuracionRendimiento";

const SECRETO_DE_PRUEBA_DESCARTABLE = "secreto-descartable-unicamente-para-pruebas-unitarias-pr4";

describe("emailUsuarioSinteticoCarga / emailsUsuariosSinteticosCarga", () => {
  it("es reproducible: el mismo (escala, indice) siempre produce el mismo email", () => {
    expect(emailUsuarioSinteticoCarga(1_000, 7)).toBe(emailUsuarioSinteticoCarga(1_000, 7));
  });

  it("usa el dominio reservado .invalid (RFC 2606) -- nunca puede colisionar con un dominio real", () => {
    expect(emailUsuarioSinteticoCarga(100, 0)).toMatch(/@chainpulse-pr4-rendimiento-sintetico\.invalid$/);
  });

  it("todo email generado contiene la marca sintetica completa y termina en el sufijo de su propia escala", () => {
    for (const escala of [100, 1_000, 10_000, 50_000] as const) {
      const email = emailUsuarioSinteticoCarga(escala, 3);
      expect(email).toContain(MARCA_SINTETICA_RENDIMIENTO_PR4);
      expect(email.endsWith(sufijoEmailUsuariosSinteticosCarga(escala))).toBe(true);
    }
  });

  it("emails de escalas distintas NUNCA comparten sufijo -- una limpieza de la escala 100 no puede tocar la escala 1000", () => {
    expect(sufijoEmailUsuariosSinteticosCarga(100)).not.toBe(sufijoEmailUsuariosSinteticosCarga(1_000));
    expect(emailUsuarioSinteticoCarga(100, 5).endsWith(sufijoEmailUsuariosSinteticosCarga(1_000))).toBe(false);
  });

  it("emailsUsuariosSinteticosCarga() devuelve exactamente `cantidad` emails, todos distintos, en orden de indice", () => {
    const emails = emailsUsuariosSinteticosCarga(1_000, 26);
    expect(emails).toHaveLength(26);
    expect(new Set(emails).size).toBe(26);
    expect(emails[0]).toBe(emailUsuarioSinteticoCarga(1_000, 0));
    expect(emails[25]).toBe(emailUsuarioSinteticoCarga(1_000, 25));
  });

  it("rechaza indice/cantidad invalidos (negativo, no entero, cero) en vez de producir un email incoherente", () => {
    expect(() => emailUsuarioSinteticoCarga(100, -1)).toThrow();
    expect(() => emailUsuarioSinteticoCarga(100, 1.5)).toThrow();
    expect(() => emailsUsuariosSinteticosCarga(100, 0)).toThrow();
    expect(() => emailsUsuariosSinteticosCarga(100, -5)).toThrow();
  });
});

describe("construirFilasUsuariosSinteticosCarga", () => {
  it("construye una fila por passwordHash, con el email correspondiente, rol ADMINISTRADOR, mfaHabilitado=false y sessionVersion=1", () => {
    const hashes = ["hash-0", "hash-1", "hash-2"];
    const filas = construirFilasUsuariosSinteticosCarga("empresa-123", 1_000, hashes);

    expect(filas).toHaveLength(3);
    filas.forEach((fila, indice) => {
      expect(fila.email).toBe(emailUsuarioSinteticoCarga(1_000, indice));
      expect(fila.passwordHash).toBe(hashes[indice]);
      expect(fila.empresaId).toBe("empresa-123");
      expect(fila.rol).toBe(ROL_USUARIO_SINTETICO_CARGA);
      expect(fila.mfaHabilitado).toBe(false);
      expect(fila.sessionVersion).toBe(1);
    });
  });

  it("nunca incluye ninguna cookie ni token en la fila -- solo datos de Usuario", () => {
    const [fila] = construirFilasUsuariosSinteticosCarga("empresa-123", 100, ["hash-0"]);
    expect(Object.keys(fila!).sort()).toEqual(
      ["email", "empresaId", "mfaHabilitado", "nombre", "passwordHash", "rol", "sessionVersion"].sort(),
    );
  });
});

describe("construirClaimsSesionSintetica", () => {
  it("mapea 1:1 los campos del Usuario a los claims del JWT, incluyendo sub=id", () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-abc-123",
      email: "usuario-0000-escala-1000@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 0 (PR4, escala 1000)",
      empresaId: "empresa-xyz",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });

    expect(claims.sub).toBe("usuario-abc-123");
    expect(claims.email).toBe("usuario-0000-escala-1000@chainpulse-pr4-rendimiento-sintetico.invalid");
    expect(claims.name).toBe("Usuario sintetico de carga 0 (PR4, escala 1000)");
    expect((claims as Record<string, unknown>).empresaId).toBe("empresa-xyz");
    expect((claims as Record<string, unknown>).rol).toBe("ADMINISTRADOR");
    expect((claims as Record<string, unknown>).eslabonId).toBeNull();
    expect((claims as Record<string, unknown>).mfaHabilitado).toBe(false);
    expect((claims as Record<string, unknown>).sessionVersion).toBe(1);
  });
});

describe("mintarCookieSesionSintetica", () => {
  it("produce un valor `NOMBRE_COOKIE_SESION_HTTPS=<jwt>` que decode() (next-auth/jwt) descifra de vuelta a los MISMOS claims -- mismo mecanismo que usa requireSession() en produccion", async () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-id-de-prueba",
      email: "usuario-0003-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 3 (PR4, escala 100)",
      empresaId: "empresa-de-prueba",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });

    const cookie = await mintarCookieSesionSintetica(SECRETO_DE_PRUEBA_DESCARTABLE, claims);

    expect(cookie.startsWith(`${NOMBRE_COOKIE_SESION_HTTPS}=`)).toBe(true);
    const token = cookie.slice(`${NOMBRE_COOKIE_SESION_HTTPS}=`.length);

    const descifrado = await decode({
      secret: SECRETO_DE_PRUEBA_DESCARTABLE,
      salt: NOMBRE_COOKIE_SESION_HTTPS,
      token,
    });

    expect(descifrado).not.toBeNull();
    expect(descifrado?.sub).toBe("usuario-id-de-prueba");
    expect(descifrado?.email).toBe("usuario-0003-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid");
    expect((descifrado as Record<string, unknown>).empresaId).toBe("empresa-de-prueba");
    expect((descifrado as Record<string, unknown>).rol).toBe("ADMINISTRADOR");
    expect((descifrado as Record<string, unknown>).sessionVersion).toBe(1);
    // iat/exp/jti los agrega automaticamente encode() -- confirma que la
    // vigencia configurada (VIGENCIA_SESION_SINTETICA_SEGUNDOS) quedo
    // efectivamente aplicada, no ignorada.
    expect(typeof descifrado?.iat).toBe("number");
    expect(typeof descifrado?.exp).toBe("number");
    expect((descifrado!.exp as number) - (descifrado!.iat as number)).toBe(VIGENCIA_SESION_SINTETICA_SEGUNDOS);
  });

  it("un secreto distinto NUNCA puede decodificar la cookie (sin esto, cualquiera podria forjar una sesion)", async () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-id-2",
      email: "usuario-0004-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 4 (PR4, escala 100)",
      empresaId: "empresa-de-prueba",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });
    const cookie = await mintarCookieSesionSintetica(SECRETO_DE_PRUEBA_DESCARTABLE, claims);
    const token = cookie.slice(`${NOMBRE_COOKIE_SESION_HTTPS}=`.length);

    await expect(
      decode({ secret: "otro-secreto-completamente-distinto", salt: NOMBRE_COOKIE_SESION_HTTPS, token }),
    ).rejects.toThrow();
  });

  it("rechaza un secreto vacio sin intentar cifrar nada", async () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-id-3",
      email: "usuario-0005-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 5 (PR4, escala 100)",
      empresaId: "empresa-de-prueba",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });
    await expect(mintarCookieSesionSintetica("", claims)).rejects.toThrow("SECRETO_NEXTAUTH_VACIO");
  });

  it("el mensaje de error de secreto vacio NUNCA incluye el valor del secreto ni ninguna cookie (no hay nada que filtrar)", async () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-id-4",
      email: "usuario-0006-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 6 (PR4, escala 100)",
      empresaId: "empresa-de-prueba",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });
    try {
      await mintarCookieSesionSintetica("", claims);
      throw new Error("deberia haber lanzado");
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      expect(mensaje).toBe("SECRETO_NEXTAUTH_VACIO");
      expect(mensaje).not.toContain(SECRETO_DE_PRUEBA_DESCARTABLE);
      expect(mensaje.length).toBeLessThan(80);
    }
  });
});
