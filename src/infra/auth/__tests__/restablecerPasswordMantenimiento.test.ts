// Pruebas — mecanismo de mantenimiento acotado para restablecer la
// contraseña de la cuenta de prueba (Alex, 2026-10-03, Alternativa B de
// diagnostico-eliminacion-cuenta-prueba.md Sección 10; segunda ronda de
// revisión, mismo día). Unitarias con tenantClient()/tenantTransaction()/
// prisma.$queryRaw mockeados -- nada de red ni Prisma real. Las pruebas
// de integración (contra una base real) y la ejecución real del script
// quedan pendientes de autorización aparte -- no se agregan ni se corren
// acá.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const findUniqueMock = vi.fn();
const tenantClientMock = vi.fn(() => ({ usuario: { findUnique: findUniqueMock } }));
vi.mock("../../prisma/tenantClient", () => ({ tenantClient: tenantClientMock }));

// tenantTransaction(empresaId, fn) real abre UNA transaccion, fija el
// tenant y llama fn(tx); si fn lanza, Prisma revierte esa transaccion y
// tenantTransaction() repropaga el error -- este mock reproduce
// exactamente ese contrato (llama fn con un tx de prueba y deja que
// cualquier excepcion de fn se propague tal cual), sin reimplementar el
// Proxy de inyeccion de tenant real (eso es responsabilidad ya probada
// de tenantTransaction.ts, no de este archivo).
const updateManyMock = vi.fn();
const txDePrueba = { usuario: { updateMany: updateManyMock } };
const tenantTransactionMock = vi.fn(async (_empresaId: string, fn: (tx: typeof txDePrueba) => Promise<unknown>) => {
  return fn(txDePrueba);
});
vi.mock("../../prisma/tenantTransaction", () => ({ tenantTransaction: tenantTransactionMock }));

// Nuevo en la segunda ronda: verificarRolEfectivo() usa prisma.$queryRaw
// directo (sin tenantClient(), el rol no depende de ningun tenant --
// mismo patron que loginLookup.ts). Se mockea el cliente base.
const queryRawMock = vi.fn();
vi.mock("../../prisma/client", () => ({ prisma: { $queryRaw: queryRawMock } }));

// A partir de esta revision el modulo YA NO importa src/infra/log.ts en
// absoluto -- logError() arma un JSON con mensaje+stack crudos del error
// y lo imprime por console.error (ver su propio comentario de cabecera),
// que es exactamente lo que este mecanismo evita. No hay nada que
// mockear de ese archivo porque no se usa. En su lugar, cada prueba de
// fallo espia console.error directamente para confirmar que SOLO se
// registra un mensaje fijo + la etiqueta segura, nunca el error crudo.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

const EMPRESA_ID = "empresa-1";
const USUARIO_ID = "usuario-1";
const EMAIL = "cuenta-prueba@chainpulse.invalid";

