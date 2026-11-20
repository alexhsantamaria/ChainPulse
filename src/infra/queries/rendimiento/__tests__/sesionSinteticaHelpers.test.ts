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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calcularNombreCookieSesion,
  construirClaimsSesionSintetica,
  construirFilasUsuariosSinteticosCarga,
  emailUsuarioSinteticoCarga,
  emailsUsuariosSinteticosCarga,
  mintarCookieSesionSintetica,
  NOMBRE_COOKIE_SESION_HTTP,
  NOMBRE_COOKIE_SESION_HTTPS,
  ROL_USUARIO_SINTETICO_CARGA,
  sufijoEmailUsuariosSinteticosCarga,
  VIGENCIA_SESION_SINTETICA_SEGUNDOS,
} from "../sesionSinteticaHelpers";
import { MARCA_SINTETICA_RENDIMIENTO_PR4 } from "../configuracionRendimiento";

// Mismo patron de verificacion ESTATICA (leer como TEXTO, sin ejecutar)
// que src/infra/rateLimit/__tests__/migracionBucketConsultaEjecutar.test.ts
// -- aca se aplica al codigo fuente de @auth/core en vez de a una
// migracion SQL, para fijar (pin) el mecanismo real de Auth.js que este
// modulo replica y detectar drift si una actualizacion de dependencia lo
// cambia silenciosamente.
const RUTA_AUTH_CORE_COOKIE = join(
  __dirname,
  "../../../../../node_modules/@auth/core/lib/utils/cookie.js",
);
const RUTA_AUTH_CONFIG = join(__dirname, "../../../../auth.config.ts");
const RUTA_AUTH_TS = join(__dirname, "../../../../auth.ts");

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

// Investigacion (Alex, 2026-11-20): por que mintarCookieSesionSintetica()
// producia 401 en el Preview de Vercel AUNQUE CARGA_CONSULTAS_NEXTAUTH_SECRET
// coincidiera exactamente con el NEXTAUTH_SECRET real del deployment. Raiz:
// el NOMBRE/SALT efectivo de la cookie de Auth.js v5 depende de como el
// SERVIDOR resuelve `useSecureCookies` PARA ESE DEPLOYMENT especifico
// (@auth/core/lib/init.js: `config.useSecureCookies ?? url.protocol ===
// "https:"`, con `url` resuelto por createActionURL() a partir de
// AUTH_URL/NEXTAUTH_URL del entorno de Vercel elegido, o de los headers
// reales si esa variable no esta definida ahi) -- nunca de si la URL de
// DESTINO del script es HTTPS. Si el servidor resuelve useSecureCookies
// distinto de lo que el script asumio, el nombre de cookie (y el salt
// usado para derivar la clave de cifrado, que es EL MISMO valor --
// @auth/core/jwt.js, getDerivedEncryptionKey()) no coincide: decode()
// falla, auth() devuelve session:null, y requireSession() responde 401
// "NO_SESION" -- EXACTAMENTE el sintoma reportado, aunque el secreto sea
// perfecto. sessionVersion/verificarSesionVigente() (DB) nunca entra en
// juego en este modo de fallo: el decode falla antes de llegar ahi.
describe("calcularNombreCookieSesion -- mecanismo real de Auth.js v5 (defaultCookies)", () => {
  it("useSecureCookies=true produce el nombre con prefijo __Secure- (igual a NOMBRE_COOKIE_SESION_HTTPS)", () => {
    expect(calcularNombreCookieSesion(true)).toBe("__Secure-authjs.session-token");
    expect(calcularNombreCookieSesion(true)).toBe(NOMBRE_COOKIE_SESION_HTTPS);
  });

  it("useSecureCookies=false produce el nombre SIN prefijo (igual a NOMBRE_COOKIE_SESION_HTTP) -- nunca asumido por defecto sin confirmarlo", () => {
    expect(calcularNombreCookieSesion(false)).toBe("authjs.session-token");
    expect(calcularNombreCookieSesion(false)).toBe(NOMBRE_COOKIE_SESION_HTTP);
  });

  it("los dos nombres son SIEMPRE distintos -- una cookie minteada para un valor de useSecureCookies jamas coincide por nombre con el otro", () => {
    expect(NOMBRE_COOKIE_SESION_HTTPS).not.toBe(NOMBRE_COOKIE_SESION_HTTP);
  });

  it("contrato estatico: @auth/core/lib/utils/cookie.js (defaultCookies()) sigue construyendo el nombre exactamente como `${cookiePrefix}authjs.session-token` con prefijo \"__Secure-\" -- si una actualizacion de next-auth cambia esto, esta prueba debe fallar primero, nunca en Preview", () => {
    const fuente = readFileSync(RUTA_AUTH_CORE_COOKIE, "utf8");
    expect(fuente).toContain("authjs.session-token");
    expect(fuente).toContain("__Secure-");
    expect(fuente).toMatch(/\$\{cookiePrefix\}authjs\.session-token/);
  });
});

