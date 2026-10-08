// Pruebas — mecanismo acotado de revocacion de sesiones (Alex, 2026-10-03,
// diagnostico-eliminacion-cuenta-prueba.md Seccion 8; corregido 2026-10-04 en
// dos rondas antes de aplicar el diff en Windows -- ver los bloques de
// pruebas marcados mas abajo). Unitarias con tenantClient() mockeado
// (vi.mock) -- mismo criterio que
// src/app/api/kpis/cobertura/importaciones/__tests__/route.test.ts: nada
// de red ni Prisma real, "prisma generate" sigue bloqueado en este
// entorno. Las pruebas de integracion (contra una base real) quedan
// pendientes de autorizacion aparte -- no se agregan aca.
//
// Segunda ronda (Alex, 2026-10-04): ambos catch pasaban el error
// capturado directo a logError(), que SI extrae y registra su
// mensaje/stack reales (src/infra/log.ts) -- un error de
// Prisma/Postgres puede traer fragmentos de la consulta o del DSN de
// conexion. Las pruebas de "fallo de la consulta" de abajo simulan un
// secreto DENTRO del mensaje del error y verifican que el logger
// jamas lo recibe -- solo un codigo fijo, siempre el mismo texto sin
// importar la causa real del fallo.
import { describe, expect, it, vi, beforeEach } from "vitest";

const findUniqueMock = vi.fn();
const tenantClientMock = vi.fn(() => ({ usuario: { findUnique: findUniqueMock } }));
vi.mock("../../prisma/tenantClient", () => ({ tenantClient: tenantClientMock }));

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verificarSesionVigente", () => {
  it("usuario existe y sessionVersion coincide con el claim -- vigente", async () => {
    const { verificarSesionVigente } = await import("../sessionVerification");
    findUniqueMock.mockResolvedValue({ sessionVersion: 1 });

    const resultado = await verificarSesionVigente("usuario-1", "empresa-1", 1);

    expect(resultado).toEqual({ vigente: true });
    expect(tenantClientMock).toHaveBeenCalledWith("empresa-1");
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: "usuario-1" }, select: { sessionVersion: true } });
  });

  it("usuario eliminado (o la empresa ya no coincide) -- cero filas -- ELIMINADA", async () => {
    const { verificarSesionVigente } = await import("../sessionVerification");
    findUniqueMock.mockResolvedValue(null);

    const resultado = await verificarSesionVigente("usuario-1", "empresa-1", 1);

    expect(resultado).toEqual({ vigente: false, motivo: "ELIMINADA" });
  });

  it("sessionVersion de la base distinta del claim -- REVOCADA", async () => {
    const { verificarSesionVigente } = await import("../sessionVerification");
    findUniqueMock.mockResolvedValue({ sessionVersion: 2 });

    const resultado = await verificarSesionVigente("usuario-1", "empresa-1", 1);

    expect(resultado).toEqual({ vigente: false, motivo: "REVOCADA" });
  });

  it("fallo de la consulta (timeout/conexion) -- fail-closed, NUNCA vigente", async () => {
    const { verificarSesionVigente } = await import("../sessionVerification");
    findUniqueMock.mockRejectedValue(new Error("conexion perdida"));

    const resultado = await verificarSesionVigente("usuario-1", "empresa-1", 1);

    expect(resultado).toEqual({ vigente: false, motivo: "ERROR_VERIFICACION" });
    expect(logErrorMock).toHaveBeenCalledWith("verificarSesionVigente", "ERROR_CONSULTA_VIGENCIA_SESION");
  });

  it("fallo de la consulta CON UN SECRETO SIMULADO dentro del error -- el logger recibe solo el codigo fijo, el secreto nunca llega", async () => {
    const { verificarSesionVigente } = await import("../sessionVerification");
    const secreto = "DATABASE_URL=postgres://chainpulse_app:ContraseñaSecreta123@host/db?token=abcXYZsecreto";
    findUniqueMock.mockRejectedValue(new Error(`conexion perdida -- ${secreto}`));

    const resultado = await verificarSesionVigente("usuario-1", "empresa-1", 1);

    expect(resultado).toEqual({ vigente: false, motivo: "ERROR_VERIFICACION" });
    // Exacto, no "contiene": si el secreto se coló en cualquier parte del
    // mensaje registrado (concatenado, interpolado, como causa anidada),
    // esta igualdad estricta ya no se cumple.
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith("verificarSesionVigente", "ERROR_CONSULTA_VIGENCIA_SESION");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain("ContraseñaSecreta123");
    expect(argumentosRegistrados).not.toContain(secreto);
    expect(argumentosRegistrados).not.toContain("postgres://");
  });

  // JWT viejo sin claim (undefined) -- caso legitimo de compatibilidad,
  // conservado tal cual lo pidio Alex (2026-10-04): aceptado si la base
  // sigue en el valor por defecto, rechazado si ya se revoco.
  it("JWT viejo sin claim (undefined), usuario nunca revocado (sessionVersion=1 en base) -- vigente, no desloguea", async () => {
    const { verificarSesionVigente, SESSION_VERSION_POR_DEFECTO } = await import("../sessionVerification");
    expect(SESSION_VERSION_POR_DEFECTO).toBe(1);
    findUniqueMock.mockResolvedValue({ sessionVersion: 1 });

    const resultado = await verificarSesionVigente("usuario-1", "empresa-1", undefined);

    expect(resultado).toEqual({ vigente: true });
  });

  it("JWT viejo sin claim, pero el usuario SI fue revocado despues (sessionVersion=2 en base) -- se rechaza igual", async () => {
    const { verificarSesionVigente } = await import("../sessionVerification");
    findUniqueMock.mockResolvedValue({ sessionVersion: 2 });

    const resultado = await verificarSesionVigente("usuario-1", "empresa-1", undefined);

    expect(resultado).toEqual({ vigente: false, motivo: "REVOCADA" });
  });

  it("aislamiento -- consulta siempre con el empresaId del propio JWT, nunca uno distinto", async () => {
    const { verificarSesionVigente } = await import("../sessionVerification");
    findUniqueMock.mockResolvedValue({ sessionVersion: 1 });

    await verificarSesionVigente("usuario-de-otra-empresa", "empresa-correcta", 1);

    expect(tenantClientMock).toHaveBeenCalledWith("empresa-correcta");
    expect(tenantClientMock).not.toHaveBeenCalledWith(expect.not.stringMatching("empresa-correcta"));
  });

  // Correccion acotada (Alex, 2026-10-04): a diferencia de "undefined"
  // (arriba), un claim "null" o que no sea un entero positivo valido ya
  // NO cae en el valor por defecto -- se rechaza siempre, aunque la base
  // tenga sessionVersion=1. No deberia poder pasar con el callback actual
  // de auth.config.ts (siempre asigna un numero), pero si pasara (JWT
  // manipulado, bug futuro) no debe aceptarse por descarte.
  describe("claim invalido (ni ausente ni entero positivo) -- se rechaza siempre, nunca cae en el valor por defecto", () => {
    it.each([
      ["null", null],
      ["cero", 0],
      ["negativo", -1],
      ["decimal", 1.5],
      ["NaN", Number.NaN],
      ["string numerico", "1" as unknown as number],
    ])("claim = %s -- REVOCADA incluso con sessionVersion=1 en base", async (_nombre, claimInvalido) => {
      const { verificarSesionVigente } = await import("../sessionVerification");
      findUniqueMock.mockResolvedValue({ sessionVersion: 1 });

      const resultado = await verificarSesionVigente("usuario-1", "empresa-1", claimInvalido);

      expect(resultado).toEqual({ vigente: false, motivo: "REVOCADA" });
    });
  });
});