describe("verificarUsuarioObjetivo", () => {
  it("usuario encontrado, misma empresa, mismo email -- ok, trae intentosFallidos/bloqueadoHasta", async () => {
    const { verificarUsuarioObjetivo } = await import("../restablecerPasswordMantenimiento");
    findUniqueMock.mockResolvedValue({
      id: USUARIO_ID,
      empresaId: EMPRESA_ID,
      email: EMAIL,
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });

    const resultado = await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, EMAIL);

    expect(resultado).toEqual({
      ok: true,
      usuario: { id: USUARIO_ID, empresaId: EMPRESA_ID, email: EMAIL, intentosFallidos: 0, bloqueadoHasta: null },
    });
    expect(tenantClientMock).toHaveBeenCalledWith(EMPRESA_ID);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: USUARIO_ID },
      select: { id: true, empresaId: true, email: true, intentosFallidos: true, bloqueadoHasta: true },
    });
  });

  it("usuario no encontrado (eliminado, o no pertenece a esa empresa via RLS) -- NO_ENCONTRADO", async () => {
    const { verificarUsuarioObjetivo } = await import("../restablecerPasswordMantenimiento");
    findUniqueMock.mockResolvedValue(null);

    const resultado = await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, EMAIL);

    expect(resultado).toEqual({ ok: false, motivo: "NO_ENCONTRADO" });
  });

  it("email no coincide -- EMAIL_NO_COINCIDE, nunca se asume que es la cuenta correcta", async () => {
    const { verificarUsuarioObjetivo } = await import("../restablecerPasswordMantenimiento");
    findUniqueMock.mockResolvedValue({
      id: USUARIO_ID,
      empresaId: EMPRESA_ID,
      email: "otro@chainpulse.invalid",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });

    const resultado = await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, EMAIL);

    expect(resultado).toEqual({ ok: false, motivo: "EMAIL_NO_COINCIDE" });
  });

  it("chequeo defensivo de empresaId -- si la fila devuelta trajera otra empresa, aborta igual (no confía en silencio)", async () => {
    const { verificarUsuarioObjetivo } = await import("../restablecerPasswordMantenimiento");
    findUniqueMock.mockResolvedValue({
      id: USUARIO_ID,
      empresaId: "empresa-distinta",
      email: EMAIL,
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });

    const resultado = await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, EMAIL);

    expect(resultado).toEqual({ ok: false, motivo: "EMPRESA_NO_COINCIDE" });
  });

  it("fallo de la consulta -- ERROR_VERIFICACION, registra solo un mensaje fijo (nunca el error crudo)", async () => {
    const { verificarUsuarioObjetivo } = await import("../restablecerPasswordMantenimiento");
    findUniqueMock.mockRejectedValue(new Error("conexion perdida -- detalle interno del driver"));

    const resultado = await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, EMAIL);

    expect(resultado).toEqual({ ok: false, motivo: "ERROR_VERIFICACION" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toBe("[verificarUsuarioObjetivo] [ERROR] error no clasificado");
  });

  it("aislamiento -- siempre consulta con el empresaId dado, nunca uno distinto", async () => {
    const { verificarUsuarioObjetivo } = await import("../restablecerPasswordMantenimiento");
    findUniqueMock.mockResolvedValue({
      id: USUARIO_ID,
      empresaId: EMPRESA_ID,
      email: EMAIL,
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });

    await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, EMAIL);

    expect(tenantClientMock).toHaveBeenCalledTimes(1);
    expect(tenantClientMock).toHaveBeenCalledWith(EMPRESA_ID);
  });
});

describe("describirEstadoBloqueo", () => {
  it("sin bloqueadoHasta -- bloqueadaAhora=false", async () => {
    const { describirEstadoBloqueo } = await import("../restablecerPasswordMantenimiento");
    const resultado = describirEstadoBloqueo({ intentosFallidos: 2, bloqueadoHasta: null });
    expect(resultado).toEqual({ intentosFallidos: 2, bloqueadoHasta: null, bloqueadaAhora: false });
  });

  it("bloqueadoHasta en el futuro -- bloqueadaAhora=true (misma regla que estaBloqueado() de rateLimit.ts)", async () => {
    const { describirEstadoBloqueo } = await import("../restablecerPasswordMantenimiento");
    const futuro = new Date(Date.now() + 10 * 60_000);
    const resultado = describirEstadoBloqueo({ intentosFallidos: 5, bloqueadoHasta: futuro });
    expect(resultado).toEqual({ intentosFallidos: 5, bloqueadoHasta: futuro, bloqueadaAhora: true });
  });

  it("bloqueadoHasta en el pasado -- bloqueadaAhora=false (el bloqueo ya vencio)", async () => {
    const { describirEstadoBloqueo } = await import("../restablecerPasswordMantenimiento");
    const pasado = new Date(Date.now() - 10 * 60_000);
    const resultado = describirEstadoBloqueo({ intentosFallidos: 5, bloqueadoHasta: pasado });
    expect(resultado).toEqual({ intentosFallidos: 5, bloqueadoHasta: pasado, bloqueadaAhora: false });
  });
});