describe("mintarCookieSesionSintetica(..., useSecureCookies) -- reproduccion real del mecanismo de 401 por salt incorrecto", () => {
  it("useSecureCookies=false mintea con el nombre SIN prefijo y decode() (mismo salt) recupera los claims intactos, incluido sessionVersion", async () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-id-http",
      email: "usuario-0007-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 7 (PR4, escala 100)",
      empresaId: "empresa-de-prueba",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });

    const cookie = await mintarCookieSesionSintetica(SECRETO_DE_PRUEBA_DESCARTABLE, claims, false);
    expect(cookie.startsWith(`${NOMBRE_COOKIE_SESION_HTTP}=`)).toBe(true);
    expect(cookie.startsWith(`${NOMBRE_COOKIE_SESION_HTTPS}=`)).toBe(false);
    const token = cookie.slice(`${NOMBRE_COOKIE_SESION_HTTP}=`.length);

    const descifrado = await decode({
      secret: SECRETO_DE_PRUEBA_DESCARTABLE,
      salt: NOMBRE_COOKIE_SESION_HTTP,
      token,
    });

    expect(descifrado).not.toBeNull();
    expect(descifrado?.sub).toBe("usuario-id-http");
    expect((descifrado as Record<string, unknown>).sessionVersion).toBe(1);
  });

  it("REPRODUCCION DEL 401 (direccion 1): cookie minteada asumiendo useSecureCookies=true, pero el SERVIDOR resuelve useSecureCookies=false para ese deployment -- decode() con el salt que el servidor usaria realmente FALLA, aunque el secreto sea exactamente el correcto", async () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-id-mismatch-1",
      email: "usuario-0008-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 8 (PR4, escala 100)",
      empresaId: "empresa-de-prueba",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });
    // El script asumio useSecureCookies=true (comportamiento HISTORICO,
    // antes de esta correccion, cuando NOMBRE_COOKIE_SESION_HTTPS era la
    // unica opcion hardcodeada).
    const cookie = await mintarCookieSesionSintetica(SECRETO_DE_PRUEBA_DESCARTABLE, claims, true);
    const token = cookie.slice(`${NOMBRE_COOKIE_SESION_HTTPS}=`.length);

    // Pero @auth/core/lib/actions/session.js calcula
    // `salt = options.cookies.sessionToken.name` a partir de lo que el
    // SERVIDOR resolvio para ese deployment -- aqui, false. Mismo secreto
    // exacto, salt distinto: decode() SIEMPRE falla (jwtDecrypt no
    // encuentra la clave correcta). Esta es la causa raiz del 401
    // reportado, no un problema del secreto.
    await expect(
      decode({ secret: SECRETO_DE_PRUEBA_DESCARTABLE, salt: NOMBRE_COOKIE_SESION_HTTP, token }),
    ).rejects.toThrow();
  });

  it("REPRODUCCION DEL 401 (direccion 2, simetrica): cookie minteada asumiendo useSecureCookies=false, pero el servidor resuelve true -- decode() tambien falla", async () => {
    const claims = construirClaimsSesionSintetica({
      id: "usuario-id-mismatch-2",
      email: "usuario-0009-escala-100@chainpulse-pr4-rendimiento-sintetico.invalid",
      nombre: "Usuario sintetico de carga 9 (PR4, escala 100)",
      empresaId: "empresa-de-prueba",
      rol: ROL_USUARIO_SINTETICO_CARGA,
      eslabonId: null,
      mfaHabilitado: false,
      sessionVersion: 1,
    });
    const cookie = await mintarCookieSesionSintetica(SECRETO_DE_PRUEBA_DESCARTABLE, claims, false);
    const token = cookie.slice(`${NOMBRE_COOKIE_SESION_HTTP}=`.length);

    await expect(
      decode({ secret: SECRETO_DE_PRUEBA_DESCARTABLE, salt: NOMBRE_COOKIE_SESION_HTTPS, token }),
    ).rejects.toThrow();
  });

  it("contrato estatico: ni auth.config.ts ni auth.ts fijan `cookies`/`useSecureCookies` -- la app queda totalmente expuesta a la resolucion dinamica de Auth.js descrita arriba, por lo que el valor efectivo SIEMPRE depende del deployment, nunca de una constante local", () => {
    const authConfigFuente = readFileSync(RUTA_AUTH_CONFIG, "utf8");
    const authTsFuente = readFileSync(RUTA_AUTH_TS, "utf8");
    for (const fuente of [authConfigFuente, authTsFuente]) {
      expect(fuente).not.toMatch(/\buseSecureCookies\s*:/);
      expect(fuente).not.toMatch(/\bcookies\s*:\s*\{/);
    }
  });
});