describe("leerSessionVersionParaLogin", () => {
  it("devuelve el sessionVersion real de la base", async () => {
    const { leerSessionVersionParaLogin } = await import("../sessionVerification");
    findUniqueMock.mockResolvedValue({ sessionVersion: 3 });

    const version = await leerSessionVersionParaLogin("usuario-1", "empresa-1");

    expect(version).toBe(3);
  });

  // Correccion acotada (Alex, 2026-10-04): ya NO devuelve el valor por
  // defecto si la consulta falla -- devuelve null, para que autorizar()
  // (src/auth.ts) no emita una sesion nueva con un sessionVersion que no
  // se pudo confirmar contra la base. Sigue sin lanzar. (Segunda ronda,
  // mismo dia: el logger recibe un codigo fijo, nunca el error real --
  // ver la prueba del secreto simulado mas abajo.)
  it("si la consulta falla, NO permite emitir sesion -- devuelve null (ya no el valor por defecto)", async () => {
    const { leerSessionVersionParaLogin } = await import("../sessionVerification");
    findUniqueMock.mockRejectedValue(new Error("timeout"));

    const version = await leerSessionVersionParaLogin("usuario-1", "empresa-1");

    expect(version).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith("leerSessionVersionParaLogin", "ERROR_LECTURA_SESSION_VERSION_LOGIN");
  });

  it("si la consulta falla CON UN SECRETO SIMULADO dentro del error -- el logger recibe solo el codigo fijo, el secreto nunca llega", async () => {
    const { leerSessionVersionParaLogin } = await import("../sessionVerification");
    const secreto = "password=SuperSecreta123!;apiKey=sk_live_abcXYZsecreto";
    findUniqueMock.mockRejectedValue(new Error(`fallo de autenticacion con la base -- ${secreto}`));

    const version = await leerSessionVersionParaLogin("usuario-1", "empresa-1");

    expect(version).toBeNull();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith("leerSessionVersionParaLogin", "ERROR_LECTURA_SESSION_VERSION_LOGIN");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain("SuperSecreta123");
    expect(argumentosRegistrados).not.toContain(secreto);
    expect(argumentosRegistrados).not.toContain("sk_live_");
  });

  it("si no hay fila (caso borde) -- tampoco permite emitir sesion -- devuelve null, no lanza, y registra un codigo fijo (no hay error del que extraer nada en este caso)", async () => {
    const { leerSessionVersionParaLogin } = await import("../sessionVerification");
    findUniqueMock.mockResolvedValue(null);

    const version = await leerSessionVersionParaLogin("usuario-1", "empresa-1");

    expect(version).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith("leerSessionVersionParaLogin", "USUARIO_NO_ENCONTRADO_AL_LOGIN");
  });
});