describe("verificarRolEfectivo", () => {
  it("rol efectivo correcto (chainpulse_app) -- ok", async () => {
    const { verificarRolEfectivo } = await import("../restablecerPasswordMantenimiento");
    queryRawMock.mockResolvedValue([{ rol: "chainpulse_app" }]);

    const resultado = await verificarRolEfectivo();

    expect(resultado).toEqual({ ok: true, rol: "chainpulse_app" });
  });

  // Corregido (sexta ronda de revision, a pedido de Alex -- fallo real en
  // Windows): la consulta debe pedir `current_user::text`, NUNCA
  // `current_user` sin cast -- sin el cast, Postgres devuelve el tipo
  // "name" (OID 19), que @prisma/adapter-pg no sabe convertir y hace que
  // la consulta falle SIEMPRE con code "P2010" (ver el comentario de
  // cabecera de verificarRolEfectivo()). Esta prueba fija el texto exacto
  // de la consulta para que una futura edicion no vuelva a quitar el
  // cast por accidente.
  it("la consulta pide current_user::text (con cast), nunca current_user sin cast", async () => {
    const { verificarRolEfectivo } = await import("../restablecerPasswordMantenimiento");
    queryRawMock.mockResolvedValue([{ rol: "chainpulse_app" }]);

    await verificarRolEfectivo();

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const plantilla = queryRawMock.mock.calls[0]?.[0] as unknown as string[];
    const sqlCompleto = plantilla.join("");
    expect(sqlCompleto).toContain("current_user::text");
    expect(sqlCompleto).not.toMatch(/current_user(?!::text)/);
  });

  it("rol inesperado (p. ej. neondb_owner) -- ROL_INESPERADO, nunca se asume que esta bien", async () => {
    const { verificarRolEfectivo } = await import("../restablecerPasswordMantenimiento");
    queryRawMock.mockResolvedValue([{ rol: "neondb_owner" }]);

    const resultado = await verificarRolEfectivo();

    expect(resultado).toEqual({ ok: false, motivo: "ROL_INESPERADO", rolActual: "neondb_owner" });
  });

  it("fallo de la propia consulta de rol -- ERROR_VERIFICACION_ROL con etiqueta segura, nunca el error crudo", async () => {
    const { verificarRolEfectivo } = await import("../restablecerPasswordMantenimiento");
    const err = Object.assign(new Error("conexion rechazada -- detalle interno del driver"), { code: "ECONNREFUSED" });
    queryRawMock.mockRejectedValue(err);

    const resultado = await verificarRolEfectivo();

    expect(resultado).toEqual({ ok: false, motivo: "ERROR_VERIFICACION_ROL", etiqueta: "[ECONNREFUSED] conexion rechazada" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toBe("[verificarRolEfectivo] [ECONNREFUSED] conexion rechazada");
  });

  // Caso real reportado por Alex (Windows, v5+v7 instalados): la consulta
  // sin cast fallaba SIEMPRE con este codigo exacto, antes de llegar a
  // verificar ningun usuario. Confirma que, incluso sin el cast
  // corregido, un P2010 se clasifica (no cae en "error no clasificado")
  // y el detalle interno del driver nunca se registra.
  it("fallo con code P2010 (caso real -- tipo de columna no soportado) -- se clasifica, nunca el detalle crudo", async () => {
    const { verificarRolEfectivo } = await import("../restablecerPasswordMantenimiento");
    const secreto = "SECRETO_SIMULADO_P2010_h9Vt";
    const err = Object.assign(new Error(`Failed to deserialize column of type 'name' -- ${secreto}`), { code: "P2010" });
    queryRawMock.mockRejectedValue(err);

    const resultado = await verificarRolEfectivo();

    expect(resultado).toEqual({
      ok: false,
      motivo: "ERROR_VERIFICACION_ROL",
      etiqueta: "[P2010] consulta cruda fallida (posible tipo de columna no soportado por el driver)",
    });
    const todoLoRegistrado = consoleErrorSpy.mock.calls.flat().map(String).join(" | ");
    expect(todoLoRegistrado).not.toContain(secreto);
  });
});

describe("validarPoliticaPassword", () => {
  it("acepta una contraseña de 8 caracteres (minimo, misma politica que /api/registro)", async () => {
    const { validarPoliticaPassword } = await import("../restablecerPasswordMantenimiento");
    expect(validarPoliticaPassword("12345678")).toEqual({ ok: true });
  });

  it("acepta una contraseña de 200 caracteres (maximo)", async () => {
    const { validarPoliticaPassword } = await import("../restablecerPasswordMantenimiento");
    expect(validarPoliticaPassword("a".repeat(200))).toEqual({ ok: true });
  });

  it("rechaza menos de 8 caracteres", async () => {
    const { validarPoliticaPassword } = await import("../restablecerPasswordMantenimiento");
    const resultado = validarPoliticaPassword("1234567");
    expect(resultado.ok).toBe(false);
  });

  it("rechaza mas de 200 caracteres", async () => {
    const { validarPoliticaPassword } = await import("../restablecerPasswordMantenimiento");
    const resultado = validarPoliticaPassword("a".repeat(201));
    expect(resultado.ok).toBe(false);
  });
});

describe("aplicarNuevaPasswordAtomico", () => {
  it("count=1 -- ok, el UPDATE solo toca passwordHash, dentro de UNA transaccion (tenantTransaction)", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    updateManyMock.mockResolvedValue({ count: 1 });

    const resultado = await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    expect(resultado).toEqual({ ok: true });
    expect(tenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(tenantTransactionMock.mock.calls[0]?.[0]).toBe(EMPRESA_ID);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: USUARIO_ID, empresaId: EMPRESA_ID, email: EMAIL },
      data: { passwordHash: "hash-nuevo-simulado" },
    });
    // El data del UPDATE no debe traer ningun otro campo -- ni
    // intentosFallidos/bloqueadoHasta, ni mfaSecret/mfaHabilitado, ni
    // sessionVersion, ni email/empresaId.
    const [llamada] = updateManyMock.mock.calls[0] as [{ where: unknown; data: Record<string, unknown> }];
    expect(Object.keys(llamada.data)).toEqual(["passwordHash"]);
    // Ningun camino de exito registra nada por console.error.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("count=0 -- lanza DENTRO de la transaccion para forzar el rollback, y se traduce a CONTEO_INESPERADO (sin registrar nada: no es un error crudo, es un resultado esperado)", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    updateManyMock.mockResolvedValue({ count: 0 });

    const resultado = await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    expect(resultado).toEqual({ ok: false, motivo: "CONTEO_INESPERADO", cantidad: 0 });
    // La funcion pasada a tenantTransaction() debe haber lanzado -- es
    // asi como una transaccion real de Prisma revierte el UPDATE antes
    // de confirmarlo.
    expect(tenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("count=2 (imposible en teoria, id es PK) -- misma via de rollback, nunca se confia en silencio", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    updateManyMock.mockResolvedValue({ count: 2 });

    const resultado = await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    expect(resultado).toEqual({ ok: false, motivo: "CONTEO_INESPERADO", cantidad: 2 });
  });

  it("fallo de escritura con codigo 42501 -- etiqueta segura de permiso denegado, registra solo un mensaje fijo (nunca el mensaje crudo del driver)", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    const err = Object.assign(new Error("permission denied for table usuarios -- detalle interno del driver"), { code: "42501" });
    updateManyMock.mockRejectedValue(err);

    const resultado = await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    expect(resultado).toEqual({ ok: false, motivo: "ERROR_ESCRITURA", etiqueta: "[42501] permiso denegado" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const mensajeRegistrado = String(consoleErrorSpy.mock.calls[0]?.[0]);
    expect(mensajeRegistrado).toBe("[aplicarNuevaPasswordAtomico] [42501] permiso denegado");
    expect(mensajeRegistrado).not.toContain("detalle interno del driver");
  });

  it("fallo de escritura sin codigo reconocido -- etiqueta generica, nunca el mensaje crudo del driver", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    updateManyMock.mockRejectedValue(new Error("algo no documentado del driver, con detalle interno"));

    const resultado = await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    expect(resultado).toEqual({ ok: false, motivo: "ERROR_ESCRITURA", etiqueta: "[ERROR] error no clasificado" });
    const mensajeRegistrado = String(consoleErrorSpy.mock.calls[0]?.[0]);
    expect(mensajeRegistrado).not.toContain("algo no documentado del driver");
  });

  it("fallo de la propia transaccion (p. ej. no se pudo ni abrir) -- tambien ERROR_ESCRITURA, nunca se asume exito", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    tenantTransactionMock.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));

    const resultado = await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    expect(resultado).toEqual({ ok: false, motivo: "ERROR_ESCRITURA", etiqueta: "[ETIMEDOUT] tiempo de espera agotado" });
  });

  it("aislamiento -- el where siempre incluye id+empresaId+email juntos, nunca solo el id", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    updateManyMock.mockResolvedValue({ count: 1 });

    await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    const [llamada] = updateManyMock.mock.calls[0] as [{ where: unknown; data: Record<string, unknown> }];
    expect(llamada.where).toEqual({ id: USUARIO_ID, empresaId: EMPRESA_ID, email: EMAIL });
  });
});

describe("registro de errores -- nunca el error crudo, ni con un secreto simulado adentro", () => {
  it("verificarUsuarioObjetivo: un secreto simulado en el mensaje del error nunca aparece en lo registrado", async () => {
    const { verificarUsuarioObjetivo } = await import("../restablecerPasswordMantenimiento");
    const secreto = "SECRETO_SIMULADO_NO_DEBE_APARECER_9f3k";
    findUniqueMock.mockRejectedValue(
      Object.assign(new Error(`conexion perdida -- postgres://usuario:${secreto}@host:5432/db`), { code: "08006" }),
    );

    await verificarUsuarioObjetivo(EMPRESA_ID, USUARIO_ID, EMAIL);

    expect(consoleErrorSpy).toHaveBeenCalled();
    const todoLoRegistrado = consoleErrorSpy.mock.calls.flat().map(String).join(" | ");
    expect(todoLoRegistrado).not.toContain(secreto);
    expect(todoLoRegistrado).toContain("[08006] conexion perdida");
  });

  it("aplicarNuevaPasswordAtomico: un secreto simulado en el mensaje del error nunca aparece en lo registrado", async () => {
    const { aplicarNuevaPasswordAtomico } = await import("../restablecerPasswordMantenimiento");
    const secreto = "OTRO_SECRETO_SIMULADO_q7Lp2";
    updateManyMock.mockRejectedValue(Object.assign(new Error(`timeout -- token interno ${secreto}`), { code: "ETIMEDOUT" }));

    await aplicarNuevaPasswordAtomico(EMPRESA_ID, USUARIO_ID, EMAIL, "hash-nuevo-simulado");

    expect(consoleErrorSpy).toHaveBeenCalled();
    const todoLoRegistrado = consoleErrorSpy.mock.calls.flat().map(String).join(" | ");
    expect(todoLoRegistrado).not.toContain(secreto);
    expect(todoLoRegistrado).toContain("[ETIMEDOUT] tiempo de espera agotado");
  });

  it("verificarRolEfectivo: un secreto simulado en el mensaje del error nunca aparece en lo registrado", async () => {
    const { verificarRolEfectivo } = await import("../restablecerPasswordMantenimiento");
    const secreto = "TERCER_SECRETO_SIMULADO_z1Qx";
    queryRawMock.mockRejectedValue(Object.assign(new Error(`no se pudo autenticar -- password=${secreto}`), { code: "08001" }));

    await verificarRolEfectivo();

    expect(consoleErrorSpy).toHaveBeenCalled();
    const todoLoRegistrado = consoleErrorSpy.mock.calls.flat().map(String).join(" | ");
    expect(todoLoRegistrado).not.toContain(secreto);
  });
});
